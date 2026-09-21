import { PageShell } from "../components/eval-ui";
import gradingReceiptUrl from "../results/2026-09-21/regrade/receipt.json?url";
import { ResultsHeader, RunDetails } from "../components/results-ui";
import {
  CATALOG_LABEL,
  CATALOG_SHA_31_TOOLS,
  canonicalCampaigns,
  GRADER_SHA256,
  SUITE_IDS,
  SUITE_SHA256,
} from "../canonical/canonical";
import {
  SCORED_FAMILIES,
  caseDefinitionsForFamily,
  getModel,
  measuredRepresentativeRuns,
} from "../canonical/selectors";

export function MethodologyPage() {
  const runs = measuredRepresentativeRuns();
  const campaigns = canonicalCampaigns.filter((campaign) =>
    runs.some((run) => run.campaignId === campaign.campaignId),
  );
  const repetitions = [...new Set(runs.map((run) => run.cohort.repetitions))];
  const timeouts = [
    ...new Set(
      runs.flatMap((run) => {
        const timeout =
          run.timeoutMs ??
          campaigns.find((campaign) => campaign.campaignId === run.campaignId)?.timeoutMs;
        return timeout == null ? [] : [timeout / 1000];
      }),
    ),
  ].sort((a, b) => a - b);
  return (
    <PageShell active="methodology">
      <div className="eval-container results-page">
        <ResultsHeader
          title="How the evaluations work"
          description="What we ask, what we check, and how the results are calculated."
        />
        <div className="method-content">
          <p className="method-limits">
            These results measure tool use and task completion. They do not measure final-answer
            accuracy or trading returns. Samples are small, and models used different clients.
          </p>
          <ol className="method-steps">
            <li>
              <h2>Choose the tasks</h2>
              <p>
                We test three categories: spot markets ({caseDefinitionsForFamily("Spot").length}{" "}
                tasks), perpetual futures ({caseDefinitionsForFamily("Perps").length}), and
                prediction markets ({caseDefinitionsForFamily("Predictions").length}). Each task has
                a fixed prompt and rules for the tools the model should use.
              </p>
              <p>
                The {caseDefinitionsForFamily("Portfolio").length} Portfolio tasks are published but
                have not been evaluated. They do not contribute to Overall.{" "}
                <a href="#/tasks">Read the prompts ↗</a>
              </p>
            </li>
            <li>
              <h2>
                Run each prompt{" "}
                {repetitions.length === 1 && repetitions[0] === 3 ? "three times" : "repeatedly"}
              </h2>
              <p>
                Each attempt starts a fresh conversation with access to read-only financial tools.
                The current runs use {repetitions.join(" or ")} attempts per task and a{" "}
                {timeouts.join(" or ")}-second timeout per attempt.
              </p>
              <details className="results-accordion">
                <summary>Clients, settings, and run dates</summary>
                <div>
                  <p>
                    Runs use several clients, including native Muse and native Devin. The
                    leaderboard shows them together, but these results reflect the model and its
                    client setup, not an isolated model-only comparison.
                  </p>
                  {campaigns.map((campaign) => (
                    <div className="method-record" key={campaign.campaignId}>
                      <h3>{campaign.harness}</h3>
                      <p>
                        {campaign.date} · {campaign.repetitions} attempts per task ·{" "}
                        {campaign.timeoutMs === null
                          ? "route-specific timeouts"
                          : `${campaign.timeoutMs / 1000}s timeout`}
                      </p>
                      <ul>
                        {runs
                          .filter((run) => run.campaignId === campaign.campaignId)
                          .map((run) => (
                            <li key={run.runId}>
                              {getModel(run.modelId)?.name ?? run.modelId}, {run.family}:{" "}
                              {run.configuration.reasoning ?? "unspecified"} reasoning;{" "}
                              <code>{run.configuration.configurationId}</code>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            </li>
            <li>
              <h2>Check what the model did</h2>
              <p>
                An attempt passes when it satisfies every applicable grading check: calling the
                required tools, supplying the required arguments, completing without errors, and
                obeying the task’s restrictions.
              </p>
              <p>
                Some tasks require one tool call; others require calls in a particular order. The
                task’s grading criteria explain those requirements. Final-answer accuracy is not
                scored. <a href="#/tasks">See task-specific rules ↗</a>
              </p>
              <p>
                Prediction-market discovery permits one to three distinct, nonempty searches using
                the required search tool, with the original request as the first query. The
                bounded-prediction-search-v1 revision applies this routing rule consistently to
                retained 16 and 21 September attempts across all models. Argument, restriction, and
                completion checks retain their recorded outcomes. Search relevance, whether a
                follow-up was necessary, and answer accuracy are not scored by this routing check.
                Original grades and transcripts are preserved; changed attempts show the original
                verdict in Checks. Provider errors remain ungraded.{" "}
                <a href={gradingReceiptUrl} download>
                  Download the grading revision ↗
                </a>
              </p>
            </li>
            <li>
              <h2>Calculate the scores</h2>
              <div className="method-formulas">
                <p>
                  <strong>Category score</strong> = passed attempts ÷ started attempts × 100
                </p>
                <p>
                  <strong>Overall</strong> = (Spot score + Perps score + Predictions score) ÷ 3
                </p>
              </div>
              <p>
                For example, category scores of 90%, 60%, and 30% give an Overall score of 60%. Each
                category contributes one third, regardless of its number of tasks. Calculations use
                full precision; the table displays one decimal place.
              </p>
              <p>
                Timeouts and run errors count as started attempts but remain unscored. We show a
                category percentage only when dispatch and grading are complete. Otherwise, the
                results are counts-only and excluded from quality rankings. If any category is
                missing or incompletely graded, Overall is unavailable. An unavailable value is
                never treated as zero. The leaderboard shows every recorded model, reasoning
                setting, and campaign as a separate row; identical attempts reused across campaigns
                appear once. Complete and incomplete results remain visible together; campaign and
                grading filters narrow the view explicitly. Each row retains its category outcomes,
                timing and cost sample counts, timeout budget, repetitions, source hashes, and links
                to individual attempts. Sorting does not make different clients, reasoning settings,
                or time budgets equivalent.
              </p>
              <p>
                Sorting describes these observed results. It does not establish statistical
                significance or change the exported pilot runs’ unranked status.
              </p>
            </li>
            <li>
              <h2>Report time and estimated cost</h2>
              <p>
                <strong>Average time</strong> is the sum of completed-attempt durations divided by
                the number of completed attempts across all three categories. It excludes timeouts
                and run errors. If any completed attempt lacks a timing, we leave the full-suite
                mean unavailable instead of averaging medians. Incomplete grading does not hide
                retained timings: expanded run details show the measured sample count and how many
                started attempts were excluded.
              </p>
              <p>
                <strong>Estimated cost per task</strong> uses retained native usage and divides by
                completed attempts with cost records. Native sessions retain per-message USD
                estimates, including cache reads and writes. Devin uses its retained model catalogue
                rates and cached-token totals; that catalogue explicitly lists SWE-2 as Free. Muse
                uses{" "}
                <a
                  href="https://dev.meta.ai/docs/pricing-rate-limits"
                  target="_blank"
                  rel="noreferrer"
                >
                  Meta’s standard API rates
                </a>{" "}
                checked September 18: $1.25 per million uncached input tokens, $0.15 cached input,
                and $4.25 output. These are API-equivalent estimates, not Muse subscription charges.
                The records are matched to the published model, source summary, and attempt token
                totals. Graded failures are included; timeouts and run errors are excluded. Older
                runs use recorded tokens and their listed price source. No estimate is a billing
                receipt.
              </p>
              <p>
                Overall scores and average time need data from all three categories. Cost may cover
                a smaller recorded population, labelled with the available categories, such as Spot
                only. Open a model’s row to see sample counts, exclusions, category timing
                percentiles, and pricing sources.
              </p>
            </li>
          </ol>
          <div className="method-reference">
            <details className="results-accordion">
              <summary>Run records</summary>
              <div>
                {campaigns.map((campaign) => (
                  <section className="method-record" key={campaign.campaignId}>
                    <h2>
                      {campaign.date}: {campaign.harness}
                    </h2>
                    <p>
                      Source commit:{" "}
                      <code>{campaign.sourceCommit ?? "Recorded per route and run"}</code>
                    </p>
                    {campaign.executableSourceCommit && (
                      <p>
                        Executable commit: <code>{campaign.executableSourceCommit}</code>
                      </p>
                    )}
                    {campaign.prUrl && (
                      <a href={campaign.prUrl} target="_blank" rel="noreferrer">
                        {campaign.prLabel ?? "Source pull request"} ↗
                      </a>
                    )}
                    <ul>
                      {campaign.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                    {runs
                      .filter((run) => run.campaignId === campaign.campaignId)
                      .map((run) => (
                        <details className="results-accordion" key={run.runId}>
                          <summary>
                            {getModel(run.modelId)?.name ?? run.modelId}: {run.family}
                          </summary>
                          <div>
                            <RunDetails run={run} />
                            <p>
                              Artifact:{" "}
                              <code>{run.provenance.sourceArtifactSha256 ?? "Not retained"}</code>
                            </p>
                            {run.notes.map((note) => (
                              <p key={note}>{note}</p>
                            ))}
                          </div>
                        </details>
                      ))}
                  </section>
                ))}
              </div>
            </details>
            <details className="results-accordion">
              <summary>Technical setup</summary>
              <div>
                <p>
                  Tool catalog: <code>{CATALOG_LABEL}</code>
                </p>
                <p>
                  Catalog SHA: <code>{CATALOG_SHA_31_TOOLS}</code>
                </p>
                <p>
                  Deterministic grader SHA: <code>{GRADER_SHA256}</code>
                </p>
                <ul>
                  {[...SCORED_FAMILIES, "Portfolio" as const].map((family) => (
                    <li key={family}>
                      {family}: <code>{SUITE_IDS[family]}</code>
                      <br />
                      Suite SHA: <code>{SUITE_SHA256[family]}</code>
                    </li>
                  ))}
                </ul>
                <p>
                  Native checks and checks derived from recorded scores retain their source labels.
                  Withheld, not recorded, and not retained evidence remain distinct. Synthetic
                  examples appear only in Storybook. The Compare tool still requires matching
                  benchmark conditions.
                </p>
              </div>
            </details>
            <details className="results-accordion">
              <summary>Reproduce the evaluation</summary>
              <div>
                <p>
                  The evaluation runner is in <code>packages/evals</code>. Run these commands from
                  the repository root with Bun 1.4.x.
                </p>
                <pre className="method-code">
                  <code>{`bun install --frozen-lockfile\nbun run eval:replay -- \\\n  --suite packages/evals/src/fixtures/model-smoke.yaml \\\n  --observations packages/evals/src/fixtures/synthetic-observations.yaml \\\n  --output /tmp/plugin-eval-report.json`}</code>
                </pre>
                <p>
                  This replay uses synthetic observations to check the runner without credentials or
                  live calls. Reproducing measured runs requires the original suite and
                  configuration plus the appropriate provider credentials; the README documents the
                  live runner options.
                </p>
                <a
                  href="https://github.com/askgina/plugins/tree/main/packages/evals"
                  target="_blank"
                  rel="noreferrer"
                >
                  Read the runner instructions ↗
                </a>
              </div>
            </details>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
