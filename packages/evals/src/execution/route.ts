import { Function } from "effect";
import type { ExecutionEdge, ExecutionTask } from "./contracts";

export interface QuotedLeg {
  readonly edge: ExecutionEdge;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

/** `balances`: account → asset → base units the route starts from (initial, or current mid-route). */
export interface RouteContext {
  readonly task: ExecutionTask;
  readonly balances: Readonly<Record<string, Readonly<Record<string, bigint>>>>;
}

/** Task starting balances as bigint, for validating a route before anything executed. */
export const initialBalances = (task: ExecutionTask): Record<string, Record<string, bigint>> =>
  Object.fromEntries(
    task.accounts.map((account) => [
      account.id,
      Object.fromEntries(
        Object.entries(account.balances).map(([asset, amount]) => [asset, BigInt(amount)]),
      ),
    ]),
  );

const key = (account: string, asset: string): string => `${account}\u0000${asset}`;

/**
 * Why an ordered list of quoted legs is not a feasible route for `task`, or undefined when it is.
 * Feasible: no duplicate legs; each leg spends at most what the starting balances plus
 * earlier legs' outputs leave available, including each leg's gas; every leg
 * feeds the target, directly or through later legs; the route delivers the target amount
 * within tolerance. Merging several sources (consolidation) is allowed.
 */
export const invalidRouteReason = Function.dual<
  (context: RouteContext) => (legs: ReadonlyArray<QuotedLeg>) => string | undefined,
  (legs: ReadonlyArray<QuotedLeg>, context: RouteContext) => string | undefined
>(2, (legs, { task, balances }) => {
  if (legs.length === 0) return "route has no legs";
  const available = new Map<string, bigint>();
  for (const [account, assets] of Object.entries(balances)) {
    for (const [asset, amount] of Object.entries(assets))
      available.set(key(account, asset), amount);
  }
  const seen = new Set<string>();
  for (const { edge, amountIn, amountOut } of legs) {
    if (seen.has(edge.id)) return `leg ${edge.id} appears twice`;
    seen.add(edge.id);
    const from = key(edge.from.account, edge.from.asset);
    const have = available.get(from) ?? 0n;
    if (amountIn > have)
      return `leg ${edge.id} spends ${amountIn} ${edge.from.asset} but only ${have} is available`;
    available.set(from, have - amountIn);
    // Each leg is a transaction: its source account must also pay gas.
    const account = task.accounts.find((candidate) => candidate.id === edge.from.account);
    if (account !== undefined) {
      const gasKey = key(account.id, account.gas_asset);
      const gas = available.get(gasKey) ?? 0n;
      if (gas < BigInt(account.gas_per_tx))
        return `leg ${edge.id} leaves ${account.id} without gas`;
      available.set(gasKey, gas - BigInt(account.gas_per_tx));
    }
    const to = key(edge.to.account, edge.to.asset);
    available.set(to, (available.get(to) ?? 0n) + amountOut);
  }

  // Walk backwards propagating required amounts: the target needs `minimum − starting balance`;
  // each leg must cover part of an outstanding requirement on its output, and in turn requires its
  // full input. Output beyond the requirement is waste; waste worth more than dust is rejected.
  const target = BigInt(task.target.amount);
  const minimum = target - (target * BigInt(task.target.tolerance_bps)) / 10_000n;
  const targetKey = key(task.target.account, task.target.asset);
  const starting = balances[task.target.account]?.[task.target.asset] ?? 0n;
  const required = new Map<string, bigint>([
    [targetKey, minimum > starting ? minimum - starting : 0n],
  ]);
  const dust = BigInt(task.dust_usd_micros);
  for (let index = legs.length - 1; index >= 0; index -= 1) {
    const { edge, amountIn, amountOut } = legs[index] as QuotedLeg;
    const to = key(edge.to.account, edge.to.asset);
    const need = required.get(to) ?? 0n;
    if (need === 0n) return `leg ${edge.id} does not contribute to the target`;
    const covered = amountOut < need ? amountOut : need;
    required.set(to, need - covered);
    const meta = task.assets[edge.to.asset];
    const wasteUsdMicros =
      meta === undefined
        ? undefined
        : ((amountOut - covered) * BigInt(meta.price_usd_micros)) / 10n ** BigInt(meta.decimals);
    if (
      to !== targetKey &&
      amountOut > covered &&
      (wasteUsdMicros === undefined || wasteUsdMicros > dust)
    ) {
      return `leg ${edge.id} produces ${amountOut - covered} ${edge.to.asset} the route never uses`;
    }
    const from = key(edge.from.account, edge.from.asset);
    required.set(from, (required.get(from) ?? 0n) + amountIn);
  }
  const short = required.get(targetKey) ?? 0n;
  return short === 0n ? undefined : `route leaves the target ${short} short`;
});
