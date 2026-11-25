import {
  SCORED_FAMILIES,
  modelProfileRows,
  recordedBudgetLabel,
  type LeaderboardModelRow,
} from "../canonical/selectors";
import { CompactScore, rowKey } from "./leaderboard-results";

export function ModelSettingResults({
  modelId,
  selectedRowId,
  onSelectSetting,
}: {
  modelId: string;
  selectedRowId?: string;
  onSelectSetting?: (row: LeaderboardModelRow) => void;
}) {
  const rows = modelProfileRows(modelId);
  if (!rows.length) return null;
  return (
    <section className="model-profile-results mp-settings" aria-labelledby="mp-settings-heading">
      <div className="mp-section-heading">
        <div>
          <h2 id="mp-settings-heading">Results by reasoning level</h2>
          <p>Latest recorded setting per reasoning level. Select one to update the overview.</p>
        </div>
        <span>{rows.length} settings</span>
      </div>
      <table className="mp-settings-table">
        <caption className="results-sr-only">
          Success rates and completed-attempt time and estimated cost. Earlier campaigns remain in
          Run history. Categories have equal weight in Overall.
        </caption>
        <colgroup>
          <col className="mp-setting-column" />
          <col />
          <col data-family="Spot" />
          <col data-family="Perps" />
          <col data-family="Predictions" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Recorded setting</th>
            <th scope="col">Overall</th>
            {SCORED_FAMILIES.map((family) => (
              <th scope="col" key={family} data-family={family}>
                {family}
              </th>
            ))}
            <th scope="col">Avg. time</th>
            <th scope="col">Est. cost / task</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const runs = Object.values(row.runs);
            const first = runs[0]!;
            const selected = rowKey(row) === selectedRowId;
            return (
              <tr
                key={rowKey(row)}
                data-setting={first.configuration.reasoning}
                data-campaign={row.campaignId}
                data-selected={selected}
              >
                <th scope="row">
                  {onSelectSetting ? (
                    <button
                      type="button"
                      className="mp-setting-choice"
                      aria-pressed={selected}
                      onClick={() => onSelectSetting(row)}
                    >
                      {row.configurationLabel}
                      <span aria-hidden="true">{selected ? "Selected" : "View"}</span>
                    </button>
                  ) : (
                    <span>{row.configurationLabel}</span>
                  )}
                  <small>{recordedBudgetLabel(runs)}</small>
                  <span className="results-sr-only">
                    {first.startedAt.slice(0, 10)} · {first.cohort.repetitions} reps{" "}
                    {row.coverageLabel}
                  </span>
                </th>
                <td>
                  <CompactScore row={row} />
                </td>
                {SCORED_FAMILIES.map((family) => {
                  const run = row.runs[family];
                  return (
                    <td key={family} data-family={family}>
                      {run ? (
                        <a
                          className="mp-category-score-link"
                          href={`#/tasks?category=${family}&model=${modelId}&run=${encodeURIComponent(run.runId)}&view=conversation`}
                        >
                          <CompactScore row={row} metric={family} />
                        </a>
                      ) : (
                        <CompactScore row={row} metric={family} />
                      )}
                    </td>
                  );
                })}
                <td>
                  <CompactScore row={row} metric="time" />
                </td>
                <td>
                  <CompactScore row={row} metric="cost" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mp-scope-note">
        Overall averages Spot, Perps and Predictions equally. Terminal errors earn zero credit;
        unfinished processing has no score. Time and cost exclude execution errors. Different
        clients and budgets can affect comparisons.
      </p>
    </section>
  );
}
