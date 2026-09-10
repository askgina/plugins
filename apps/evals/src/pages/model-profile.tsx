import { ArrowUpRight, ShieldCheck } from "lucide-react";
import {
  ComparisonConditions,
  DimensionValue,
  MetricValue,
  ResultState,
} from "../components/public-comparison-ui";
import { PageShell, Panel } from "../components/eval-ui";
import {
  PUBLIC_DIMENSION_DEFINITIONS,
  PUBLIC_METRIC_DEFINITIONS,
  findComparisonRow,
  type PublicComparisonCatalog,
} from "../lib/public-comparison";
import { usePublicComparisonCatalog } from "../lib/use-public-comparison";
import "./model-profile.css";

const INTEGER = new Intl.NumberFormat("en-US");

export interface ModelProfilePageProps {
  modelId?: string;
  catalog?: PublicComparisonCatalog;
}

function ProfileState({ title, message }: { title: string; message: string }) {
  return (
    <PageShell active="models">
      <div className="eval-container model-profile-page">
        <section
          className="eval-hero model-profile-not-found"
          aria-labelledby="model-profile-title"
        >
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <p className="eval-eyebrow">Public conformance result</p>
          <h1 className="eval-title" id="model-profile-title">
            {title}
            <span>.</span>
          </h1>
          <p className="eval-description">{message}</p>
          <a className="eval-text-link" href="#/leaderboard">
            Return to comparisons <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </section>
      </div>
    </PageShell>
  );
}

export function ModelProfilePage({ modelId, catalog }: ModelProfilePageProps) {
  const state = usePublicComparisonCatalog(catalog);
  if (state.status === "loading") {
    return (
      <ProfileState
        title="Verifying result"
        message="Checking the publication against its index."
      />
    );
  }
  if (state.status === "error") {
    return <ProfileState title="Result unavailable" message={state.message} />;
  }

  const row = findComparisonRow(state.catalog, modelId);
  if (row === undefined) {
    return (
      <ProfileState
        title="Candidate not found"
        message={
          modelId === undefined
            ? "The verified index contains no current result publications."
            : `No current publication exists for ${modelId}.`
        }
      />
    );
  }
  const cohort = state.catalog.cohorts.find((item) => item.rows.includes(row));
  if (cohort === undefined) {
    return (
      <ProfileState title="Cohort unavailable" message="The result has no comparable cohort." />
    );
  }

  return (
    <PageShell active="models">
      <div className="eval-container model-profile-page">
        <section className="eval-hero model-profile-hero" aria-labelledby="model-profile-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <div className="model-profile-intro">
            <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/leaderboard">Comparisons</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{row.candidate}</span>
            </nav>
            <p className="eval-eyebrow">Contract-backed candidate result</p>
            <h1 className="eval-title" id="model-profile-title">
              {row.candidate}
              <span>.</span>
            </h1>
            <p className="model-profile-provider">
              <code>{row.model}</code>
              {row.reasoning === null ? "" : ` · ${row.reasoning}`}
            </p>
            <p className="eval-description">
              Conformance under one declared benchmark cohort. This pilot is unranked and does not
              measure financial outcomes.
            </p>
          </div>
          <div className="model-profile-state-block">
            <ResultState row={row} />
            <span className="model-profile-origin">
              {row.dataOrigin === "synthetic" ? "Synthetic preview data" : "Measured publication"}
            </span>
            <a className="eval-text-link" href="#/handoff">
              Inspect publication record <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="model-profile-metrics" aria-label={`${row.candidate} public metrics`}>
          {PUBLIC_METRIC_DEFINITIONS.map((definition) => (
            <article className="model-profile-metric" key={definition.id}>
              <span className="model-profile-metric-label">{definition.label}</span>
              <MetricValue metric={row.metrics[definition.id]} />
              <p>{definition.description}</p>
            </article>
          ))}
        </section>

        <Panel
          className="model-profile-dimensions"
          title="Conformance dimensions"
          description="Verdict counts over observed attempts. These are not answer-accuracy percentages."
        >
          <div className="eval-handoff-table-scroll">
            <table
              className="eval-table"
              aria-label={`Conformance dimensions for ${row.candidate}`}
            >
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Passed</th>
                  <th scope="col">Failed</th>
                  <th scope="col">Not applicable</th>
                </tr>
              </thead>
              <tbody>
                {PUBLIC_DIMENSION_DEFINITIONS.map((definition) => {
                  const value = row.dimensions[definition.id];
                  return (
                    <tr key={definition.id}>
                      <th scope="row">{definition.label}</th>
                      <td>{INTEGER.format(value.passed)}</td>
                      <td>{INTEGER.format(value.failed)}</td>
                      <td>{INTEGER.format(value.notApplicable)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="eval-two-column model-profile-contract-grid">
          <Panel
            title="Coverage and evidence"
            description="Observed counts remain distinct from planned coverage and retained detail."
          >
            <dl className="model-profile-record">
              <div>
                <dt>Coverage</dt>
                <dd>{row.coverage.status}</dd>
              </div>
              <div>
                <dt>Planned cases / attempts</dt>
                <dd>
                  {INTEGER.format(row.coverage.plannedCases)} /{" "}
                  {INTEGER.format(row.coverage.plannedAttempts)}
                </dd>
              </div>
              <div>
                <dt>Observed attempts</dt>
                <dd>{INTEGER.format(row.counts.attempts.total)}</dd>
              </div>
              <div>
                <dt>Cases passing every attempt</dt>
                <dd>
                  {row.counts.cases.passedEveryAttempt === null
                    ? "Not available"
                    : INTEGER.format(row.counts.cases.passedEveryAttempt)}
                </dd>
              </div>
              <div>
                <dt>Attempt evidence</dt>
                <dd>{row.evidence.replaceAll("_", " ")}</dd>
              </div>
            </dl>
          </Panel>
          <Panel
            title="Comparison conditions"
            description="Only publications matching all these values share this cohort."
          >
            <ComparisonConditions conditions={cohort.conditions} />
          </Panel>
        </div>

        <div className="eval-two-column model-profile-contract-grid">
          <Panel
            title="Configuration provenance"
            description="Model labels and pinned bytes are reported separately."
          >
            <dl className="model-profile-record">
              <div>
                <dt>Availability</dt>
                <dd>{row.configuration.availability === "pinned" ? "Pinned" : "Labels only"}</dd>
              </div>
              <div>
                <dt>Candidate</dt>
                <dd>
                  <code>{row.candidate}</code>
                </dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>
                  <code>{row.model}</code>
                </dd>
              </div>
              <div>
                <dt>Pinned SHA-256</dt>
                <dd>
                  {row.configuration.pinnedSha256 === null ? (
                    "Not supplied"
                  ) : (
                    <code title={row.configuration.pinnedSha256}>
                      {row.configuration.pinnedSha256.slice(0, 12)}…
                    </code>
                  )}
                </dd>
              </div>
            </dl>
          </Panel>
          <Panel
            title="Publication record"
            description="The result remains tied to one immutable revision."
          >
            <div className="model-profile-publication">
              <ShieldCheck aria-hidden="true" />
              <dl className="model-profile-record">
                <div>
                  <dt>Publication</dt>
                  <dd>
                    <code>{row.publicationId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>
                    <code>{row.revisionId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>
                    <time dateTime={row.publishedAt}>{row.publishedAt}</time>
                  </dd>
                </div>
                <div>
                  <dt>Unranked because</dt>
                  <dd>{row.unrankedReasons.join(", ")}</dd>
                </div>
              </dl>
            </div>
          </Panel>
        </div>

        {cohort.rows.length > 1 && (
          <Panel
            title="Other candidates in this cohort"
            description="Links preserve the same benchmark conditions without assigning rank."
          >
            <ul className="model-profile-peer-list">
              {cohort.rows
                .filter((candidate) => candidate.id !== row.id)
                .map((candidate) => (
                  <li key={candidate.revisionId}>
                    <a href={`#/models/${candidate.id}`}>{candidate.candidate}</a>
                    <DimensionValue row={candidate} dimension="completion" compact />
                  </li>
                ))}
            </ul>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
