import { ArrowUpRight } from "lucide-react";
import { PageShell, Panel } from "../../components/eval-ui";
import { museReport } from "../../results";
import {
  CATALOG_LABEL,
  CATALOG_SHA_31_TOOLS,
  ELIGIBILITY_REASONS,
  EXECUTION_STATUSES,
  EXPORT_REFERENCES,
  GRADER_SHA256,
  MEASURED_FAMILIES,
  PROTOTYPE_FAMILIES,
  SUITE_IDS,
  SUITE_SHA256,
  canonicalCampaigns,
  canonicalPublications,
  canonicalRuns,
  withdrawnRuns,
  type CanonicalCampaign,
  type CanonicalRun,
  type CaseBinding,
  type PrototypeFamily,
  type PublicationRevision,
} from "../canonical";
import {
  caseDefinitionsForFamily,
  dispatchCoverageText,
  eligibilityText,
  getModel,
  resolveBaselineRun,
} from "../selectors";
import {
  CoverageChip,
  OriginTag,
  PrototypeBanner,
  PrototypeTag,
  SyntheticTag,
} from "../components";
import "./methodology.css";

// ---------------------------------------------------------------------------
// Shared rendering helpers (layout-only inline styles; visual hooks live in
// methodology.css under eval-proto-*).
// ---------------------------------------------------------------------------

const GITHUB_BLOB = "https://github.com/askgina/plugins/blob/main";

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function Sha({ value }: { value: string | null }) {
  if (!value) return <span className="eval-muted">—</span>;
  return (
    <code className="eval-proto-sha" title={value}>
      {shortSha(value)}…
    </code>
  );
}

function Commit({ value }: { value: string }) {
  if (!value) return <span className="eval-muted">—</span>;
  return (
    <code className="eval-proto-sha" title={value}>
      {value.slice(0, 7)}
    </code>
  );
}

function RepoFile({ path, label }: { path: string; label?: string }) {
  return (
    <a className="eval-text-link" href={`${GITHUB_BLOB}/${path}`} target="_blank" rel="noreferrer">
      {label ?? path}
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Benchmark identity — the frozen suite files, grader, and tool catalog every
// measured campaign pins by sha256.
// ---------------------------------------------------------------------------

const SUITE_FILES: Record<PrototypeFamily, string> = {
  Spot: "plugins/ask-gina/evals/model/v1/families/spot.yaml",
  Perps: "plugins/ask-gina/evals/model/v1/families/perps.yaml",
  Predictions: "plugins/ask-gina/evals/model/v1/families/predictions.yaml",
  Portfolio: "plugins/ask-gina/evals/model/v1/families/portfolio.yaml",
};

const GRADER_FILE = "packages/evals/src/grading.ts";

// ---------------------------------------------------------------------------
// Campaign + provenance derivations. The canonical `provenance` block carries
// `sourceArtifactSha256` for most runs but no explicit `sourceKind`, and it is
// null for the Muse Spot/Predictions runs (their canonical report was never
// written) — so the kind and the missing shas are derived here from the run's
// `sourceLabel` and the Muse report's recorded input sources.
// ---------------------------------------------------------------------------

const MUSE_REPORT_CAMPAIGN = "muse-2026-09-14";

const MUSE_FAMILY_KEY = {
  Spot: "spot",
  Perps: "perps",
  Predictions: "predictions",
} as const;

/** Authoritative campaign-result.json sha recorded in the Muse report sources. */
function museCampaignResultSha(family: PrototypeFamily): string | null {
  const key = MUSE_FAMILY_KEY[family as keyof typeof MUSE_FAMILY_KEY];
  if (!key) return null;
  const entry = museReport.families.find((item) => item.family === key);
  const source = entry?.muse.sources.find((s) => s.file.endsWith("campaign-result.json"));
  return source?.sha256 ?? null;
}

type SourceKind =
  | "run_report"
  | "report_with_attempts"
  | "campaign_result"
  | "comparison_summary"
  | "synthetic_none";

const KIND_LABEL: Record<SourceKind, string> = {
  run_report: "run report",
  report_with_attempts: "run report + attempt capture",
  campaign_result: "campaign-result",
  comparison_summary: "comparison summary",
  synthetic_none: "generated row",
};

interface SourceInfo {
  kind: SourceKind;
  sha256: string | null;
  schemaVersion: string | null;
  note: string | null;
}

function sourceInfo(run: CanonicalRun): SourceInfo {
  const label = run.provenance.sourceLabel;
  const recorded = run.provenance.sourceArtifactSha256;
  if (run.origin === "synthetic") {
    return { kind: "synthetic_none", sha256: null, schemaVersion: null, note: null };
  }
  if (label.includes("campaign-result")) {
    if (run.campaignId === MUSE_REPORT_CAMPAIGN && recorded) {
      // muse-perps-1: the recorded sha is the written canonical report; the
      // campaign-result.json named by the label is the report's input.
      const input = museCampaignResultSha(run.family);
      return {
        kind: "run_report",
        sha256: recorded,
        schemaVersion: "v1",
        note: input ? `campaign-result input ${shortSha(input)}…` : null,
      };
    }
    return {
      kind: "campaign_result",
      sha256: recorded ?? museCampaignResultSha(run.family),
      schemaVersion:
        run.campaignId === MUSE_REPORT_CAMPAIGN
          ? "ask-gina-muse-campaign-result.v1"
          : "ask-gina-durable-campaign-result.v1",
      note: recorded ? null : "sha from the campaign report's source list",
    };
  }
  if (label.includes("companion capture")) {
    return {
      kind: "report_with_attempts",
      sha256: recorded,
      schemaVersion: "v1",
      note: null,
    };
  }
  if (label.includes("summary")) {
    return {
      kind: "comparison_summary",
      sha256: recorded,
      schemaVersion: "ask-gina-claude-evals.v1",
      note: null,
    };
  }
  return { kind: "run_report", sha256: recorded, schemaVersion: "v1", note: null };
}

const BINDING_LABEL: Record<CaseBinding, string> = {
  bound_by_suite: "bound by suite YAML",
  bound_by_catalog_sha: "bound by catalog hash",
};

function runsForCampaign(campaignId: string): readonly CanonicalRun[] {
  return canonicalRuns.filter((run) => run.campaignId === campaignId);
}

function countsSummary(run: CanonicalRun): string {
  const c = run.counts;
  const parts = [`${c.started}/${c.planned} started`, `${c.passed} pass · ${c.failed} fail`];
  if (c.timedOut > 0) parts.push(`${c.timedOut} timed out`);
  if (c.runtimeFailure > 0) parts.push(`${c.runtimeFailure} runtime failure`);
  if (c.pending > 0) parts.push(`${c.pending} pending`);
  if (c.unstarted > 0) parts.push(`${c.unstarted} unstarted`);
  if (c.unknown > 0) parts.push(`${c.unknown} unknown`);
  return parts.join(" · ");
}

function coveragePlanText(run: CanonicalRun): string {
  const { planSource, planSha256, statusSha256 } = run.coveragePlan;
  const label = planSource === "run_manifest" ? "run manifest" : "declared plan";
  const shas = [planSha256, statusSha256]
    .filter((sha): sha is string => Boolean(sha))
    .map(shortSha)
    .join(" · ");
  return shas ? `${label} (${shas}…)` : label;
}

const MUSE_NATIVE_VERSION = museReport.provenance.runPlan.sourceSnapshot.nativeVersion;
const MUSE_NATIVE_EXECUTABLE_SHA = museReport.provenance.runPlan.nativeExecutableSha256;

// ---------------------------------------------------------------------------
// Downloads — every path verified to exist on origin/main. The "recorded" sha
// column shows the sha pinned by a manifest / report source list / canonical
// provenance; "—" means the artifact carries no recorded self-digest.
// ---------------------------------------------------------------------------

const RESULTS_PREFIX = "apps/evals/src/results";

interface DownloadRow {
  group: string;
  label: string;
  path: string;
  recordedSha: string | null;
  note?: string;
}

const DOWNLOADS: readonly DownloadRow[] = [
  ...PROTOTYPE_FAMILIES.map((family) => ({
    group: "Benchmark",
    label: `${family} suite (${SUITE_IDS[family]} v${caseDefinitionsForFamily(family)[0]?.suiteVersion ?? 1})`,
    path: SUITE_FILES[family],
    recordedSha: SUITE_SHA256[family],
    note: family === "Portfolio" ? "Definitions only — no measured evidence." : undefined,
  })),
  {
    group: "Benchmark",
    label: "Grader (deterministic check + score code)",
    path: GRADER_FILE,
    recordedSha: GRADER_SHA256,
  },
  {
    group: "omp-2026-09-11",
    label: "Spot comparison report (ask-gina-model-comparison.v1)",
    path: `${RESULTS_PREFIX}/2026-09-11/spot-comparison/comparison.json`,
    recordedSha: "0dd60c53dca29701a9bdcf3ad256d08d55b50dffbc5c948f49094146cecd9d80",
  },
  {
    group: "omp-2026-09-11",
    label: "Spot bundle manifest (integrity manifest)",
    path: `${RESULTS_PREFIX}/2026-09-11/spot-comparison/bundle-manifest.json`,
    recordedSha: null,
    note: "Lists the suite, grader, catalog, and per-run shas used on this page.",
  },
  {
    group: "omp-2026-09-11",
    label: "gpt-5.5 Spot run report (v1)",
    path: `${RESULTS_PREFIX}/2026-09-11/spot-comparison/gpt-5.5/omp_harness-omp-oauth-corrected-spot-openai-oauth-20260911T135127Z.json`,
    recordedSha: "d12167198c14054d5b0599c9fd7fc3758a2d9c1aaa784009ae7352fb91fdfb0f",
  },
  {
    group: "omp-2026-09-11",
    label: "gpt-5.5 Spot attempt capture",
    path: `${RESULTS_PREFIX}/2026-09-11/spot-comparison/gpt-5.5/spot-openai-oauth-20260911T135127Z.attempts.json`,
    recordedSha: "79ad0a9eef86a68130947866f53026901dca4ee019f3b2379c1dc720db91537a",
  },
  {
    group: "omp-2026-09-11",
    label: "gpt-5.6-sol Spot run report (v1)",
    path: `${RESULTS_PREFIX}/2026-09-11/spot-comparison/gpt-5.6-sol/omp_harness-omp-oauth-sol-medium-spot-openai-oauth-sol-20260911T142646Z.json`,
    recordedSha: "4f4d0f5a544905aa200abebdfec431bc93daba21ce95d3710f2d3a82d6a64a71",
  },
  {
    group: "omp-2026-09-11",
    label: "gpt-5.6-sol Spot attempt capture",
    path: `${RESULTS_PREFIX}/2026-09-11/spot-comparison/gpt-5.6-sol/spot-openai-oauth-sol-20260911T142646Z.attempts.json`,
    recordedSha: "19daaf8662ac4b2cb2980a99e57cdbe9c99038c9dd4263080e5ec676458ebff0",
  },
  {
    group: "omp-2026-09-11",
    label: "gpt-5.6-sol Perps run report (v1)",
    path: `${RESULTS_PREFIX}/2026-09-11/perps-predictions/perps/omp_harness-omp-oauth-sol-medium-perps-perps-openai-oauth-sol-20260911T152450Z.json`,
    recordedSha: "b1edfdbcc981ce4028886d0065fa02de63907039487cd4b9ed68b36706288091",
  },
  {
    group: "omp-2026-09-11",
    label: "gpt-5.6-sol Perps attempt capture (54 attempts)",
    path: `${RESULTS_PREFIX}/2026-09-11/perps-predictions/perps/perps-openai-oauth-sol-20260911T152450Z.attempts.json`,
    recordedSha: "b13166907095b6cb0c2156ab51e05e74e64e36a010db11eb1329b91c76bfea4e",
  },
  {
    group: "omp-2026-09-11",
    label: "Predictions campaign-result (ask-gina-durable-campaign-result.v1)",
    path: `${RESULTS_PREFIX}/2026-09-11/perps-predictions/predictions-fresh/campaign-result.json`,
    recordedSha: "6f4c7d78223bae0befb1082d6cc235e152453545e289e888be5bac47161b7170",
    note: "Canonical report never written — this is the authoritative artifact.",
  },
  {
    group: "omp-2026-09-11",
    label: "Perps + Predictions campaign report",
    path: `${RESULTS_PREFIX}/2026-09-11/perps-predictions/report/ask-gina-perps-predictions-evals-2026-09-11.json`,
    recordedSha: "1e696f2f8fb81707624dafc4e83c0c680d75067101ecbe621b63b77d3baeedbf",
  },
  {
    group: "muse-2026-09-14",
    label: "Muse Spot campaign-result (ask-gina-muse-campaign-result.v1)",
    path: `${RESULTS_PREFIX}/2026-09-14/muse-spark-1.3/muse/spot/campaign-result.json`,
    recordedSha: "f5e13a2993e1de53c09bb6ba16f287bac45da9cc4c5a60aa24bd26f5606dd963",
  },
  {
    group: "muse-2026-09-14",
    label: "Muse Perps canonical report (v1)",
    path: `${RESULTS_PREFIX}/2026-09-14/muse-spark-1.3/muse/perps/muse_cli-muse-spark-1.3-native-perps-muse-spark-1.3-native-20260914T133050Z.json`,
    recordedSha: "52b27dbad665f3483f18e4bcaba0524cf79ba8c1ec11bf0cd99cb7ac37b629fa",
  },
  {
    group: "muse-2026-09-14",
    label: "Muse Perps campaign-result input",
    path: `${RESULTS_PREFIX}/2026-09-14/muse-spark-1.3/muse/perps/campaign-result.json`,
    recordedSha: "e98b0a441b385a40d2cd57c39ae19737e928b2dd249ab7f313b2de19946f483b",
  },
  {
    group: "muse-2026-09-14",
    label: "Muse Predictions campaign-result (ask-gina-muse-campaign-result.v1)",
    path: `${RESULTS_PREFIX}/2026-09-14/muse-spark-1.3/muse/predictions/campaign-result.json`,
    recordedSha: "5ae83923dc5cb0a5609d0e9b70efc7cb709fb9225176589f0b4fb38a5b68081b",
  },
  {
    group: "muse-2026-09-14",
    label: "Muse campaign report (ask-gina-muse-comparison.v1)",
    path: `${RESULTS_PREFIX}/2026-09-14/muse-spark-1.3/report/ask-gina-muse-spark-1.3-evals-2026-09-14.json`,
    recordedSha: "d7ad7b0ff29c118ef10f53a87d1ac9692bc1d09e5083aca28ec5e39e32475c7b",
  },
  {
    group: "claude-2026-09-14",
    label: "Fable source summary (ask-gina-claude-evals.v1)",
    path: `${RESULTS_PREFIX}/2026-09-14/claude-comparison/fable/summary.json`,
    recordedSha: "4fe6e3e012db7e8a1993b0a0d55b3530725504466947f1f53d1d7deeea3a7194",
  },
  {
    group: "claude-2026-09-14",
    label: "Opus source summary (ask-gina-claude-evals.v1)",
    path: `${RESULTS_PREFIX}/2026-09-14/claude-comparison/opus/summary.json`,
    recordedSha: "0d5d9dc432c91242a08791a197810c1fbde987e82f61fa5ef72961aed9253f0f",
  },
  {
    group: "claude-2026-09-14",
    label: "Claude comparison report",
    path: `${RESULTS_PREFIX}/2026-09-14/claude-comparison/ask-gina-claude-comparison.json`,
    recordedSha: null,
  },
  {
    group: "Contracts",
    label: "Export contract source (eval-result.v1, eval-publication.v1, eval-index.v1)",
    path: "packages/contracts/src/eval-results.ts",
    recordedSha: null,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function SuiteTable() {
  return (
    <div className="eval-proto-table-wrap">
      <table className="eval-table">
        <thead>
          <tr>
            <th scope="col">Family</th>
            <th scope="col">Suite</th>
            <th scope="col">Version</th>
            <th scope="col">Cases</th>
            <th scope="col">Planned slots</th>
            <th scope="col">Suite sha256</th>
          </tr>
        </thead>
        <tbody>
          {PROTOTYPE_FAMILIES.map((family) => {
            const definitions = caseDefinitionsForFamily(family);
            const measured = MEASURED_FAMILIES.includes(
              family as (typeof MEASURED_FAMILIES)[number],
            );
            const suiteVersion = definitions[0]?.suiteVersion;
            return (
              <tr key={family}>
                <th scope="row">{family}</th>
                <td>
                  <code className="eval-proto-id">{SUITE_IDS[family]}</code>
                </td>
                <td>{suiteVersion ? `v${suiteVersion}` : "—"}</td>
                <td>{definitions.length || "—"}</td>
                <td>
                  {measured ? `${definitions.length} × 3 reps` : "not run — definitions only"}
                </td>
                <td>
                  <Sha value={SUITE_SHA256[family]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CampaignTable() {
  return (
    <div className="eval-proto-table-wrap">
      <table className="eval-table">
        <thead>
          <tr>
            <th scope="col">Campaign</th>
            <th scope="col">Harness</th>
            <th scope="col">Reps</th>
            <th scope="col">Timeout</th>
            <th scope="col">Commits</th>
            <th scope="col">Case binding</th>
            <th scope="col">Origin</th>
          </tr>
        </thead>
        <tbody>
          {canonicalCampaigns.map((campaign) => {
            const run = runsForCampaign(campaign.campaignId)[0];
            const isMuse = campaign.campaignId === MUSE_REPORT_CAMPAIGN;
            return (
              <tr key={campaign.campaignId}>
                <th scope="row">
                  <code className="eval-proto-id">{campaign.campaignId}</code>
                  <span className="eval-proto-cell-note">{campaign.date}</span>
                  {campaign.prUrl && campaign.prLabel && (
                    <a
                      className="eval-text-link eval-proto-cell-note"
                      href={campaign.prUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {campaign.prLabel}
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </a>
                  )}
                </th>
                <td>
                  {campaign.harness}
                  {isMuse && (
                    <span className="eval-proto-cell-note">
                      native {MUSE_NATIVE_VERSION} · executable sha{" "}
                      <code className="eval-proto-sha" title={MUSE_NATIVE_EXECUTABLE_SHA}>
                        {shortSha(MUSE_NATIVE_EXECUTABLE_SHA)}…
                      </code>
                    </span>
                  )}
                </td>
                <td>{campaign.repetitions}</td>
                <td>{campaign.timeoutMs / 1000}s</td>
                <td>
                  <Commit value={campaign.sourceCommit} />
                  {campaign.executableSourceCommit && (
                    <span className="eval-proto-cell-note">
                      executable <Commit value={campaign.executableSourceCommit} />
                    </span>
                  )}
                </td>
                <td>{run ? BINDING_LABEL[run.caseBinding] : "—"}</td>
                <td>
                  <OriginTag origin={campaign.origin} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CampaignCoverage({ campaign }: { campaign: CanonicalCampaign }) {
  const runs = runsForCampaign(campaign.campaignId);
  const withdrawn = withdrawnRuns.filter((ref) => ref.campaignId === campaign.campaignId);
  return (
    <div className="eval-proto-campaign">
      <div className="eval-proto-campaign-head">
        <h3>
          <code className="eval-proto-id">{campaign.campaignId}</code>
        </h3>
        <OriginTag origin={campaign.origin} />
        <time dateTime={campaign.date}>{campaign.date}</time>
      </div>
      {campaign.limitations.length > 0 && (
        <ul className="eval-proto-limitations">
          {campaign.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      )}
      {runs.length > 0 && (
        <div className="eval-proto-table-wrap" style={{ padding: "12px 0 0" }}>
          <table className="eval-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Coverage</th>
                <th scope="col">Grading</th>
                <th scope="col">Counts</th>
                <th scope="col">Coverage basis</th>
                <th scope="col">Withheld / notes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <th scope="row">
                    <code className="eval-proto-id">{run.runId}</code>
                    <span className="eval-proto-cell-note">
                      {getModel(run.modelId)?.name ?? run.modelId}
                    </span>
                  </th>
                  <td>
                    <CoverageChip coverage={run.dispatchCoverage} />
                  </td>
                  <td>{run.gradingCoverage}</td>
                  <td>{countsSummary(run)}</td>
                  <td>{coveragePlanText(run)}</td>
                  <td>
                    {run.withheldFields.length > 0 && (
                      <span className="eval-proto-cell-note">
                        withheld:{" "}
                        {run.withheldFields
                          .map((field) => `${field.field} (${field.reason})`)
                          .join(", ")}
                      </span>
                    )}
                    {run.notes.map((note) => (
                      <span className="eval-proto-cell-note" key={note}>
                        {note}
                      </span>
                    ))}
                    {run.withheldFields.length === 0 && run.notes.length === 0 && "—"}
                  </td>
                </tr>
              ))}
              {withdrawn.map((ref) => (
                <tr key={ref.runId}>
                  <th scope="row">
                    <code className="eval-proto-id">{ref.runId}</code>
                  </th>
                  <td colSpan={5}>
                    Withdrawn {ref.withdrawal.withdrawnAt} ({ref.withdrawal.reason}) — result bytes
                    removed; identifiers retained for history.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RevisionChain({ revision }: { revision: PublicationRevision }) {
  return (
    <span className="eval-proto-rev">
      <code className="eval-proto-id">r{revision.revision}</code> {revision.kind} · {revision.state}
      {revision.supersedes && (
        <>
          <span className="eval-proto-rev-arrow">←</span> supersedes r{revision.supersedes.revision}{" "}
          ({revision.supersedes.reason})
        </>
      )}
    </span>
  );
}

export function PrototypeMethodologyPage() {
  const lifecyclePubs = canonicalPublications.filter((pub) => pub.revisions.length > 1);
  return (
    <PageShell
      active="canary"
      footerNote="Prototype methodology — every sha and count on this page comes from the bundled September campaign artifacts; nothing is invented or zero-filled."
    >
      <div className="eval-container eval-methodology">
        <div className="eval-hero">
          <p className="eval-eyebrow">
            <PrototypeTag /> Methodology
          </p>
          <h1 className="eval-title">
            Methodology<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            How the eval evidence on this prototype was produced, what it covers, and how it is
            versioned, published, and exported — with the exact artifact identities (benchmark shas,
            grader sha, harness commits) for each campaign.
          </p>
        </div>

        <PrototypeBanner />

        <div className="eval-method-grid" style={{ marginTop: "18px" }}>
          <Panel
            className="eval-proto-wide"
            title="Benchmarks and graders"
            description="Frozen suite files and the deterministic grader every campaign pins by sha256. Planned slots = cases × repetitions."
          >
            <div className="eval-method-body">
              <p>
                The tool catalog for all measured runs is{" "}
                <code className="eval-proto-id">{CATALOG_LABEL}</code> (catalog sha{" "}
                <Sha value={CATALOG_SHA_31_TOOLS} />
                ), and grading runs from <code className="eval-proto-id">grading.ts</code> at sha{" "}
                <Sha value={GRADER_SHA256} />. The Portfolio suite ships definitions only — no
                measured evidence exists for it, so it never carries counts.
              </p>
            </div>
            <SuiteTable />
          </Panel>

          <Panel
            className="eval-proto-wide"
            title="Campaigns and harnesses"
            description="The three measured campaigns plus the synthetic demo campaign, with exact harness and source identities."
          >
            <CampaignTable />
          </Panel>

          <Panel
            className="eval-proto-wide"
            title="Coverage and limitations per source"
            description="Per-campaign limitations plus per-run dispatch coverage, grading coverage, counts, withheld fields, and the authoritative source each count was derived from."
          >
            {canonicalCampaigns.map((campaign) => (
              <CampaignCoverage key={campaign.campaignId} campaign={campaign} />
            ))}
          </Panel>

          <Panel
            className="eval-proto-wide"
            title="States, checks, and reason codes"
            description="The vocabulary every page renders — nothing is zero-filled and unavailable states stay reason-coded."
          >
            <div className="eval-method-body eval-proto-vocab">
              <div>
                <p className="eval-proto-section-label">Execution states</p>
                <dl className="eval-proto-defs">
                  <dt>started</dt>
                  <dd>
                    completed + timed_out + runtime_failure + pending — the only denominator ever
                    used for the headline rate.
                  </dd>
                  {EXECUTION_STATUSES.map((status) => (
                    <div key={status}>
                      <dt>{status}</dt>
                      <dd>
                        {status === "completed" &&
                          "Finished; the only state that carries a pass/fail verdict."}
                        {status === "timed_out" &&
                          "Hit the campaign timeout (2 min); never graded, never counted as failed."}
                        {status === "runtime_failure" &&
                          "Harness or transport failure; never graded, never counted as failed."}
                        {status === "pending" && "Dispatched but no terminal state recorded yet."}
                        {status === "unstarted" &&
                          "A declared plan/status source proves the slot never ran — not zero-filled."}
                        {status === "unknown" &&
                          "No authoritative plan/status source exists, so the slot's state is unknowable."}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="eval-proto-section-label">Evidence availability</p>
                <dl className="eval-proto-defs">
                  <div>
                    <dt>available</dt>
                    <dd>The value is present in the source artifact.</dd>
                  </div>
                  <div>
                    <dt>withheld · privacy_review / not_bound</dt>
                    <dd>
                      The value exists but review policy excludes it (e.g. raw answer text, tool
                      arguments).
                    </dd>
                  </div>
                  <div>
                    <dt>not_retained</dt>
                    <dd>Never captured, or not carried into the published bundle.</dd>
                  </div>
                  <div>
                    <dt>not_recorded</dt>
                    <dd>Expected in the source but missing from it.</dd>
                  </div>
                  <div>
                    <dt>aggregate_only</dt>
                    <dd>
                      The statistic is retained but its sample count is not — always disclosed.
                    </dd>
                  </div>
                  <div>
                    <dt>no_declared_method</dt>
                    <dd>
                      No declared method exists to produce the value (e.g. answer accuracy, USD
                      cost).
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="eval-proto-section-label">Eligibility reason codes</p>
                <dl className="eval-proto-defs">
                  {ELIGIBILITY_REASONS.map((reason) => (
                    <div key={reason}>
                      <dt>{reason}</dt>
                      <dd>{eligibilityText(reason)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="eval-method-body">
              <p>
                Verdicts and checks: only <code className="eval-proto-id">completed</code> attempts
                carry pass/fail; timed_out and runtime_failure are{" "}
                <code className="eval-proto-id">not_graded</code>. Checks render as pass / fail /
                not_applicable / not_evaluated, and each run records whether its checks are{" "}
                <code className="eval-proto-id">native</code> or{" "}
                <code className="eval-proto-id">derived_from_scores</code>. Dispatch coverage
                renders as {dispatchCoverageText("complete")} / {dispatchCoverageText("incomplete")}{" "}
                / {dispatchCoverageText("unknown")}; a headline rate (passes/started, the only sort
                key) is shown only when coverage is complete.
              </p>
            </div>
          </Panel>

          <Panel
            className="eval-proto-wide"
            title="Provenance"
            description="Every run's authoritative source artifact: runId, source kind, recorded sha256, and source commit. Campaign-result runs are labelled by their schemaVersion."
          >
            <div className="eval-proto-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Source kind</th>
                    <th scope="col">Source artifact</th>
                    <th scope="col">sha256</th>
                    <th scope="col">Commit</th>
                    <th scope="col">Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {canonicalRuns.map((run) => {
                    const info = sourceInfo(run);
                    const baseline = resolveBaselineRun(run);
                    return (
                      <tr key={run.runId}>
                        <th scope="row">
                          <code className="eval-proto-id">{run.runId}</code>
                          {run.origin === "synthetic" && <SyntheticTag />}
                        </th>
                        <td>
                          <span className="eval-proto-kind">
                            {KIND_LABEL[info.kind]}
                            {info.schemaVersion ? ` · ${info.schemaVersion}` : ""}
                          </span>
                        </td>
                        <td>
                          {run.provenance.sourceLabel}
                          {info.note && <span className="eval-proto-cell-note">{info.note}</span>}
                        </td>
                        <td>
                          <Sha value={info.sha256} />
                        </td>
                        <td>
                          <Commit value={run.provenance.sourceCommit} />
                        </td>
                        <td>
                          {run.provenance.baselineRunId ? (
                            <span className="eval-proto-cell-note">
                              embeds{" "}
                              <code className="eval-proto-id">
                                {baseline?.runId ?? run.provenance.baselineRunId}
                              </code>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            className="eval-proto-wide"
            title="Publication lifecycle"
            description="eval-publication.v1 lifecycle: contiguous revisions, corrections as new immutable snapshots, withdrawals that remove result bytes but stay visible."
          >
            <div className="eval-method-body">
              <p>
                {canonicalPublications.length} publications are bundled —{" "}
                {canonicalPublications.filter((p) => p.dataOrigin === "measured").length} measured
                and {canonicalPublications.filter((p) => p.dataOrigin === "synthetic").length}{" "}
                synthetic. Every bundled publication is a{" "}
                <code className="eval-proto-id">synthetic_preview</code>: the review metadata
                demonstrates the lifecycle shape; no measured review exists yet.
              </p>
            </div>
            <div className="eval-proto-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th scope="col">Publication</th>
                    <th scope="col">Run</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Status</th>
                    <th scope="col">Revisions</th>
                  </tr>
                </thead>
                <tbody>
                  {canonicalPublications.map((pub) => (
                    <tr key={pub.publicationId}>
                      <th scope="row">
                        <code className="eval-proto-id">{pub.publicationId}</code>
                      </th>
                      <td>
                        <code className="eval-proto-id">{pub.runId}</code>
                      </td>
                      <td>
                        <OriginTag origin={pub.dataOrigin} />
                      </td>
                      <td>{pub.status}</td>
                      <td>
                        {pub.revisions
                          .map(
                            (rev) =>
                              `r${rev.revision} ${rev.state}${rev.kind === "withdrawal_notice" ? " (withdrawal notice)" : ""}`,
                          )
                          .join(" → ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lifecyclePubs.map((pub) => (
              <div className="eval-proto-campaign" key={pub.publicationId}>
                <div className="eval-proto-campaign-head">
                  <h3>
                    <code className="eval-proto-id">{pub.publicationId}</code>
                  </h3>
                  <span className="eval-proto-cell-note">
                    current revision: {pub.currentRevisionId}
                  </span>
                </div>
                <ul className="eval-proto-limitations eval-proto-revlist">
                  {pub.revisions.map((rev) => (
                    <li key={rev.revisionId}>
                      <RevisionChain revision={rev} />
                      <span className="eval-proto-cell-note">
                        {rev.publishedAt} · path {rev.path ?? "removed"} · sha{" "}
                        <Sha value={rev.sha256} />
                      </span>
                      {rev.supersedes && (
                        <span className="eval-proto-cell-note">
                          {rev.supersedes.reason}: {rev.supersedes.summary}
                        </span>
                      )}
                      {rev.withdrawal && (
                        <span className="eval-proto-cell-note">
                          withdrawal ({rev.withdrawal.reason}): {rev.withdrawal.notice}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Panel>

          <Panel
            title="Canonical exports"
            description="Every export carries an explicit schemaVersion — there is no unversioned download format."
          >
            <div className="eval-method-body">
              <dl className="eval-proto-defs">
                {EXPORT_REFERENCES.map((ref) => (
                  <div key={ref.schemaVersion}>
                    <dt>{ref.schemaVersion}</dt>
                    <dd>
                      <span className="eval-proto-dt-title">{ref.title}</span> ·{" "}
                      {ref.status === "draft" ? "draft" : "implemented"} — {ref.summary}{" "}
                      <a
                        className="eval-text-link"
                        href={ref.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View reference
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </a>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Panel>

          <Panel
            title="Synthetic-row disclosure"
            description="How fabricated rows are kept visibly separate from measured evidence."
          >
            <div className="eval-method-body">
              <ul className="eval-proto-policy">
                <li>
                  Synthetic rows carry a <SyntheticTag /> pill wherever they appear and are never
                  merged into measured aggregates.
                </li>
                <li>
                  Synthetic runs are excluded from ranked placement on the leaderboard — they exist
                  to demonstrate the vocabulary (incomplete coverage, unknown coverage, labels-only
                  configuration, a second configuration cohort).
                </li>
                <li>
                  Meridian (<code className="eval-proto-id">meridian-spot-1</code>) is the only
                  synthetic model; it exists so the leaderboard shows a model outside the measured
                  cohort.
                </li>
                <li>
                  The withdrawn run <code className="eval-proto-id">sol-spot-withdrawn</code> keeps
                  its identifiers and a withdrawal notice; its result bytes were removed — nothing
                  is back-filled.
                </li>
                <li>
                  Synthetic numbers are illustrative on purpose and are disclosed as such; they
                  never overwrite or average into measured counts.
                </li>
              </ul>
            </div>
          </Panel>

          <Panel
            className="eval-proto-wide"
            title="Downloads"
            description="Direct links to the authoritative artifacts behind every number on this site. The recorded sha column shows the digest pinned by a bundle manifest, report source list, or canonical provenance — “—” means the file carries no recorded self-digest."
          >
            <div className="eval-proto-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Artifact</th>
                    <th scope="col">File</th>
                    <th scope="col">Recorded sha256</th>
                  </tr>
                </thead>
                <tbody>
                  {DOWNLOADS.map((row) => (
                    <tr key={row.path}>
                      <td>
                        <code className="eval-proto-id">{row.group}</code>
                      </td>
                      <td>
                        {row.label}
                        {row.note && <span className="eval-proto-cell-note">{row.note}</span>}
                      </td>
                      <td>
                        <RepoFile path={row.path} />
                      </td>
                      <td>
                        <Sha value={row.recordedSha} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
