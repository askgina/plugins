// Restored origin/main illustrative model profile. Every number here comes from the
// synthetic design fixture in ../../data; nothing on this page is a measured result.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, Download, GitCompare } from "lucide-react";
import { dataset, families, featuredModel, getModel, models, type EvalModel } from "../../data";
import { Modal, ModelAvatar, Panel } from "../../components/eval-ui";
import { Button } from "../../components/ui/button";
import { PageShell } from "./page-shell";
import "../../pages/model-profile.css";

export interface ModelProfilePageProps {
  modelId?: string;
  initialCompareId?: string;
}

const numberFormatter = new Intl.NumberFormat("en-US");

const metricDefinitions = [
  {
    id: "pass-rate",
    label: "Overall pass",
    description: "Tasks completed within the fixture contract",
    value: (model: EvalModel) => `${model.passRate}%`,
  },
  {
    id: "tool-accuracy",
    label: "Tool selection accuracy",
    description: "Calls routed to the expected Gina tool",
    value: (model: EvalModel) => `${model.accuracy}%`,
  },
  {
    id: "latency",
    label: "Median latency",
    description: "Illustrative end-to-end task duration",
    value: (model: EvalModel) => `${model.latency.toFixed(1)}s`,
  },
  {
    id: "cost",
    label: "Cost per task",
    description: "Illustrative model cost at fixture rates",
    value: (model: EvalModel) => `$${model.cost.toFixed(3)}`,
  },
] as const;

const histogramBuckets = [
  { label: "0-49", midpoint: 35 },
  { label: "50-59", midpoint: 55 },
  { label: "60-69", midpoint: 65 },
  { label: "70-79", midpoint: 75 },
  { label: "80-89", midpoint: 85 },
  { label: "90-100", midpoint: 95 },
] as const;

type HistogramBucket = (typeof histogramBuckets)[number] & { count: number };

function getPreferredComparison(model: EvalModel, requestedId?: string): EvalModel {
  const requested = requestedId ? getModel(requestedId) : undefined;
  if (requested && requested.id !== model.id) return requested;
  return models.find((candidate) => candidate.id !== model.id) ?? model;
}

function hasValidInitialComparison(model: EvalModel | undefined, requestedId?: string): boolean {
  if (!model || !requestedId) return false;
  const requested = getModel(requestedId);
  return Boolean(requested && requested.id !== model.id);
}

function buildIllustrativeDistribution(model: EvalModel): HistogramBucket[] {
  const spread = 10 + model.uncertainty;
  const weights = histogramBuckets.map((bucket) =>
    Math.exp(-((bucket.midpoint - model.passRate) ** 2) / (2 * spread ** 2)),
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const counts = weights.map((weight) => Math.round((weight / totalWeight) * dataset.tasks));
  const remainder = dataset.tasks - counts.reduce((sum, count) => sum + count, 0);
  const largestBucket = counts.reduce(
    (largestIndex, count, index) => (count > counts[largestIndex]! ? index : largestIndex),
    0,
  );
  counts[largestBucket] = counts[largestBucket]! + remainder;

  return histogramBuckets.map((bucket, index) => ({
    ...bucket,
    count: counts[index]!,
  }));
}

function MetricCards({ model }: { model: EvalModel }) {
  return (
    <section className="model-profile-metrics" aria-label={`${model.name} summary metrics`}>
      {metricDefinitions.map((metric) => (
        <article className="model-profile-metric" key={metric.id}>
          <span className="model-profile-metric-label">{metric.label}</span>
          <strong>{metric.value(model)}</strong>
          <p>{metric.description}</p>
        </article>
      ))}
    </section>
  );
}

function ComparisonCard({ model, featured }: { model: EvalModel; featured: boolean }) {
  return (
    <article className="model-profile-comparison-card">
      <header>
        <ModelAvatar model={model} size="lg" />
        <div>
          <span>{featured ? "Profile model" : "Comparison model"}</span>
          <h3>{model.name}</h3>
          <p>{model.provider}</p>
        </div>
      </header>
      <dl>
        {metricDefinitions.map((metric) => (
          <div key={metric.id}>
            <dt>{metric.label}</dt>
            <dd>{metric.value(model)}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function ModelProfilePage({ modelId, initialCompareId }: ModelProfilePageProps) {
  const requestedModelId = modelId ?? featuredModel.id;
  const model = getModel(requestedModelId);
  const [selectedCompareId, setSelectedCompareId] = useState(() =>
    model ? getPreferredComparison(model, initialCompareId).id : "",
  );
  const [compareOpen, setCompareOpen] = useState(() =>
    hasValidInitialComparison(model, initialCompareId),
  );

  useEffect(() => {
    if (!model) {
      setSelectedCompareId("");
      setCompareOpen(false);
      return;
    }

    setSelectedCompareId(getPreferredComparison(model, initialCompareId).id);
    setCompareOpen(hasValidInitialComparison(model, initialCompareId));
  }, [initialCompareId, model]);

  const comparisonModel = model ? getPreferredComparison(model, selectedCompareId) : undefined;
  const comparisonOptions = model ? models.filter((candidate) => candidate.id !== model.id) : [];
  const distribution = useMemo(() => (model ? buildIllustrativeDistribution(model) : []), [model]);
  const largestDistributionBucket = distribution.reduce(
    (largest, bucket) => Math.max(largest, bucket.count),
    0,
  );

  if (!model) {
    return (
      <PageShell active="models">
        <div className="eval-container model-profile-page">
          <section
            className="eval-hero model-profile-not-found"
            aria-labelledby="model-profile-title"
          >
            <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
            <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/leaderboard">Leaderboard</a>
              <span aria-hidden="true">/</span>
              <a href="#/models/kimi-k3">Models</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">Not found</span>
            </nav>
            <p className="eval-eyebrow">Model profile · Gina financial-task harness</p>
            <h1 className="eval-title" id="model-profile-title">
              Model not found<span>.</span>
            </h1>
            <p className="eval-description">
              The illustrative fixture does not include a model with the ID{" "}
              <code>{requestedModelId}</code>.
            </p>
            <a className="eval-text-link" href="#/leaderboard">
              Return to the leaderboard <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </section>
        </div>
      </PageShell>
    );
  }

  const downloadResults = () => {
    const payload = {
      illustrative: true,
      disclaimer: dataset.disclaimer,
      kind: "gina-evals-model-profile",
      dataset,
      model,
    };
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${model.id}-${dataset.version}-illustrative-results.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell active="models">
      <div className="eval-container model-profile-page">
        <section className="eval-hero model-profile-hero" aria-labelledby="model-profile-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <div className="model-profile-intro">
            <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/leaderboard">Leaderboard</a>
              <span aria-hidden="true">/</span>
              <a href="#/models/kimi-k3">Models</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{model.name}</span>
            </nav>
            <p className="eval-eyebrow">Model profile · Gina financial-task harness</p>
            <div className="model-profile-title-row">
              <ModelAvatar model={model} size="lg" />
              <h1 className="eval-title" id="model-profile-title">
                {model.name}
                <span>.</span>
              </h1>
            </div>
            <p className="model-profile-provider">{model.provider}</p>
            <p className="eval-description">
              A compact look at {model.name} across portfolio, spot, perps, and prediction-market
              tasks in the illustrative {dataset.version} fixture.
            </p>
          </div>

          <div className="model-profile-actions">
            <label className="model-profile-compare-field">
              <span>Compare with</span>
              <select
                value={comparisonModel?.id ?? ""}
                onChange={(event) => setSelectedCompareId(event.target.value)}
                aria-label="Choose a model to compare"
                disabled={comparisonOptions.length === 0}
              >
                {comparisonOptions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="model-profile-compare-button"
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={!comparisonModel || comparisonModel.id === model.id}
            >
              <GitCompare size={16} aria-hidden="true" /> Compare models
            </Button>
            <Button
              className="model-profile-download-button"
              type="button"
              variant="secondary"
              onClick={downloadResults}
            >
              <Download size={15} aria-hidden="true" /> Download results
            </Button>
            <a className="eval-text-link" href="#/methodology">
              View methodology <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </section>

        <MetricCards model={model} />

        <section className="eval-two-column model-profile-chart-grid" aria-label="Profile charts">
          <Panel
            className="model-profile-chart-panel"
            title="Performance by task family"
            description={`Pass rate with an illustrative ±${model.uncertainty} percentage-point interval.`}
          >
            <ul className="model-profile-family-bars">
              {families.map((family) => {
                const familyResult = model.families[family];
                const intervalStart = Math.max(0, familyResult.passRate - model.uncertainty);
                const intervalEnd = Math.min(100, familyResult.passRate + model.uncertainty);
                return (
                  <li key={family}>
                    <div className="model-profile-family-label">
                      <span>{family}</span>
                      <strong>
                        {familyResult.passRate}% <small>±{model.uncertainty} pp</small>
                      </strong>
                    </div>
                    <div
                      className="model-profile-family-track"
                      role="img"
                      aria-label={`${family}: ${familyResult.passRate} percent pass rate, plus or minus ${model.uncertainty} illustrative percentage points`}
                    >
                      <span
                        className="model-profile-family-fill"
                        style={{ width: `${familyResult.passRate}%` }}
                      />
                      <span
                        className="model-profile-family-interval"
                        style={{
                          left: `${intervalStart}%`,
                          width: `${intervalEnd - intervalStart}%`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="eval-muted model-profile-chart-note">
              Intervals are visual fixture annotations, not confidence intervals from measured runs.
            </p>
          </Panel>

          <Panel
            className="model-profile-chart-panel"
            title="Task score distribution"
            description={`${numberFormatter.format(dataset.tasks)} illustrative task scores grouped by score band.`}
          >
            <p className="model-profile-sr-only">
              Illustrative distribution for {model.name}:{" "}
              {distribution
                .map((bucket) => `${bucket.label}, ${numberFormatter.format(bucket.count)} tasks`)
                .join("; ")}
              .
            </p>
            <div className="model-profile-histogram" aria-hidden="true">
              {distribution.map((bucket) => {
                const height =
                  largestDistributionBucket === 0
                    ? 0
                    : (bucket.count / largestDistributionBucket) * 100;
                return (
                  <div className="model-profile-histogram-column" key={bucket.label}>
                    <span className="model-profile-histogram-count">
                      {numberFormatter.format(bucket.count)}
                    </span>
                    <span className="model-profile-histogram-track">
                      <span
                        className="model-profile-histogram-bar"
                        style={{ "--histogram-height": `${height}%` } as CSSProperties}
                      />
                    </span>
                    <span className="model-profile-histogram-label">{bucket.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="eval-muted model-profile-chart-note">
              Illustrative distribution derived from the profile fixture. It is not observed
              task-level data.
            </p>
          </Panel>
        </section>

        <section className="eval-two-column model-profile-lower-grid">
          <Panel
            className="model-profile-breakdown-panel"
            title="Task family breakdown"
            description={`${numberFormatter.format(dataset.tasksPerFamily)} tasks per family in the illustrative fixture.`}
          >
            <div
              className="model-profile-table-scroll"
              role="region"
              aria-label={`Illustrative results for ${model.name} by task family`}
              tabIndex={0}
            >
              <table className="eval-table model-profile-table">
                <caption className="model-profile-sr-only">
                  Illustrative results for {model.name} by task family
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Task family</th>
                    <th scope="col">Pass rate</th>
                    <th scope="col">Tool accuracy</th>
                    <th scope="col">Unsuccessful tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {families.map((family) => {
                    const familyResult = model.families[family];
                    return (
                      <tr key={family}>
                        <th scope="row">{family}</th>
                        <td>{familyResult.passRate}%</td>
                        <td>{familyResult.accuracy}%</td>
                        <td>{numberFormatter.format(familyResult.failures)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            className="model-profile-run-panel"
            title="Run details"
            description="Fixture provenance for every number on this page."
          >
            <dl className="model-profile-run-details">
              <div>
                <dt>Status</dt>
                <dd>Illustrative fixture</dd>
              </div>
              <div>
                <dt>Dataset</dt>
                <dd>{dataset.label}</dd>
              </div>
              <div>
                <dt>Harness</dt>
                <dd>{dataset.harness}</dd>
              </div>
              <div>
                <dt>Run date</dt>
                <dd>{dataset.runDate}</dd>
              </div>
              <div>
                <dt>Total tasks</dt>
                <dd>{numberFormatter.format(dataset.tasks)}</dd>
              </div>
              <div>
                <dt>Repetitions</dt>
                <dd>{dataset.repetitions}</dd>
              </div>
            </dl>
            <a className="eval-text-link model-profile-run-link" href="#/methodology">
              Read the evaluation methodology <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </Panel>
        </section>
      </div>

      {comparisonModel && comparisonModel.id !== model.id && (
        <Modal
          title={`Compare ${model.name} and ${comparisonModel.name}`}
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
        >
          <div className="model-profile-comparison-grid">
            <ComparisonCard model={model} featured />
            <ComparisonCard model={comparisonModel} featured={false} />
          </div>
          <p className="eval-muted model-profile-comparison-note">
            Values come from the same {dataset.label.toLowerCase()} fixture. No measured advantage
            is implied.
          </p>
        </Modal>
      )}
    </PageShell>
  );
}
