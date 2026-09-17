import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info, X } from "lucide-react";
import { canonicalCampaigns, type CanonicalRun } from "../canonical/canonical";
import { LatencyValue } from "../canonical/components";
import { derivedCostPerTask } from "../canonical/selectors";
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
  return (
    <section className="results-run-details" aria-label={`${run.family} run details`}>
      <h3>{run.family}</h3>
      <dl className="results-facts">
        <div>
          <dt>Passes</dt>
          <dd>
            {run.counts.passed} of {run.counts.started} started attempts
          </dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>
            {run.dispatchCoverage}; {run.counts.completed} completed, {run.counts.timedOut} timed
            out, {run.counts.runtimeFailure} run errors
          </dd>
        </div>
        <div>
          <dt>Run date</dt>
          <dd>{run.startedAt.slice(0, 10)}</dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>{campaign?.harness ?? run.cohort.target}</dd>
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
                {cost.priceSource} prices, {cost.priceAsOf}
              </>
            ) : (
              (cost.reason ?? cost.availability.replaceAll("_", " "))
            )}
          </dd>
        </div>
        <div>
          <dt>Source run</dt>
          <dd>
            <code>{run.runId}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}
