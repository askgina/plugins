import { SCORED_FAMILIES, modelProfileRows, recordedBudgetLabel } from "../canonical/selectors";
import { Panel } from "./eval-ui";
import { RecordedResult, SummaryValue, rowKey } from "./leaderboard-results";
import { dollars, seconds } from "./results-ui";

export function ModelSettingResults({ modelId }: { modelId: string }) {
  const rows = modelProfileRows(modelId);
  if (!rows.length) return null;
  return (
    <Panel
      className="model-profile-results"
      title="Results by reasoning level"
      description="Latest recorded results for each setting, using the same scores as the leaderboard. Earlier runs remain in Run history."
    >
      <p className="model-profile-results-note">
        Completed means every trial finished processing, including execution errors. Graded counts
        trials with a pass or fail verdict. Overall averages Spot, Perps, and Predictions equally;
        settings with ungraded trials remain unranked. Select a category result to explore its tasks
        and chat transcripts.
      </p>
      <p className="model-profile-scroll-hint">Scroll across for category scores, time and cost.</p>
      <div
        className="model-profile-table-scroll"
        role="region"
        aria-label="Results by reasoning level"
        tabIndex={0}
      >
        <table className="eval-table model-profile-table model-profile-results-table">
          <thead>
            <tr>
              <th scope="col">Recorded setting</th>
              <th scope="col">Overall</th>
              {SCORED_FAMILIES.map((family) => (
                <th scope="col" key={family}>
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
              return (
                <tr
                  key={rowKey(row)}
                  data-setting={first.configuration.reasoning}
                  data-campaign={row.campaignId}
                >
                  <th scope="row">
                    <span className="model-profile-setting-label">{row.configurationLabel}</span>
                    <small>
                      {first.startedAt.slice(0, 10)} · {first.cohort.repetitions} reps
                    </small>
                    <small>{recordedBudgetLabel(runs)}</small>
                    {row.coverageLabel && <small>{row.coverageLabel}</small>}
                  </th>
                  <td>
                    <RecordedResult
                      runs={runs}
                      score={row.overall}
                      overall
                      reason={row.overallReason}
                    />
                  </td>
                  {SCORED_FAMILIES.map((family) => {
                    const run = row.runs[family];
                    return (
                      <td key={family}>
                        <RecordedResult
                          runs={run ? [run] : []}
                          score={row.scores[family]}
                          href={
                            run
                              ? `#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(run.runId)}&view=conversation`
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                  <td>
                    <SummaryValue metric={row.averageTime} format={seconds} />
                  </td>
                  <td>
                    <SummaryValue
                      metric={row.estimatedCost}
                      format={dollars}
                      cost
                      scope={row.coverageLabel}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
