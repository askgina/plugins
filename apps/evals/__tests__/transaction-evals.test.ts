import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { configurationLeaderboardRows } from "../src/canonical/selectors";
import { TRANSACTION_TASKS } from "../src/lib/transaction-evals";
import {
  TRANSACTION_RUNS,
  transactionRunForRow,
  transactionScore,
} from "../src/lib/transaction-results";

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

describe("transaction run ownership", () => {
  test("exactly one Grok 4.7 row owns the low run; other settings and campaigns show none", () => {
    const grokRows = configurationLeaderboardRows().filter((row) => row.model.id === "grok-4-7");
    const reasonings = new Set(
      grokRows.map((row) => Object.values(row.runs)[0]?.configuration.reasoning),
    );
    expect(reasonings).toEqual(new Set(["low", "medium", "high", "xhigh"]));
    // Low exists in more than one campaign; only the owning setting row carries the result.
    expect(
      grokRows.filter((row) => Object.values(row.runs)[0]?.configuration.reasoning === "low")
        .length,
    ).toBeGreaterThan(1);
    const owners = grokRows.filter((row) => transactionRunForRow(row) !== undefined);
    expect(owners.map((row) => row.runs.Spot?.runId)).toEqual(["grok47-recovery-low-spot-1"]);
  });
});

describe("transaction score", () => {
  const base = TRANSACTION_RUNS[0]!;
  const trial = (taskId: string, repetition: number, passed: boolean) => ({
    taskId,
    repetition,
    passed,
    failedChecks: [],
    durationMs: 1000,
    spendUsdMicros: 0,
    identityVerified: true,
  });
  const ids = TRANSACTION_TASKS.map((task) => task.id);
  const full = ids.flatMap((id, index) => [1, 2, 3].map((rep) => trial(id, rep, index !== 1)));

  test("averages task pass rates equally (the task is the scoring unit)", () => {
    const n = ids.length;
    // Every task passes 3/3 except task B at 0/3.
    expect(transactionScore({ ...base, trials: full })).toBeCloseTo((n - 1) / n);
    // Task B at 1/3 counts as one third of one task, not as one extra pooled attempt.
    const uneven = full.map((entry) =>
      entry.taskId === ids[1] && entry.repetition === 1 ? { ...entry, passed: true } : entry,
    );
    expect(transactionScore({ ...base, trials: uneven })).toBeCloseTo((n - 1 + 1 / 3) / n);
  });

  test("has no score when an attempt is missing, duplicated, or its identity is unverified", () => {
    const missing = full.filter((entry) => !(entry.taskId === ids[0] && entry.repetition === 3));
    const duplicated = [...missing, trial(ids[0]!, 2, true)];
    const unverified = full.map((entry, index) =>
      index === 0 ? { ...entry, identityVerified: false } : entry,
    );
    expect(transactionScore({ ...base, trials: missing })).toBeNull();
    expect(transactionScore({ ...base, trials: duplicated })).toBeNull();
    expect(transactionScore({ ...base, trials: unverified })).toBeNull();
  });

  test("the published Grok 4.7 Low run scores 2 of 6 tasks", () => {
    expect(transactionScore(base)).toBeCloseTo(2 / 6);
  });
});
