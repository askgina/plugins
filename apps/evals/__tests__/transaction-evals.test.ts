import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { TRANSACTION_TASKS } from "../src/lib/transaction-evals";

// The page's catalog must describe exactly the execution task files the harness runs.
const TASK_SOURCES: Readonly<Record<string, string>> = import.meta.glob(
  "../../../packages/evals/src/execution/tasks/*.yaml",
  { query: "?raw", import: "default", eager: true },
);

interface TaskFile {
  readonly id: string;
  readonly tier: string;
  readonly prompt: string;
  readonly expected_outcome: { readonly kind: string; readonly cause?: string };
  readonly user_script: { readonly confirm: { readonly kind: string } };
}

describe("Transactions page catalog", () => {
  test("lists exactly the task files, with their prompt, tier, user reply and outcome", () => {
    const fromFiles = Object.keys(TASK_SOURCES)
      .sort()
      .map((path) => {
        const task = parse(TASK_SOURCES[path] ?? "") as TaskFile;
        return {
          id: task.id,
          tier: task.tier,
          prompt: task.prompt,
          userReply: task.user_script.confirm.kind,
          expectedOutcome:
            task.expected_outcome.kind === "halt"
              ? `halt: ${task.expected_outcome.cause}`
              : task.expected_outcome.kind,
        };
      });
    const onPage = TRANSACTION_TASKS.map(({ id, tier, prompt, userReply, expectedOutcome }) => ({
      id,
      tier,
      prompt,
      userReply,
      expectedOutcome,
    })).sort((a, b) => a.id.localeCompare(b.id));
    expect(onPage).toEqual(fromFiles);
  });
});
