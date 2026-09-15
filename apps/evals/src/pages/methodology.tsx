import { ArrowUpRight } from "lucide-react";
import { PageShell, Panel } from "../components/eval-ui";
import {
  CATALOG_LABEL,
  CATALOG_SHA_31_TOOLS,
  canonicalCampaigns,
  canonicalRuns,
  GRADER_SHA256,
  SUITE_IDS,
  SUITE_SHA256,
} from "../canonical/canonical";
import { getModel } from "../canonical/selectors";

const measuredCampaigns = canonicalCampaigns.filter((campaign) => campaign.origin === "measured");

export function MethodologyPage() {
  return (
    <PageShell active="methodology">
      <div className="eval-container eval-methodology">
        <section className="eval-hero">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <p className="eval-eyebrow">Methodology</p>
          <h1 className="eval-title">
            Open to inspection<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            A useful score needs a task, a rubric, and evidence you can read. Here is what this site
            shows, and what it does not.
          </p>
        </section>
        <div className="eval-method-grid">
          <Panel title="First, a note on the data">
            <div className="eval-method-body">
              <p>
                Every score, timing, and tool trace on these pages comes from the measured
                conformance campaigns listed below (
                {measuredCampaigns
                  .map((campaign) => `${campaign.harness}, ${campaign.date}`)
                  .join("; ")}
                ) and is shown as exported from the run artifacts.
              </p>
              <p>
                These are unranked, small samples of tool-use conformance — not answer accuracy and
                not financial outcomes. They should not inform model selection or financial
                decisions.
              </p>
              <p>
                Synthetic rows exist only as labelled Storybook previews of unavailable and
                lifecycle states; they never appear on these pages.
              </p>
            </div>
          </Panel>
          <Panel title="Artifact identities">
            <div className="eval-method-body">
              <p>
                Measured campaigns pin the tool catalog <code>{CATALOG_LABEL}</code> (sha{" "}
                <code>{CATALOG_SHA_31_TOOLS.slice(0, 12)}…</code>) and the deterministic grader{" "}
                <code>grading.ts</code> at sha <code>{GRADER_SHA256.slice(0, 12)}…</code>.
              </p>
              <ul>
                {(Object.keys(SUITE_IDS) as (keyof typeof SUITE_IDS)[]).map((family) => (
                  <li key={family}>
                    {family}: <code>{SUITE_IDS[family]}</code> · suite sha{" "}
                    <code>{SUITE_SHA256[family].slice(0, 12)}…</code>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel title="Measured runs">
            <div className="eval-method-body">
              {measuredCampaigns.map((campaign) => (
                <div key={campaign.campaignId}>
                  <p>
                    {campaign.harness}, {campaign.repetitions} repetitions per case,{" "}
                    {campaign.timeoutMs / 1000}s timeout ({campaign.date}). These are unranked,
                    small live samples of tool-use conformance, not answer accuracy or financial
                    outcomes.
                  </p>
                  {campaign.campaignId === "omp-2026-09-11" ? (
                    <>
                      <p>
                        Spot:{" "}
                        <code>
                          {canonicalRuns
                            .filter(
                              (run) =>
                                run.campaignId === campaign.campaignId && run.family === "Spot",
                            )
                            .map((run) => {
                              const model = getModel(run.modelId);
                              return `${run.provenance.sourceCommit.slice(0, 7)} (${model?.name ?? run.modelId})`;
                            })
                            .join(" / ")}
                        </code>
                        ; perps/predictions:{" "}
                        <code>
                          {canonicalRuns
                            .find(
                              (run) =>
                                run.campaignId === campaign.campaignId && run.family === "Perps",
                            )
                            ?.provenance.sourceCommit.slice(0, 7)}
                        </code>
                        , executable <code>{campaign.executableSourceCommit?.slice(0, 7)}</code>
                      </p>
                      {campaign.prUrl && (
                        <a
                          className="eval-text-link"
                          href={campaign.prUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {campaign.prLabel ?? "GitHub PR"}{" "}
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      )}
                    </>
                  ) : (
                    <p>
                      Source commit <code>{campaign.sourceCommit.slice(0, 7)}</code>.
                    </p>
                  )}
                  <ul>
                    {campaign.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="What a task measures">
            <div className="eval-method-body">
              <p>
                Tasks cover portfolio analysis, spot markets, perpetuals, and prediction markets.
                Each asks the agent to answer a financial question using read-only tools.
              </p>
              <ul>
                <li>Choose the right tools for the question.</li>
                <li>Use valid arguments and the requested scope.</li>
                <li>Ground the answer in the returned evidence.</li>
                <li>Respect read-only safety and report missing data.</li>
              </ul>
            </div>
          </Panel>
          <Panel title="Reading the scores">
            <div className="eval-method-body">
              <p>
                The headline is passes over started tasks, shown only when dispatch coverage is
                complete; incomplete or unknown coverage shows counts with the reason instead. Tool
                selection accuracy measures whether the agent chose the expected tools. Task scores
                summarize the individual rubric checks.
              </p>
              <p>
                Every latency and token statistic carries its sample count and population (started,
                completed, or graded). Missing measurements stay missing — withheld, not retained,
                not recorded, and aggregate-only are distinct states and are never zero-filled.
              </p>
            </div>
          </Panel>
          <Panel title="Latency, cost, and reproducibility">
            <div className="eval-method-body">
              <p>
                Median latency is elapsed time per task over the reported population. Cost is
                derived, never measured: the token aggregate priced at the model's published
                per-token rate, shown as "est. cost/task" with its sample count and population, and
                unavailable where token evidence or a published price is missing.
              </p>
              <p>
                The open-source runner in <code>packages/evals</code> reproduces these runs: same
                suite, pinned tool catalog, deterministic grader, and declared repetitions.
              </p>
              <a
                className="eval-text-link"
                href="https://github.com/askgina/plugins/tree/main/packages/evals"
                target="_blank"
                rel="noreferrer"
              >
                Explore the eval runner <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
          </Panel>
        </div>
        <p className="eval-method-note">
          No evaluations, wallet connections, trades, or tool requests run from this site. Downloads
          serve the exported conformance artifacts displayed here.
        </p>
      </div>
    </PageShell>
  );
}
