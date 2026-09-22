import type { CanonicalRun, PrototypeFamily } from "./canonical";

/** Prefer matching test conditions and effort, then date. Never choose by result. */
export function preferredCompareRun(
  runs: readonly CanonicalRun[],
  modelId: string,
  family: PrototypeFamily,
  reference?: CanonicalRun,
  reasoning = reference?.configuration.reasoning,
): CanonicalRun | undefined {
  return runs
    .filter((run) => run.modelId === modelId && run.family === family)
    .sort(
      (a, b) =>
        Number(b.cohort.cohortId === reference?.cohort.cohortId) -
          Number(a.cohort.cohortId === reference?.cohort.cohortId) ||
        Number(b.configuration.reasoning === reasoning) -
          Number(a.configuration.reasoning === reasoning) ||
        b.startedAt.localeCompare(a.startedAt) ||
        a.runId.localeCompare(b.runId),
    )[0];
}
