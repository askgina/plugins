import {
  configurationLeaderboardRows,
  modelProfileRows,
  type LeaderboardModelRow,
} from "../canonical/selectors";

/** Select a complete recorded setting, never independently pick category runs. */
export function selectProfileSetting(
  modelId: string,
  requestedRunId?: string,
  rows: readonly LeaderboardModelRow[] = configurationLeaderboardRows(),
): LeaderboardModelRow | undefined {
  if (requestedRunId) {
    const requested = rows.find(
      (row) =>
        row.model.id === modelId &&
        Object.values(row.runs).some((run) => run.runId === requestedRunId),
    );
    if (requested) return requested;
  }
  const startedAt = (row: LeaderboardModelRow) =>
    Object.values(row.runs)
      .map((run) => run.startedAt)
      .sort()[0] ?? "";
  return [...modelProfileRows(modelId, rows)].sort(
    (a, b) =>
      startedAt(b).localeCompare(startedAt(a)) || (a.rowId ?? "").localeCompare(b.rowId ?? ""),
  )[0];
}
