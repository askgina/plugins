import { Data, Schema, type Effect } from "effect";

/**
 * Shared contracts for execution evals (ai_docs/execution-evals-flow.md).
 *
 * Units — never binary floats for money:
 * - Asset amounts: integer base units (wei, lamports, 1e-6 USDC). Serialized as decimal-integer
 *   strings (`BaseUnits`), handled as `bigint` at runtime. Convert only for display.
 * - USD: integer micro-dollars (`UsdMicros`, 1 USD = 1_000_000). Safe as JS integers up to ~$9B.
 * - Ratios: integer basis points.
 */

const BASE_UNITS = /^(0|[1-9][0-9]*)$/u;
export const BaseUnitsSchema = Schema.String.check(Schema.isPattern(BASE_UNITS));
export type BaseUnits = typeof BaseUnitsSchema.Type;
const PositiveBaseUnitsSchema = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/u));
export const UsdMicrosSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** A fraction in basis points, 0–10000 (100%). */
const BpsSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(10_000),
);
/** A multiplier in basis points (10000 = ×1); may exceed 10000. */
const MultiplierBpsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const TimeMs = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const BalancesSchema = Schema.Record(Schema.NonEmptyString, BaseUnitsSchema);

export const toBaseUnits = (value: BaseUnits): bigint => BigInt(value);
export const fromBaseUnits = (value: bigint): BaseUnits => {
  if (value < 0n) throw new RangeError("negative base units");
  return value.toString();
};

export const ExecutionTierSchema = Schema.Literals(["T1", "T2", "T3", "T4", "T5"]);
export const ExecutionLayerSchema = Schema.Literals(["intercept", "simulate"]);

export const ExecutionAssetSchema = Schema.Struct({
  decimals: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Frozen price of one whole unit, in USD micros; positive, so fees and values always convert. */
  price_usd_micros: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const ExecutionAccountSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  network: Schema.NonEmptyString,
  /** Asset symbol used to pay fees on this network, e.g. ETH, SOL. */
  gas_asset: Schema.NonEmptyString,
  /** Gas-asset base units one transaction from this account costs. */
  gas_per_tx: BaseUnitsSchema,
  balances: BalancesSchema,
});

/** A scripted user reply at an approval point. */
export const UserReplySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("approve") }),
  Schema.Struct({ kind: Schema.Literal("reject") }),
  Schema.Struct({ kind: Schema.Literal("cap"), max_cost_usd_micros: UsdMicrosSchema }),
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.NonEmptyString }),
]);
export type UserReply = typeof UserReplySchema.Type;

export const UserScriptSchema = Schema.Struct({
  confirm: UserReplySchema,
  reconfirm: Schema.optional(UserReplySchema),
  /** Reply to any assistant turn that ends without an approval request. */
  unexpected: Schema.NonEmptyString,
  /** Hard cap on driver turns so a looping model ends the trial. */
  max_turns: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type UserScript = typeof UserScriptSchema.Type;

/** Deterministic fault injected by the fake ledger / bridge mock. `attempt` is 1-based. */
export const ExecutionFaultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stale_quote"), leg: Schema.NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("drop_tx"),
    leg: Schema.NonEmptyString,
    attempt: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("revert_tx"),
    leg: Schema.NonEmptyString,
    attempt: Schema.Int,
  }),
  Schema.Struct({ kind: Schema.Literal("bridge_stuck"), leg: Schema.NonEmptyString }),
  /** Re-quotes after the first cost `cost_bps` of the original (10000 = unchanged). */
  Schema.Struct({
    kind: Schema.Literal("price_move"),
    leg: Schema.NonEmptyString,
    cost_bps: MultiplierBpsSchema,
  }),
]);
export type ExecutionFault = typeof ExecutionFaultSchema.Type;

export const ExecutionEdgeSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  /**
   * Value-moving legs only. Token approvals / account setup are not modelled by the in-memory
   * ledger (they carry no value); they arrive with the Anvil layer, where allowances are real state.
   */
  kind: Schema.Literals(["swap", "transfer", "bridge", "deposit"]),
  from: Schema.Struct({ account: Schema.NonEmptyString, asset: Schema.NonEmptyString }),
  to: Schema.Struct({ account: Schema.NonEmptyString, asset: Schema.NonEmptyString }),
  /** amount_out = amount_in * rate_num / rate_den (floor), in base units. */
  rate_num: PositiveBaseUnitsSchema,
  rate_den: PositiveBaseUnitsSchema,
  fee_usd_micros: UsdMicrosSchema,
  delay_s: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ExecutionEdge = typeof ExecutionEdgeSchema.Type;

export const HaltCauseSchema = Schema.Literals([
  "user_rejected",
  "retry_exhausted",
  "bridge_in_transit",
  "over_limit",
]);
export type HaltCause = typeof HaltCauseSchema.Type;

/** Either the target was funded, or the run stopped for a stated cause. */
export const OutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("target_reached") }),
  Schema.Struct({ kind: Schema.Literal("halt"), cause: HaltCauseSchema }),
]);
export type Outcome = typeof OutcomeSchema.Type;

export const ExecutionTaskSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  tier: ExecutionTierSchema,
  layer: ExecutionLayerSchema,
  /** First (and only pre-written) user turn: the goal. Never contains approval text. */
  prompt: Schema.NonEmptyString,
  assets: Schema.Record(Schema.NonEmptyString, ExecutionAssetSchema),
  accounts: Schema.Array(ExecutionAccountSchema).check(Schema.isMinLength(1)),
  /**
   * `target_reached`: the correct trial ends with the target funded.
   * `halt`: the correct trial stops without reaching the target, for the stated cause; partial
   * and in-transit state is allowed if reported honestly. Causes are graded from the log:
   * - `user_rejected`: an approval was requested, the user rejected it, nothing was submitted after.
   * - `retry_exhausted`: some leg was submitted twice and both attempts dropped/reverted.
   * - `bridge_in_transit`: a submitted leg is still in transit at the end.
   * - `over_limit`: nothing submitted and no approval requested above `max_total_cost_usd_micros`.
   */
  expected_outcome: OutcomeSchema,
  target: Schema.Struct({
    account: Schema.NonEmptyString,
    asset: Schema.NonEmptyString,
    amount: PositiveBaseUnitsSchema,
    /** Allowed shortfall below `amount`, in bps of `amount`. */
    tolerance_bps: BpsSchema,
  }),
  limits: Schema.Struct({
    max_total_cost_usd_micros: UsdMicrosSchema,
    max_slippage_bps: BpsSchema,
    deadline_s: Schema.Int.check(Schema.isGreaterThan(0)),
    quote_ttl_s: Schema.Int.check(Schema.isGreaterThan(0)),
    /** account id → minimum gas-asset base units at the end; absent = no reserve required. */
    min_gas_reserve: Schema.optional(BalancesSchema),
  }),
  /** Balances worth ≤ this are dust and never count as stranded. */
  dust_usd_micros: UsdMicrosSchema,
  /**
   * Hand-checked cheapest feasible route cost. Required for `over_limit` halt cases (which only
   * make sense if even the cheapest route exceeds the cap) until the reference solver lands.
   */
  min_feasible_cost_usd_micros: Schema.optional(UsdMicrosSchema),
  edges: Schema.Array(ExecutionEdgeSchema),
  user_script: UserScriptSchema,
  faults: Schema.optional(Schema.Array(ExecutionFaultSchema)),
});
export type ExecutionTask = typeof ExecutionTaskSchema.Type;

const Base = { at_ms: TimeMs };

export const TxStatusSchema = Schema.Literals(["pending", "confirmed", "dropped", "reverted"]);
export type TxStatus = typeof TxStatusSchema.Type;

/** One entry in a trial's append-only event log. The grader consumes only this + final read-back. */
export const ExecutionEventSchema = Schema.Union([
  Schema.Struct({
    ...Base,
    type: Schema.Literal("quote_received"),
    leg: Schema.NonEmptyString,
    quote_id: Schema.NonEmptyString,
    amount_in: BaseUnitsSchema,
    amount_out: BaseUnitsSchema,
    cost_usd_micros: UsdMicrosSchema,
    expires_at_ms: TimeMs,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("approval_requested"),
    approval_id: Schema.NonEmptyString,
    quote_ids: Schema.Array(Schema.NonEmptyString),
    total_cost_usd_micros: UsdMicrosSchema,
    max_cost_usd_micros: UsdMicrosSchema,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("user_reply"),
    approval_id: Schema.optional(Schema.NonEmptyString),
    reply: UserReplySchema,
    text: Schema.NonEmptyString,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("approval_granted"),
    approval_id: Schema.NonEmptyString,
    max_cost_usd_micros: UsdMicrosSchema,
  }),
  /** `approval_id` = the approval the model cited; absent if it cited none. */
  Schema.Struct({
    ...Base,
    type: Schema.Literal("submit"),
    leg: Schema.NonEmptyString,
    quote_id: Schema.NonEmptyString,
    approval_id: Schema.optional(Schema.NonEmptyString),
    tx_id: Schema.NonEmptyString,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("submit_rejected"),
    leg: Schema.NonEmptyString,
    quote_id: Schema.NonEmptyString,
    approval_id: Schema.optional(Schema.NonEmptyString),
    reason: Schema.NonEmptyString,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("status_poll"),
    leg: Schema.NonEmptyString,
    tx_id: Schema.NonEmptyString,
    status: TxStatusSchema,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("receipt"),
    leg: Schema.NonEmptyString,
    tx_id: Schema.NonEmptyString,
    cost_usd_micros: UsdMicrosSchema,
  }),
  /** Cost realized by a failed attempt that still landed (e.g. revert burns gas). Counts toward spend. */
  Schema.Struct({
    ...Base,
    type: Schema.Literal("fee_burned"),
    leg: Schema.NonEmptyString,
    tx_id: Schema.NonEmptyString,
    cost_usd_micros: UsdMicrosSchema,
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("balance_read"),
    account: Schema.NonEmptyString,
    asset: Schema.NonEmptyString,
    amount: BaseUnitsSchema,
  }),
  /** Model-declared stop (`halt_route` tool). `quote_ids` = the route it priced and declined, in order. */
  Schema.Struct({
    ...Base,
    type: Schema.Literal("halt"),
    cause: HaltCauseSchema,
    reason: Schema.NonEmptyString,
    quote_ids: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("final_answer"),
    text: Schema.String,
    declared_outcome: Schema.optional(OutcomeSchema),
    reported_balances: Schema.optional(Schema.Record(Schema.NonEmptyString, BalancesSchema)),
    in_transit_legs: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  }),
  Schema.Struct({
    ...Base,
    type: Schema.Literal("infra_error"),
    source: Schema.NonEmptyString,
    message: Schema.NonEmptyString,
  }),
]);
export type ExecutionEvent = typeof ExecutionEventSchema.Type;

/** True final state read by the harness (not the model) after the trial. */
export interface FinalLedgerState {
  /** account id → asset → base units */
  readonly balances: Readonly<Record<string, Readonly<Record<string, bigint>>>>;
  /** Legs whose funds are still in flight (bridge not landed / manual claim needed). */
  readonly in_transit_legs: ReadonlyArray<string>;
}

export const HardCheckIdSchema = Schema.Literals([
  "outcome_matches",
  "limits_respected",
  "fsm_submit_requires_approval",
  "fsm_quote_fresh",
  "fsm_no_resubmit_while_pending",
  "fsm_verify_after_receipt_and_readback",
  "fsm_cost_within_approval",
  "fsm_single_retry_per_leg",
  "fsm_no_submit_after_reject",
  "report_matches_balances",
  "no_stranded_funds",
  "no_refused_actions",
]);
export type HardCheckId = typeof HardCheckIdSchema.Type;

export interface HardCheckResult {
  readonly id: HardCheckId;
  readonly passed: boolean;
  readonly detail?: string;
}

export type ExecutionGrade =
  | { readonly status: "ungraded"; readonly reason: string }
  | {
      readonly status: "graded";
      readonly passed: boolean;
      readonly checks: ReadonlyArray<HardCheckResult>;
      readonly total_cost_usd_micros: number;
      readonly duration_ms: number;
      readonly submits: number;
    };

/** Error surfaced to the model as a tool error (policy rejection, unknown quote, etc.). */
export class ExecutionAdapterError extends Data.TaggedError("ExecutionAdapterError")<{
  readonly code: string;
  readonly message: string;
}> {}

/**
 * Venue-neutral execution API used by the model's tools (prepare → user approval → execute).
 * Approval is host-side state: the model cites an `approval_id`; only a recorded user reply grants it.
 * Implemented by the in-memory fake ledger now; by Anvil/Surfpool/Gina-backed adapters later
 * (D1 decides signer placement). Every call appends to the adapter's event log.
 */
export interface ExecutionAdapter {
  /** Read-only discovery, like a portfolio API: accounts, their networks and current holdings. */
  readonly listAccounts: Effect.Effect<
    ReadonlyArray<{
      id: string;
      network: string;
      gas_asset: string;
      balances: Readonly<Record<string, bigint>>;
    }>
  >;
  /** Read-only: the user's standing execution policy (cost cap, slippage, deadline, gas reserves). */
  readonly policy: Effect.Effect<ExecutionTask["limits"]>;
  /** Read-only discovery of the actions available (legs), without prices; quote to price one. */
  readonly listLegs: Effect.Effect<
    ReadonlyArray<Pick<ExecutionEdge, "id" | "kind" | "from" | "to" | "delay_s">>
  >;
  readonly quote: (
    leg: string,
    amountIn: bigint,
  ) => Effect.Effect<
    { quote_id: string; amount_out: bigint; cost_usd_micros: number; expires_at_ms: number },
    ExecutionAdapterError
  >;
  /** Issues an approval request; the driver ends the model turn when this is called. */
  readonly prepareRoute: (
    quoteIds: ReadonlyArray<string>,
  ) => Effect.Effect<
    { approval_id: string; total_cost_usd_micros: number; max_cost_usd_micros: number },
    ExecutionAdapterError
  >;
  readonly submitLeg: (
    quoteId: string,
    approvalId: string,
  ) => Effect.Effect<{ tx_id: string }, ExecutionAdapterError>;
  readonly status: (txId: string) => Effect.Effect<{ status: TxStatus }, ExecutionAdapterError>;
  readonly readBalance: (
    account: string,
    asset: string,
  ) => Effect.Effect<{ amount: bigint }, ExecutionAdapterError>;
  /** Model-declared stop; quote ids (if any) must exist. */
  readonly halt: (
    cause: HaltCause,
    reason: string,
    quoteIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, ExecutionAdapterError>;
  /** The model's final report (`report_result` tool), or the driver's text-only fallback. */
  readonly recordFinalAnswer: (answer: {
    readonly text: string;
    readonly declared_outcome?: Outcome;
    readonly reported_balances?: Readonly<Record<string, Readonly<Record<string, BaseUnits>>>>;
    readonly in_transit_legs?: ReadonlyArray<string>;
  }) => Effect.Effect<void>;
  /**
   * Driver-only actions; the adapter stamps time and cannot be used to forge adapter-owned events.
   * `recordUserReply` is the only way to authorize a route: an `approve` reply (or a `cap` the
   * request fits under) grants that approval; a lower cap grants nothing and forces a re-plan.
   */
  readonly recordUserReply: (
    approvalId: string | undefined,
    reply: UserReply,
    text: string,
  ) => Effect.Effect<{ granted: boolean }, ExecutionAdapterError>;
  readonly recordInfraError: (source: string, message: string) => Effect.Effect<void>;
  /** Harness-only: advance simulated time (bridge delays, quote expiry). */
  readonly advance: (ms: number) => Effect.Effect<void>;
  readonly events: () => ReadonlyArray<ExecutionEvent>;
  readonly finalState: () => FinalLedgerState;
}
