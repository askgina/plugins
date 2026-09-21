import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info, X } from "lucide-react";
import { canonicalCampaigns, type CanonicalRun } from "../canonical/canonical";
import { HeadlineValue, LatencyValue } from "../canonical/components";
import { derivedCostPerTask, headlineFor, runDisplayLabel } from "../canonical/selectors";
import "../styles/results-browser.css";

export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
export const seconds = (value: number) => `${(value / 1000).toFixed(1)}s`;
export const dollars = (value: number) => `$${value.toFixed(3)}`;

export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="results-info" aria-label={label}>
        <Info size={15} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={8}
          collisionPadding={12}
          className="results-popover-positioner"
        >
          <Popover.Popup className="results-popover">
            <div className="results-popover-heading">
              <Popover.Title>{label}</Popover.Title>
              <Popover.Close aria-label="Close explanation">
                <X size={16} />
              </Popover.Close>
            </div>
            <div className="results-popover-body">{children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ResultsHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="eval-hero results-header">
      <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
      <h1>{title}</h1>
      <p className="eval-description">{description}</p>
      {children}
    </header>
  );
}

export function RunDetails({ run }: { run: CanonicalRun }) {
  const campaign = canonicalCampaigns.find((entry) => entry.campaignId === run.campaignId);
  const cost = derivedCostPerTask(run);
  const tokens = run.metrics.tokenUsage;
  const timeout = run.timeoutMs ?? campaign?.timeoutMs;
  return (
    <section className="results-run-details" aria-label={`${run.family} run details`}>
      <h3>{run.family}</h3>
      <dl className="results-facts">
        <div>
          <dt>Passes</dt>
          <dd>
            <HeadlineValue headline={headlineFor(run)} />
          </dd>
        </div>
        <div>
          <dt>Dispatch</dt>
          <dd>
            {run.dispatchCoverage}; {run.counts.completed} completed, {run.counts.timedOut} timed
            out, {run.counts.runtimeFailure} run errors
          </dd>
        </div>
        <div>
          <dt>Grading</dt>
          <dd>
            {run.counts.graded}/{run.counts.planned} graded · {run.counts.passed} passed ·{" "}
            {run.counts.failed} failed
          </dd>
        </div>
        <div>
          <dt>Run date</dt>
          <dd>{run.startedAt.slice(0, 10)}</dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>{run.cohort.target}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>
            {run.recovery
              ? `${run.recovery.timeoutBudgetsMs.map((ms) => ms / 1000).join(" / ")}s recorded budgets`
              : timeout == null
                ? "Timeout not recorded"
                : `${timeout / 1000}s timeout`}{" "}
            · {run.cohort.repetitions} repetitions per task
          </dd>
        </div>
        <div>
          <dt>Configuration</dt>
          <dd>
            {run.configuration.reasoning ?? "Unspecified"} reasoning ·{" "}
            {run.configuration.availability.replaceAll("_", " ")}
            <br />
            <code>{run.configuration.configurationId}</code>
          </dd>
        </div>
        <div>
          <dt>Timing</dt>
          <dd>
            <LatencyValue metric={run.metrics.latencyMs} />
          </dd>
        </div>
        <div>
          <dt>Est. cost / task</dt>
          <dd>
            {cost.availability === "available" ? (
              <>
                {dollars(cost.usdPerTask)} · {cost.sampleCount ?? "Unknown number of"}{" "}
                {cost.population} attempts
                <br />
                {cost.basis === "token_rates"
                  ? `${cost.priceSource} prices, ${cost.priceAsOf}`
                  : `${cost.priceSource}, ${cost.priceAsOf}; not billed spend`}
              </>
            ) : (
              (cost.reason ?? cost.availability.replaceAll("_", " "))
            )}
          </dd>
        </div>
        <div>
          <dt>Recorded tokens</dt>
          <dd>
            {tokens.availability === "available" || tokens.availability === "aggregate_only" ? (
              <>
                {tokens.inputTokens.toLocaleString()} input · {tokens.outputTokens.toLocaleString()}{" "}
                output · {tokens.totalTokens.toLocaleString()} total
                <br />
                {tokens.availability === "available"
                  ? tokens.sampleCount
                  : "Unknown number of"}{" "}
                {tokens.population} attempts
              </>
            ) : (
              tokens.availability.replaceAll("_", " ")
            )}
          </dd>
        </div>
        <div>
          <dt>Source run</dt>
          <dd>
            <code>{runDisplayLabel(run.runId)}</code>
          </dd>
        </div>
        <div>
          <dt>Source commit</dt>
          <dd>
            <code>{run.provenance.sourceCommit ?? "Not recorded"}</code>
          </dd>
        </div>
        <div>
          <dt>Source artifact SHA-256</dt>
          <dd>
            <code>{run.provenance.sourceArtifactSha256 ?? "Not recorded"}</code>
          </dd>
        </div>
        <div>
          <dt>Suite / fixture</dt>
          <dd>
            {run.cohort.suiteId} v{run.cohort.suiteVersion} · fixture v{run.cohort.fixtureVersion}
          </dd>
        </div>
        <div>
          <dt>Tool catalogue SHA-256</dt>
          <dd>
            <code>{run.cohort.catalogSha ?? "Not recorded"}</code>
          </dd>
        </div>
      </dl>
      {run.notes.length > 0 && (
        <ul className="results-run-notes">
          {run.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
