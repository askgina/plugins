import type { CanonicalAttempt, CanonicalRun, PrototypeFamily } from "../canonical/canonical";
import type { LeaderboardModelRow } from "../canonical/selectors";
import { settingDisplayName } from "./client-labels";

export type TaskView = "conversation" | "checks" | "run";

export interface TaskSelection {
  readonly family: PrototypeFamily;
  readonly modelId?: string;
  readonly caseId?: string;
  readonly runId?: string;
  readonly attempt?: number;
  readonly view?: TaskView;
}

export function taskRoute(selection: TaskSelection): string {
  const query = new URLSearchParams({ category: selection.family });
  if (selection.modelId) query.set("model", selection.modelId);
  if (selection.caseId) query.set("task", selection.caseId);
  if (selection.runId) query.set("run", selection.runId);
  if (selection.attempt && Number.isInteger(selection.attempt) && selection.attempt > 0)
    query.set("attempt", String(selection.attempt));
  if (selection.view) query.set("view", selection.view);
  return `/tasks?${query.toString()}`;
}

/** A run from another model/category must never bind to this inspector. */
export function taskRunOptions(
  row: LeaderboardModelRow,
  family: PrototypeFamily,
  configurations: readonly LeaderboardModelRow[],
): readonly CanonicalRun[] {
  const runs = new Map<string, CanonicalRun>();
  for (const candidate of [...configurations, row]) {
    const run = candidate.runs[family];
    if (run && run.modelId === row.model.id && run.family === family) runs.set(run.runId, run);
  }
  return [...runs.values()].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId),
  );
}

export function attemptLabel(attempt: CanonicalAttempt | undefined): string {
  if (!attempt) return "Not recorded";
  if (attempt.execution === "timed_out") return "Timed out";
  if (attempt.execution === "runtime_failure") return "Run error";
  if (attempt.execution === "pending") return "Pending";
  if (attempt.execution === "unstarted") return "Not started";
  if (attempt.execution === "unknown") return "Unknown";
  return attempt.verdict === "pass"
    ? "Passed"
    : attempt.verdict === "fail"
      ? "Failed"
      : "Not graded";
}

export function taskSettingLabel(run: CanonicalRun): string {
  return settingDisplayName(run.configuration.reasoning, run.cohort.target);
}
