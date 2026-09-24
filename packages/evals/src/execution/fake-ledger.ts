import { Effect } from "effect";
import {
  ExecutionAdapterError,
  fromBaseUnits,
  type ExecutionAdapter,
  type ExecutionEdge,
  type ExecutionEvent,
  type ExecutionFault,
  type ExecutionTask,
  type FinalLedgerState,
  type TxStatus,
} from "./contracts";
import { invalidRouteReason, type QuotedLeg } from "./route";

interface Quote {
  readonly id: string;
  readonly edge: ExecutionEdge;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly costUsdMicros: number;
  readonly expiresAtMs: number;
}

interface Approval {
  readonly quoteIds: ReadonlySet<string>;
  /** Approved execution order; `next` is the index of the next leg allowed to submit. */
  readonly order: ReadonlyArray<string>;
  next: number;
  granted: boolean;
  maxCostUsdMicros: number;
}

interface Tx {
  readonly id: string;
  readonly quote: Quote;
  readonly submittedAtMs: number;
  readonly attempt: number;
  readonly gasPaid: bigint;
  status: TxStatus;
}

/** Simulated wall time one poll of a pending tx takes; bridge delays elapse through polling. */
export const POLL_INTERVAL_MS = 15_000;

const reject = (code: string, message: string) =>
  Effect.fail(new ExecutionAdapterError({ code, message }));

/**
 * Deterministic in-memory ledger for the harness-core layer. Enforces the same policy a signer
 * would (user-granted approval, quote freshness, serial legs, approved cost) and injects task faults.
 */
export const makeFakeLedger = (task: ExecutionTask): ExecutionAdapter => {
  let nowMs = 0;
  let counter = 0;
  const nextId = (prefix: string): string => `${prefix}_${++counter}`;
  const log: ExecutionEvent[] = [];
  const append = (event: ExecutionEvent): void => {
    // The ledger owns the clock: every event is stamped now, so the log is monotonic.
    log.push({ ...event, at_ms: nowMs });
  };

  const balances = new Map<string, Map<string, bigint>>(
    task.accounts.map((account) => [
      account.id,
      new Map(Object.entries(account.balances).map(([asset, amount]) => [asset, BigInt(amount)])),
    ]),
  );
  const accounts = new Map(task.accounts.map((account) => [account.id, account]));
  const edges = new Map(task.edges.map((edge) => [edge.id, edge]));
  // Policy allowlist: every leg must move between task accounts only.
  for (const edge of task.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!accounts.has(end.account))
        throw new Error(`task ${task.id}: leg ${edge.id} touches unknown account ${end.account}`);
    }
  }
  const faults: ReadonlyArray<ExecutionFault> = task.faults ?? [];
  const quotes = new Map<string, Quote>();
  const quoteCount = new Map<string, number>();
  const approvals = new Map<string, Approval>();
  const txs = new Map<string, Tx>();
  const attempts = new Map<string, number>();
  const submittedQuotes = new Set<string>();
  let committedUsdMicros = 0;
  /** Lowest total-spend cap the user has stated; no later approval may exceed it. */
  let userCapUsdMicros = Number.POSITIVE_INFINITY;

  const get = (account: string, asset: string): bigint => balances.get(account)?.get(asset) ?? 0n;
  const add = (account: string, asset: string, delta: bigint): void => {
    let assets = balances.get(account);
    if (assets === undefined) {
      assets = new Map();
      balances.set(account, assets);
    }
    assets.set(asset, (assets.get(asset) ?? 0n) + delta);
  };

  const gasValueUsdMicros = (accountId: string): number => {
    const account = accounts.get(accountId);
    if (account === undefined) return 0;
    const meta = task.assets[account.gas_asset];
    if (meta === undefined) return 0;
    return Number(
      (BigInt(account.gas_per_tx) * BigInt(meta.price_usd_micros)) / 10n ** BigInt(meta.decimals),
    );
  };

  const pendingTxForLeg = (leg: string): Tx | undefined => {
    for (const tx of txs.values())
      if (tx.quote.edge.id === leg && tx.status === "pending") return tx;
    return undefined;
  };

  const settle = (tx: Tx): void => {
    if (tx.status !== "pending") return;
    const edge = tx.quote.edge;
    const fault = faults.find(
      (candidate) =>
        (candidate.kind === "drop_tx" || candidate.kind === "revert_tx") &&
        candidate.leg === edge.id &&
        candidate.attempt === tx.attempt,
    );
    if (fault !== undefined) {
      add(edge.from.account, edge.from.asset, tx.quote.amountIn);
      const gasAsset = accounts.get(edge.from.account)?.gas_asset;
      if (fault.kind === "drop_tx") {
        // Never landed: funds and gas come back, nothing was spent.
        if (gasAsset !== undefined) add(edge.from.account, gasAsset, tx.gasPaid);
        committedUsdMicros -= tx.quote.costUsdMicros;
        tx.status = "dropped";
      } else {
        // Landed and reverted: funds come back, gas is burned and stays spent.
        const burned = gasValueUsdMicros(edge.from.account);
        committedUsdMicros -= tx.quote.costUsdMicros - burned;
        tx.status = "reverted";
        append({
          at_ms: nowMs,
          type: "fee_burned",
          leg: edge.id,
          tx_id: tx.id,
          cost_usd_micros: burned,
        });
      }
      return;
    }
    if (faults.some((candidate) => candidate.kind === "bridge_stuck" && candidate.leg === edge.id))
      return;
    if (nowMs < tx.submittedAtMs + edge.delay_s * 1000) return;
    add(edge.to.account, edge.to.asset, tx.quote.amountOut);
    tx.status = "confirmed";
  };

  return {
    listAccounts: Effect.sync(() =>
      task.accounts.map((account) => ({
        id: account.id,
        network: account.network,
        gas_asset: account.gas_asset,
        balances: Object.fromEntries(balances.get(account.id) ?? []),
      })),
    ),
    policy: Effect.succeed(task.limits),
    listLegs: Effect.succeed(
      task.edges.map(({ id, kind, from, to, delay_s }) => ({ id, kind, from, to, delay_s })),
    ),
    quote: (leg, amountIn) =>
      Effect.suspend(() => {
        const edge = edges.get(leg);
        if (edge === undefined) return reject("unknown_leg", `no route leg ${leg}`);
        if (amountIn <= 0n) return reject("invalid_amount", "amount_in must be positive");
        const n = (quoteCount.get(leg) ?? 0) + 1;
        quoteCount.set(leg, n);
        const outMeta = task.assets[edge.to.asset];
        if (outMeta === undefined)
          return reject("unpriced_asset", `${edge.to.asset} has no frozen price`);
        // A price move re-prices the protocol fee on re-quotes (cost_bps: 10000 = unchanged).
        const move = faults.find((fault) => fault.kind === "price_move" && fault.leg === leg);
        const feeUsdMicros =
          move?.kind === "price_move" && n > 1
            ? (BigInt(edge.fee_usd_micros) * BigInt(move.cost_bps)) / 10_000n
            : BigInt(edge.fee_usd_micros);
        // The fee is taken in the output asset at the frozen price; cost is derived from what is
        // actually deducted, so balances always reconcile with graded spend.
        const scale = 10n ** BigInt(outMeta.decimals);
        const price = BigInt(outMeta.price_usd_micros);
        // Round up: a positive fee smaller than one output unit still costs a whole unit, never zero.
        const feeUnits = (feeUsdMicros * scale + price - 1n) / price;
        const grossOut = (amountIn * BigInt(edge.rate_num)) / BigInt(edge.rate_den);
        if (grossOut <= feeUnits)
          return reject("amount_too_small", "output would not cover the fee");
        const netOut = grossOut - feeUnits;
        const costUsdMicros =
          Number((feeUnits * price) / scale) + gasValueUsdMicros(edge.from.account);
        const stale =
          n === 1 && faults.some((fault) => fault.kind === "stale_quote" && fault.leg === leg);
        const quote: Quote = {
          id: nextId("q"),
          edge,
          amountIn,
          amountOut: netOut,
          costUsdMicros,
          expiresAtMs: stale ? nowMs : nowMs + task.limits.quote_ttl_s * 1000,
        };
        quotes.set(quote.id, quote);
        append({
          at_ms: nowMs,
          type: "quote_received",
          leg,
          quote_id: quote.id,
          amount_in: fromBaseUnits(quote.amountIn),
          amount_out: fromBaseUnits(quote.amountOut),
          cost_usd_micros: quote.costUsdMicros,
          expires_at_ms: quote.expiresAtMs,
        });
        return Effect.succeed({
          quote_id: quote.id,
          amount_out: quote.amountOut,
          cost_usd_micros: quote.costUsdMicros,
          expires_at_ms: quote.expiresAtMs,
        });
      }),

    prepareRoute: (quoteIds) =>
      Effect.suspend(() => {
        if (quoteIds.length === 0) return reject("empty_route", "route needs at least one quote");
        let total = 0;
        const legs: QuotedLeg[] = [];
        for (const id of quoteIds) {
          const quote = quotes.get(id);
          if (quote === undefined) return reject("unknown_quote", `no quote ${id}`);
          if (nowMs >= quote.expiresAtMs)
            return reject("quote_expired", `quote ${id} expired; re-quote`);
          total += quote.costUsdMicros;
          legs.push({ edge: quote.edge, amountIn: quote.amountIn, amountOut: quote.amountOut });
        }
        const invalid = invalidRouteReason(legs, {
          task,
          balances: Object.fromEntries(
            [...balances].map(([account, assets]) => [account, Object.fromEntries(assets)]),
          ),
        });
        if (invalid !== undefined) return reject("invalid_route", invalid);
        const approvalId = nextId("appr");
        // Approval max is cumulative for the whole task: spend already committed (incl. burned fees)
        // plus this route's quoted cost, so a mid-route re-plan/reconfirm can still fit.
        const max = committedUsdMicros + total;
        approvals.set(approvalId, {
          quoteIds: new Set(quoteIds),
          order: [...quoteIds],
          next: 0,
          granted: false,
          maxCostUsdMicros: max,
        });
        append({
          at_ms: nowMs,
          type: "approval_requested",
          approval_id: approvalId,
          quote_ids: [...quoteIds],
          total_cost_usd_micros: total,
          max_cost_usd_micros: max,
        });
        return Effect.succeed({
          approval_id: approvalId,
          total_cost_usd_micros: total,
          max_cost_usd_micros: max,
        });
      }),

    submitLeg: (quoteId, approvalId) =>
      Effect.suspend(() => {
        const quote = quotes.get(quoteId);
        const leg = quote?.edge.id ?? "unknown";
        const refuse = (code: string, message: string) => {
          append({
            at_ms: nowMs,
            type: "submit_rejected",
            leg,
            quote_id: quoteId,
            approval_id: approvalId,
            reason: code,
          });
          return reject(code, message);
        };
        if (quote === undefined) return refuse("unknown_quote", `no quote ${quoteId}`);
        if (log.some((event) => event.type === "halt")) {
          return refuse("halted", "the route was halted; nothing more may execute");
        }
        if (submittedQuotes.has(quoteId))
          return refuse("quote_used", "this quote was already submitted; re-quote to retry");
        const approval = approvals.get(approvalId);
        if (approval === undefined || !approval.granted)
          return refuse("not_approved", "the user has not approved this route");
        if (!approval.quoteIds.has(quoteId))
          return refuse("not_covered", "quote is not part of the approved route");
        if (approval.order[approval.next] !== quoteId) {
          return refuse("out_of_order", "legs must execute in the approved order");
        }
        if (nowMs >= quote.expiresAtMs)
          return refuse("quote_expired", "quote expired; re-quote before submitting");
        if (pendingTxForLeg(leg) !== undefined)
          return refuse("leg_pending", "leg already has a pending transaction");
        if (committedUsdMicros + quote.costUsdMicros > approval.maxCostUsdMicros) {
          return refuse(
            "over_approval",
            "cost would exceed the approved maximum; ask the user to reconfirm",
          );
        }
        const source = accounts.get(quote.edge.from.account);
        if (source === undefined)
          return refuse("unknown_account", `no account ${quote.edge.from.account}`);
        const gas = BigInt(source.gas_per_tx);
        const needsGas = source.gas_asset === quote.edge.from.asset ? quote.amountIn + gas : gas;
        if (get(source.id, source.gas_asset) < needsGas)
          return refuse("insufficient_gas", `${source.id} lacks gas`);
        if (get(source.id, quote.edge.from.asset) < quote.amountIn) {
          return refuse("insufficient_funds", `${source.id} lacks ${quote.edge.from.asset}`);
        }

        submittedQuotes.add(quoteId);

        approval.next += 1;
        add(source.id, quote.edge.from.asset, -quote.amountIn);
        add(source.id, source.gas_asset, -gas);
        committedUsdMicros += quote.costUsdMicros;
        const attempt = (attempts.get(leg) ?? 0) + 1;
        attempts.set(leg, attempt);
        const tx: Tx = {
          id: nextId("tx"),
          quote,
          submittedAtMs: nowMs,
          attempt,
          gasPaid: gas,
          status: "pending",
        };
        txs.set(tx.id, tx);
        append({
          at_ms: nowMs,
          type: "submit",
          leg,
          quote_id: quoteId,
          approval_id: approvalId,
          tx_id: tx.id,
        });
        return Effect.succeed({ tx_id: tx.id });
      }),

    status: (txId) =>
      Effect.suspend(() => {
        if (log.some((event) => event.type === "halt")) {
          return reject(
            "halted",
            "the route was halted; report the current state instead of polling",
          );
        }
        const tx = txs.get(txId);
        if (tx === undefined) return reject("unknown_tx", `no transaction ${txId}`);
        const before = tx.status;
        // Only polling a real pending tx takes time; bogus or settled ids never move the clock.
        if (before === "pending") nowMs += POLL_INTERVAL_MS;
        settle(tx);
        append({
          at_ms: nowMs,
          type: "status_poll",
          leg: tx.quote.edge.id,
          tx_id: tx.id,
          status: tx.status,
        });
        if (before === "pending" && tx.status === "confirmed") {
          append({
            at_ms: nowMs,
            type: "receipt",
            leg: tx.quote.edge.id,
            tx_id: tx.id,
            cost_usd_micros: tx.quote.costUsdMicros,
          });
        }
        return Effect.succeed({ status: tx.status });
      }),

    readBalance: (account, asset) =>
      Effect.suspend(() => {
        if (!balances.has(account)) return reject("unknown_account", `no account ${account}`);
        const amount = get(account, asset);
        append({
          at_ms: nowMs,
          type: "balance_read",
          account,
          asset,
          amount: fromBaseUnits(amount),
        });
        return Effect.succeed({ amount });
      }),

    halt: (cause, reason, quoteIds) =>
      Effect.suspend(() => {
        if (log.some((event) => event.type === "halt"))
          return reject("halted", "a halt was already declared");
        for (const id of quoteIds)
          if (!quotes.has(id)) return reject("unknown_quote", `no quote ${id}`);
        append({
          at_ms: nowMs,
          type: "halt",
          cause,
          reason: reason.trim() === "" ? cause : reason,
          quote_ids: [...quoteIds],
        });
        return Effect.void;
      }),
    recordUserReply: (approvalId, reply, text) =>
      Effect.suspend(() => {
        append({
          at_ms: nowMs,
          type: "user_reply",
          ...(approvalId === undefined ? {} : { approval_id: approvalId }),
          reply,
          text,
        });
        if (reply.kind === "cap")
          userCapUsdMicros = Math.min(userCapUsdMicros, reply.max_cost_usd_micros);
        if (approvalId === undefined || (reply.kind !== "approve" && reply.kind !== "cap")) {
          return Effect.succeed<{ granted: boolean }>({ granted: false });
        }
        const approval = approvals.get(approvalId);
        if (approval === undefined) return reject("unknown_approval", `no approval ${approvalId}`);
        if (approval.granted)
          return reject("already_granted", `approval ${approvalId} was already granted`);
        // Authority comes only from the recorded reply. A cap is the user's limit on total spend: if the
        // request exceeds it, nothing is granted and the model must re-plan within the cap.
        if (approval.maxCostUsdMicros > userCapUsdMicros) {
          return Effect.succeed<{ granted: boolean }>({ granted: false });
        }
        const max = approval.maxCostUsdMicros;
        if (max > task.limits.max_total_cost_usd_micros) {
          return reject(
            "over_limit",
            "approval exceeds the task's hard cost limit; the signer refuses it",
          );
        }
        approval.granted = true;
        append({
          at_ms: nowMs,
          type: "approval_granted",
          approval_id: approvalId,
          max_cost_usd_micros: max,
        });
        return Effect.succeed<{ granted: boolean }>({ granted: true });
      }),
    recordFinalAnswer: (answer) =>
      Effect.sync(() =>
        append({
          at_ms: nowMs,
          type: "final_answer",
          text: answer.text,
          ...(answer.declared_outcome === undefined
            ? {}
            : { declared_outcome: answer.declared_outcome }),
          ...(answer.reported_balances === undefined
            ? {}
            : { reported_balances: answer.reported_balances }),
          ...(answer.in_transit_legs === undefined
            ? {}
            : { in_transit_legs: [...answer.in_transit_legs] }),
        }),
      ),
    recordInfraError: (source, message) =>
      Effect.sync(() => append({ at_ms: nowMs, type: "infra_error", source, message })),
    advance: (ms) =>
      Number.isSafeInteger(ms) && ms >= 0
        ? Effect.sync(() => {
            nowMs += ms;
          })
        : Effect.die(new RangeError(`advance(${ms}): time only moves forward by whole ms`)),
    events: () => log,
    finalState: (): FinalLedgerState => ({
      balances: Object.fromEntries(
        [...balances].map(([account, assets]) => [account, Object.fromEntries(assets)]),
      ),
      in_transit_legs: [...txs.values()]
        // Only bridges are "in transit"; a pending swap or deposit is just pending.
        .filter((tx) => tx.status === "pending" && tx.quote.edge.kind === "bridge")
        .map((tx) => tx.quote.edge.id),
    }),
  };
};
