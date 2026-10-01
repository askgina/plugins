import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";

import { fromBaseUnits, type ExecutionTask } from "../src/execution/contracts";
import { makeFakeLedger } from "../src/execution/fake-ledger";
import { gradeExecutionTrial } from "../src/execution/grader";
import { loadExecutionTasks } from "../src/execution/load-tasks";

const TASKS_DIR = fileURLToPath(new URL("../src/execution/tasks", import.meta.url));

/**
 * A correct, hand-checked route per published task: the legs in order with their input amounts.
 * Each must pass every hard check, proving the task is solvable within its targets and limits.
 */
const REFERENCE: Readonly<Record<string, ReadonlyArray<readonly [leg: string, amountIn: bigint]>>> =
  {
    "t1-base-eth-to-usdc": [["base-swap-eth-usdc", 200_000_000_000_000_000n]],
    "t1-mainnet-sell-99-eth": [["eth-swap-eth-usdc", 990_000_000_000_000_000n]],
    // Bridge the ETH, then swap on Base, leaving one transaction of ETH gas on Base.
    "t3-mainnet-eth-to-base-usdc": [
      ["eth-bridge-eth-base", 100_000_000_000_000_000n],
      ["base-swap-eth-usdc", 99_793_333_333_333_333n],
    ],
    // ETH -> WBTC; half bridged to Robinhood (plus gas) and swapped to ETH; half sold to USDC and bridged to Arbitrum (plus gas).
    "t3-mainnet-wbtc-split": [
      ["eth-swap-eth-wbtc", 100_000_000_000_000_000n],
      ["eth-bridge-wbtc-robinhood", 247_500n],
      ["eth-bridge-eth-robinhood", 1_000_000_000_000_000n],
      ["rh-swap-wbtc-eth", 246_666n],
      ["eth-swap-wbtc-usdc", 247_500n],
      ["eth-bridge-eth-arbitrum", 1_000_000_000_000_000n],
      ["eth-bridge-usdc-arbitrum", 145_500_000n],
    ],
    // Bridge nearly all ETH, then buy PEPE keeping one transaction of mainnet gas.
    "t3-robinhood-eth-to-mainnet-pepe": [
      ["rh-bridge-eth-mainnet", 199_980_000_000_000_000n],
      ["eth-swap-eth-pepe", 199_213_333_333_333_333n],
    ],
    // Sell MON keeping gas for the swap and the bridge, then bridge the USDC (mainnet already holds gas).
    "t3-monad-mon-to-mainnet-usdc": [
      ["monad-swap-mon-usdc", 999_980_000_000_000_000_000n],
      ["monad-bridge-usdc-mainnet", 499_890_000n],
    ],
  };

/** Quote the whole route, get it approved, then execute and verify each leg in order. */
const runReference = (task: ExecutionTask, plan: ReadonlyArray<readonly [string, bigint]>) =>
  Effect.gen(function* () {
    const ledger = makeFakeLedger(task);
    const quotes = [];
    for (const [leg, amountIn] of plan) quotes.push(yield* ledger.quote(leg, amountIn));
    const approval = yield* ledger.prepareRoute(quotes.map((quote) => quote.quote_id));
    yield* ledger.recordUserReply(approval.approval_id, { kind: "approve" }, "yes");
    for (const [index, quote] of quotes.entries()) {
      const { tx_id } = yield* ledger.submitLeg(quote.quote_id, approval.approval_id);
      let status = "pending";
      for (let polls = 0; status === "pending" && polls < 20; polls += 1) {
        status = (yield* ledger.status(tx_id)).status;
      }
      assert.strictEqual(status, "confirmed", `${plan[index]![0]} did not confirm`);
      const edge = task.edges.find((candidate) => candidate.id === plan[index]![0])!;
      yield* ledger.readBalance(edge.to.account, edge.to.asset);
    }
    const final = ledger.finalState();
    const balances = Object.fromEntries(
      Object.entries(final.balances).map(([account, assets]) => [
        account,
        Object.fromEntries(
          Object.entries(assets).map(([asset, amount]) => [asset, fromBaseUnits(amount)]),
        ),
      ]),
    );
    yield* ledger.recordFinalAnswer({
      text: "Done.",
      declared_outcome: { kind: "target_reached" },
      reported_balances: balances,
      in_transit_legs: [],
    });
    return gradeExecutionTrial(ledger.events(), task, final);
  });

describe("published execution tasks", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("every published task has a reference route, and each reference route passes", () =>
      Effect.gen(function* () {
        const tasks = yield* loadExecutionTasks(TASKS_DIR);
        assert.deepStrictEqual(tasks.map((task) => task.id).sort(), Object.keys(REFERENCE).sort());
        for (const task of tasks) {
          const grade = yield* runReference(task, REFERENCE[task.id]!).pipe(
            Effect.tapError((error) => Effect.logError(`${task.id}: ${error.message}`)),
          );
          assert.strictEqual(grade.status, "graded", task.id);
          if (grade.status === "graded") {
            assert.deepStrictEqual(
              grade.checks.filter((check) => !check.passed),
              [],
              `${task.id} reference route should pass`,
            );
          }
        }
      }),
    );

    it.effect("the signer refuses a route that sells 100% of the ETH in the 99% task", () =>
      Effect.gen(function* () {
        const tasks = yield* loadExecutionTasks(TASKS_DIR);
        const task = tasks.find((candidate) => candidate.id === "t1-mainnet-sell-99-eth")!;
        const error = yield* Effect.flip(
          runReference(task, [["eth-swap-eth-usdc", 999_700_000_000_000_000n]]),
        );
        assert.strictEqual(error.code, "invalid_route");
      }),
    );

    it.effect("keeping one extra MON gas payment is allowed; two is not", () =>
      Effect.gen(function* () {
        const tasks = yield* loadExecutionTasks(TASKS_DIR);
        const task = tasks.find((candidate) => candidate.id === "t3-monad-mon-to-mainnet-usdc")!;
        // Sell 999.97 MON (keeps 0.01 extra): 499.985 - 0.1 fee = 499.885 USDC, bridge -0.5 = 499.385.
        const one = yield* runReference(task, [
          ["monad-swap-mon-usdc", 999_970_000_000_000_000_000n],
          ["monad-bridge-usdc-mainnet", 499_885_000n],
        ]);
        assert.isTrue(one.status === "graded" && one.passed);
        const two = yield* Effect.flip(
          runReference(task, [
            ["monad-swap-mon-usdc", 999_960_000_000_000_000_000n],
            ["monad-bridge-usdc-mainnet", 499_880_000n],
          ]),
        );
        assert.strictEqual(two.code, "invalid_route");
      }),
    );

    it.effect("the signer refuses selling only 998 of 1,000 MON", () =>
      Effect.gen(function* () {
        const tasks = yield* loadExecutionTasks(TASKS_DIR);
        const task = tasks.find((candidate) => candidate.id === "t3-monad-mon-to-mainnet-usdc")!;
        const error = yield* Effect.flip(
          runReference(task, [
            ["monad-swap-mon-usdc", 998_000_000_000_000_000_000n],
            ["monad-bridge-usdc-mainnet", 498_900_000n],
          ]),
        );
        assert.strictEqual(error.code, "invalid_route");
      }),
    );

    it.effect("the signer also refuses underselling (98.8%) in the 99% task", () =>
      Effect.gen(function* () {
        const tasks = yield* loadExecutionTasks(TASKS_DIR);
        const task = tasks.find((candidate) => candidate.id === "t1-mainnet-sell-99-eth")!;
        const error = yield* Effect.flip(
          runReference(task, [["eth-swap-eth-usdc", 988_000_000_000_000_000n]]),
        );
        assert.strictEqual(error.code, "invalid_route");
      }),
    );
  });
});
