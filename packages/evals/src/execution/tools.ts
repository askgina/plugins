import { Effect } from "effect";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  fromBaseUnits,
  HaltCauseSchema,
  type ExecutionAdapter,
  type ExecutionAdapterError,
} from "./contracts";

const baseUnits = z.string().regex(/^[1-9][0-9]*$/u, 'positive integer base units, e.g. "1500000"');

/** Adapter errors come back to the model as a tool result, never as a thrown error. */
const run = <A>(
  effect: Effect.Effect<A, ExecutionAdapterError>,
): Promise<A | { error: { code: string; message: string } }> =>
  Effect.runPromise(
    effect.pipe(
      Effect.catchTag("ExecutionAdapterError", (error) =>
        Effect.succeed({ error: { code: error.code, message: error.message } }),
      ),
    ),
  );

/**
 * The execution tool surface a model sees: read, quote, prepare (approval request), execute,
 * poll, and declare a halt. There is deliberately no tool to approve: only a recorded user reply can.
 */
export const makeExecutionTools = (adapter: ExecutionAdapter): ToolSet => ({
  list_accounts: tool({
    description:
      "List the user's accounts: id, network, gas asset, gas_per_tx (gas-asset base units one transaction costs; keep at least this much on any wallet that still holds funds), and current balances in integer base units.",
    inputSchema: z.object({}),
    execute: () =>
      run(
        Effect.map(adapter.listAccounts, (accounts) =>
          accounts.map((account) => ({
            ...account,
            gas_per_tx: fromBaseUnits(account.gas_per_tx),
            balances: Object.fromEntries(
              Object.entries(account.balances).map(([asset, amount]) => [
                asset,
                fromBaseUnits(amount),
              ]),
            ),
          })),
        ),
      ),
  }),
  get_policy: tool({
    description:
      "Read the user's execution policy: max total cost (USD micros), max slippage (bps), deadline (s), quote TTL (s), and any per-account gas reserve (base units). Plans must respect it.",
    inputSchema: z.object({}),
    execute: () => run(adapter.policy),
  }),
  list_legs: tool({
    description:
      "List available actions (swap, bridge, transfer, deposit legs) between accounts. Quote a leg to see its cost.",
    inputSchema: z.object({}),
    execute: () => run(adapter.listLegs),
  }),
  get_balance: tool({
    description: "Read an account's balance of one asset, in integer base units.",
    inputSchema: z.object({ account: z.string().min(1), asset: z.string().min(1) }),
    execute: ({ account, asset }) =>
      run(
        Effect.map(adapter.readBalance(account, asset), ({ amount }) => ({
          amount: fromBaseUnits(amount),
        })),
      ),
  }),
  quote_leg: tool({
    description:
      "Get a quote for one route leg. Quotes expire; re-quote if a submit reports quote_expired.",
    inputSchema: z.object({ leg: z.string().min(1), amount_in: baseUnits }),
    execute: ({ leg, amount_in }) =>
      run(
        Effect.map(adapter.quote(leg, BigInt(amount_in)), (quote) => ({
          ...quote,
          amount_out: fromBaseUnits(quote.amount_out),
        })),
      ),
  }),
  prepare_route: tool({
    description:
      "Request the user's approval for an ordered route of quotes. Present the plan (legs, total cost, max cost) and stop; the user will approve, refuse, or set a cost cap. Plan so that every wallet that still holds funds at the end keeps enough of its gas asset for one more transaction.",
    inputSchema: z.object({ quote_ids: z.array(z.string().min(1)).min(1) }),
    execute: ({ quote_ids }) =>
      run(
        Effect.map(adapter.prepareRoute(quote_ids), (approval) => ({
          ...approval,
          next: "Present this plan to the user and wait for their reply. Do not execute until they approve.",
        })),
      ),
  }),
  execute_leg: tool({
    description:
      "Submit one leg of a route the user approved, citing its approval_id. Returns a tx_id to poll. Execute strictly one leg at a time: after a leg's tx_status is confirmed, read its destination balance with get_balance before submitting the next leg.",
    inputSchema: z.object({ quote_id: z.string().min(1), approval_id: z.string().min(1) }),
    execute: ({ quote_id, approval_id }) => run(adapter.submitLeg(quote_id, approval_id)),
  }),
  tx_status: tool({
    description:
      "Poll a submitted transaction: pending, confirmed, dropped, or reverted. Each poll takes about 15 seconds. A bridge normally takes its leg's delay_s (from list_legs) to land; keep polling until at least that long has passed before treating it as stuck.",
    inputSchema: z.object({ tx_id: z.string().min(1) }),
    execute: ({ tx_id }) => run(adapter.status(tx_id)),
  }),
  report_result: tool({
    description:
      "This is your final message: its summary is shown to the user verbatim and the run ends here, so write nothing after it. Report the outcome (target reached, or halted and why) and where the user's funds are now: every nonzero or changed balance per account (integer base units) and any legs still in transit.",
    inputSchema: z.object({
      summary: z.string().min(1),
      outcome: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("target_reached") }),
        z.object({ kind: z.literal("halt"), cause: z.enum(HaltCauseSchema.literals) }),
      ]),
      balances: z.record(z.string(), z.record(z.string(), z.string().regex(/^(0|[1-9][0-9]*)$/u))),
      in_transit_legs: z.array(z.string()),
    }),
    execute: ({ summary, outcome, balances, in_transit_legs }) =>
      run(
        Effect.as(
          adapter.recordFinalAnswer({
            text: summary,
            declared_outcome: outcome,
            reported_balances: balances,
            in_transit_legs,
          }),
          { reported: true },
        ),
      ),
  }),
  halt_route: tool({
    description:
      "Stop without completing the goal and say why. For over_limit, pass the ordered quote_ids of the cheapest route you priced.",
    inputSchema: z.object({
      cause: z.enum(HaltCauseSchema.literals),
      reason: z.string().min(1),
      quote_ids: z.array(z.string().min(1)),
    }),
    execute: ({ cause, reason, quote_ids }) =>
      run(Effect.as(adapter.halt(cause, reason, quote_ids), { halted: true })),
  }),
});
