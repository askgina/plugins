import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";

import { TRANSACTION_TASKS } from "../../../apps/evals/src/lib/transaction-evals";
import { loadExecutionTasks } from "../src/execution/load-tasks";

const TASKS_DIR = fileURLToPath(new URL("../src/execution/tasks", import.meta.url));

describe("Transactions page catalog", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("lists exactly the task files, with their prompt, tier, user reply and outcome", () =>
      Effect.gen(function* () {
        const tasks = yield* loadExecutionTasks(TASKS_DIR);
        const fromFiles = tasks.map((task) => ({
          id: task.id,
          tier: task.tier,
          prompt: task.prompt,
          userReply: task.user_script.confirm.kind,
          expectedOutcome:
            task.expected_outcome.kind === "halt"
              ? `halt: ${task.expected_outcome.cause}`
              : task.expected_outcome.kind,
        }));
        const onPage = TRANSACTION_TASKS.map(
          ({ id, tier, prompt, userReply, expectedOutcome }) => ({
            id,
            tier,
            prompt,
            userReply,
            expectedOutcome,
          }),
        ).sort((a, b) => a.id.localeCompare(b.id));
        assert.deepStrictEqual(onPage, fromFiles);
      }),
    );
  });
});
