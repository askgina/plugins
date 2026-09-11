/**
 * Synthetic production-UI fixtures, not measurements of the named models.
 * Build full results and publication histories before deriving comparison rows.
 * New publications, captures, reports and configuration declarations have
 * byte-exact digests. Synthetic evaluator/toolchain identities hash labeled
 * strings, not real executables. Canonical fixtures keep their original source
 * digests; unavailable source bytes are not reconstructed.
 *
 * crypto.subtle hashing requires top-level await in this story-only module.
 * All imports from Node-dependent modules are type-only.
 */
import type {
  PublicEvalAttemptCapture,
  PublicEvalAttemptSummary,
  PublicEvalCheckName,
  PublicEvalCheckVerdict,
  PublicEvalFailureCategory,
  PublicEvalIndex,
  PublicEvalPublication,
  PublicEvalResult,
} from "@askgina/contracts";
import { Effect, Schema } from "effect";
import type { SanitizedEvalRunReport } from "../../../../packages/evals/src/report";
import canonicalCaptureRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-attempt-capture.json?raw";
import correctionRev1Raw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev1.json?raw";
import correctionRev2Raw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import withdrawalNoticeRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-withdrawal-notice.json?raw";
import aggregateOnlyRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-result-aggregate-only.json?raw";
import incompleteCoverageRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-result-incomplete-coverage.json?raw";
import withheldRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-result-unavailable-withheld.json?raw";
import { buildPublicComparisonCatalog } from "../lib/public-comparison";
import {
  parsePublicArtifact,
  publicArtifactSha256,
  type ParsedPublicArtifact,
} from "../lib/public-results";
import type { PublicComparisonState } from "../lib/use-public-comparison";

export type ProductionReadyState = Extract<PublicComparisonState, { status: "ready" }>;

/** Exact bytes behind one state, for validation with the Node-only schemas. */
export interface ProductionFixtureArtifacts {
  /** Serialized eval-index.v1 document the state's catalog was built from. */
  readonly indexRaw: string;
  /**
   * Serialized eval-publication.v1 snapshots keyed by the index path that
   * lists them: current and superseded result revisions plus withdrawal
   * notices. Each index sha256 is the digest of exactly these bytes.
   */
  readonly snapshots: Readonly<Record<string, string>>;
  /** Available synthetic source bytes keyed by digest; canonical missing sources stay absent. */
  readonly sourceRawBySha256: Readonly<Record<string, string>>;
}

type IndexEntry = PublicEvalIndex["publications"][number];
type IndexRevision = IndexEntry["revisions"][number];
type Benchmark = PublicEvalResult["benchmark"];
type Configuration = PublicEvalResult["configuration"];

const CHECK_NAMES = [
  "routing",
  "arguments",
  "safety",
  "completion",
  "skillActivation",
] as const satisfies readonly PublicEvalCheckName[];

/** Mirrors PUBLIC_EVAL_FAILURE_CATEGORY_BY_CHECK; the contracts runtime is Node-only. */
const FAILURE_CATEGORY_BY_CHECK: Readonly<Record<PublicEvalCheckName, PublicEvalFailureCategory>> =
  {
    routing: "routing_mismatch",
    arguments: "argument_mismatch",
    safety: "safety_violation",
    completion: "trial_or_tool_failure",
    skillActivation: "skill_activation_mismatch",
  };

const NOT_EVALUATED = { availability: "not_evaluated", reason: "no_declared_method" } as const;
const INDEX_GENERATED_AT = "2026-09-11T09:00:00Z";
const SUITE_ID = "synthetic-suite-gina-conformance";
const REPETITIONS = 2;
/** Revision 1 date of the canonical withdrawn publication; see synthetic-index.json. */
const CANONICAL_WITHDRAWN_REVISION_1_PUBLISHED_AT = "2026-09-04T12:00:00Z";

interface CaseSpec {
  readonly id: string;
  /** Routing, arguments and completion are always graded; these two only where the case declares them. */
  readonly safety: boolean;
  readonly skillActivation: boolean;
}

const CASES: readonly CaseSpec[] = [
  { id: "synthetic-case-portfolio-balances", safety: true, skillActivation: true },
  { id: "synthetic-case-perps-price", safety: true, skillActivation: false },
  { id: "synthetic-case-polymarket-search", safety: false, skillActivation: true },
  { id: "synthetic-case-swap-history", safety: true, skillActivation: false },
  { id: "synthetic-case-safety-refusal", safety: true, skillActivation: false },
  { id: "synthetic-case-skill-activation", safety: false, skillActivation: true },
];

/** One retained attempt: duration and captured [input, output] tokens, or null when usage was not captured. */
type Observation = readonly [
  durationMs: number,
  tokens: readonly [input: number, output: number] | null,
];

interface RunSpec {
  /** Suffix shared by the publication, run, result and snapshot identifiers. */
  readonly slug: string;
  readonly candidate: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly startedAt: string;
  readonly publishedAt: string;
  /** Case-major, repetition-minor: CASES[0] repetition 1, CASES[0] repetition 2, CASES[1] repetition 1, ... */
  readonly observations: readonly Observation[];
  /** Failed checks by case id and repetition; every other graded check passes. */
  readonly failures: Readonly<
    Record<string, Readonly<Record<number, readonly PublicEvalCheckName[]>>>
  >;
  /** When set, a labels-only revision 1 is published first and the pinned revision 2 supersedes it. */
  readonly labelsOnlyRevisionPublishedAt?: string;
}

// Five configurations share one benchmark. The primary has a correction,
// a failed attempt and the ready cohort's only uncaptured usage sample.
const READY_SPECS: readonly RunSpec[] = [
  {
    slug: "2026-09-10-claude-sonnet-4.5",
    candidate: "synthetic-candidate-claude-sonnet-4.5",
    model: "synthetic/claude-sonnet-4.5",
    reasoning: "synthetic-reasoning-medium",
    startedAt: "2026-09-10T08:00:00Z",
    labelsOnlyRevisionPublishedAt: "2026-09-10T11:00:00Z",
    publishedAt: "2026-09-10T13:00:00Z",
    observations: [
      [1420, [1180, 240]],
      [1310, [1150, 235]],
      [980, [920, 160]],
      [1040, [935, 170]],
      [2210, null],
      [2080, [1610, 390]],
      [1930, [1490, 310]],
      [1660, [1420, 300]],
      [760, [640, 120]],
      [810, [655, 125]],
      [1540, [1260, 280]],
      [1490, [1230, 270]],
    ],
    failures: { "synthetic-case-swap-history": { 1: ["arguments", "completion"] } },
  },
  {
    slug: "2026-09-10-gpt-5",
    candidate: "synthetic-candidate-gpt-5",
    model: "synthetic/gpt-5",
    reasoning: "synthetic-reasoning-high",
    startedAt: "2026-09-10T08:20:00Z",
    publishedAt: "2026-09-10T12:00:00Z",
    observations: [
      [2310, [1530, 480]],
      [2240, [1510, 470]],
      [1720, [1190, 330]],
      [1690, [1205, 335]],
      [3480, [2140, 760]],
      [3390, [2090, 740]],
      [2950, [1880, 610]],
      [2870, [1860, 600]],
      [1210, [820, 210]],
      [1180, [835, 205]],
      [2620, [1640, 520]],
      [2540, [1620, 510]],
    ],
    failures: {},
  },
  {
    slug: "2026-09-10-gemini-2.5-pro",
    candidate: "synthetic-candidate-gemini-2.5-pro",
    model: "synthetic/gemini-2.5-pro",
    reasoning: "synthetic-reasoning-medium",
    startedAt: "2026-09-10T08:40:00Z",
    publishedAt: "2026-09-10T12:05:00Z",
    observations: [
      [1180, [1040, 210]],
      [1120, [1025, 205]],
      [860, [810, 140]],
      [880, [825, 150]],
      [1990, [1480, 330]],
      [2430, [1720, 360]],
      [1610, [1310, 270]],
      [1570, [1290, 265]],
      [690, [560, 105]],
      [720, [575, 110]],
      [1350, [1120, 240]],
      [1290, [1090, 230]],
    ],
    failures: {
      "synthetic-case-polymarket-search": { 2: ["routing", "completion"] },
      "synthetic-case-skill-activation": { 1: ["skillActivation"] },
    },
  },
  {
    slug: "2026-09-10-llama-4-maverick",
    candidate: "synthetic-candidate-llama-4-maverick",
    model: "synthetic/llama-4-maverick",
    reasoning: null,
    startedAt: "2026-09-10T09:00:00Z",
    publishedAt: "2026-09-10T12:10:00Z",
    observations: [
      [640, [880, 150]],
      [610, [860, 145]],
      [450, [690, 110]],
      [470, [700, 115]],
      [1320, [1210, 260]],
      [1280, [1180, 250]],
      [990, [1010, 190]],
      [1010, [1030, 200]],
      [380, [470, 80]],
      [410, [480, 85]],
      [870, [920, 170]],
      [830, [900, 165]],
    ],
    failures: {
      "synthetic-case-portfolio-balances": { 2: ["arguments"] },
      "synthetic-case-polymarket-search": { 1: ["routing", "completion"] },
      "synthetic-case-swap-history": { 2: ["arguments", "completion"] },
      "synthetic-case-safety-refusal": { 1: ["safety"] },
    },
  },
  {
    slug: "2026-09-10-mistral-large-3",
    candidate: "synthetic-candidate-mistral-large-3",
    model: "synthetic/mistral-large-3",
    reasoning: "synthetic-reasoning-low",
    startedAt: "2026-09-10T09:20:00Z",
    publishedAt: "2026-09-10T12:15:00Z",
    observations: [
      [1050, [980, 190]],
      [990, [960, 185]],
      [730, [760, 130]],
      [760, [775, 135]],
      [1780, [1390, 300]],
      [1840, [1410, 310]],
      [1430, [1200, 240]],
      [1390, [1180, 235]],
      [590, [520, 95]],
      [610, [535, 100]],
      [1170, [1050, 210]],
      [1210, [1080, 220]],
    ],
    failures: {
      "synthetic-case-perps-price": { 1: ["arguments"] },
      "synthetic-case-polymarket-search": { 2: ["skillActivation"] },
      "synthetic-case-skill-activation": { 2: ["routing", "completion", "skillActivation"] },
    },
  },
];

// Second cohort: the same suite under fixture catalog version 4, repeating two
// ready candidates under distinct publications.
const FIXTURES_V4_SPECS: readonly RunSpec[] = [
  {
    slug: "2026-09-11-claude-sonnet-4.5-fixtures-v4",
    candidate: "synthetic-candidate-claude-sonnet-4.5",
    model: "synthetic/claude-sonnet-4.5",
    reasoning: "synthetic-reasoning-medium",
    startedAt: "2026-09-11T07:00:00Z",
    publishedAt: "2026-09-11T08:30:00Z",
    observations: [
      [1380, [1210, 250]],
      [1340, [1190, 245]],
      [1010, [940, 165]],
      [990, [930, 160]],
      [2150, [1650, 400]],
      [2190, [1670, 405]],
      [1870, [1510, 320]],
      [1820, [1480, 310]],
      [790, [660, 125]],
      [770, [650, 120]],
      [1500, [1270, 285]],
      [1530, [1290, 290]],
    ],
    failures: {},
  },
  {
    slug: "2026-09-11-gemini-2.5-pro-fixtures-v4",
    candidate: "synthetic-candidate-gemini-2.5-pro",
    model: "synthetic/gemini-2.5-pro",
    reasoning: "synthetic-reasoning-medium",
    startedAt: "2026-09-11T07:30:00Z",
    publishedAt: "2026-09-11T08:45:00Z",
    observations: [
      [1210, [1060, 215]],
      [1150, [1040, 210]],
      [890, [830, 145]],
      [870, [820, 140]],
      [2050, [1510, 340]],
      [2020, [1490, 335]],
      [1640, [1330, 275]],
      [1600, [1300, 270]],
      [710, [570, 108]],
      [700, [565, 106]],
      [1330, [1110, 238]],
      [1360, [1130, 242]],
    ],
    failures: {
      "synthetic-case-perps-price": { 2: ["arguments"] },
      "synthetic-case-polymarket-search": { 1: ["routing", "completion"] },
      "synthetic-case-safety-refusal": { 2: ["safety"] },
    },
  },
];

// Retained attempts without any captured usage: the token metric is not
// retained rather than zero.
const MISSING_METRICS_SPEC: RunSpec = {
  slug: "2026-09-10-gpt-5-mini",
  candidate: "synthetic-candidate-gpt-5-mini",
  model: "synthetic/gpt-5-mini",
  reasoning: "synthetic-reasoning-low",
  startedAt: "2026-09-10T09:40:00Z",
  publishedAt: "2026-09-10T12:20:00Z",
  observations: [
    [900, null],
    [870, null],
    [640, null],
    [660, null],
    [1500, null],
    [1460, null],
    [1190, null],
    [1210, null],
    [520, null],
    [540, null],
    [1010, null],
    [980, null],
  ],
  failures: { "synthetic-case-perps-price": { 2: ["arguments"] } },
};

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const sha256 = (text: string): Effect.Effect<string> =>
  Effect.promise(() => publicArtifactSha256(encode(text)));
/** Compact preimage of an attempt identity, as the contracts' identity helper writes it. */
const encodeAttemptIdentity = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.Finite])),
);
/** Pretty document bytes like the exporter writes; shapes are typed at construction, not here. */
const documentJson = Schema.fromJsonString(Schema.Unknown, { space: 2 });
const encodeDocument = Schema.encodeEffect(documentJson);
const encodeDocumentSync = Schema.encodeSync(documentJson);
const decodeDocument = Schema.decodeUnknownSync(documentJson);
const encodeCheckSummary = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const sourceBytes: Record<string, string> = {};
const retainSource = (raw: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const digest = yield* sha256(raw);
    sourceBytes[digest] = raw;
    return digest;
  });
const syntheticDigest = (label: string): Effect.Effect<string> =>
  retainSource(`synthetic-digest:${label}`);

const pick = <T>(items: readonly T[], index: number, what: string): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`Production fixture is missing ${what} ${index}`);
  return item;
};

/** Nearest-rank percentile over ascending durations, as the result schema defines it. */
const nearestRank = (sorted: readonly number[], percentile: number): number =>
  pick(sorted, Math.ceil(percentile * sorted.length) - 1, "latency sample");

const artifactFailure = (parsed: ParsedPublicArtifact, expected: "publication" | "index"): string =>
  `expected ${expected}, got ${parsed.kind === "unsupported" ? parsed.message : parsed.kind}`;

const canonicalPublication = (raw: string, name: string): PublicEvalPublication => {
  const parsed = parsePublicArtifact(encode(raw));
  if (parsed.kind !== "publication") {
    throw new Error(
      `Canonical fixture ${name} is invalid: ${artifactFailure(parsed, "publication")}`,
    );
  }
  return parsed.publication;
};

/** Bare canonical result documents are validated when their wrapping publication is sealed. */
const canonicalResult = (raw: string): PublicEvalResult => decodeDocument(raw) as PublicEvalResult;

const resultOf = (publication: PublicEvalPublication): PublicEvalResult => {
  if (publication.content.kind !== "result") {
    throw new Error(`${publication.revisionId} is not a result publication`);
  }
  return publication.content.result;
};

const canonicalRev2 = canonicalPublication(
  correctionRev2Raw,
  "synthetic-publication-correction-rev2.json",
);
if (canonicalRev2.supersedes === null) {
  throw new Error("Canonical correction fixture has no supersedes metadata");
}
/** Reason and summary of the canonical labels-only to pinned correction. */
const canonicalCorrection = canonicalRev2.supersedes;

const buildAttempts = (
  spec: RunSpec,
  runId: string,
): Effect.Effect<PublicEvalAttemptSummary[], Schema.SchemaError> =>
  Effect.gen(function* () {
    if (spec.observations.length !== CASES.length * REPETITIONS) {
      throw new Error(`${spec.slug} needs ${CASES.length * REPETITIONS} observations`);
    }
    for (const caseId of Object.keys(spec.failures)) {
      if (!CASES.some((testCase) => testCase.id === caseId)) {
        throw new Error(`${spec.slug} fails unknown case ${caseId}`);
      }
    }
    return yield* Effect.all(
      CASES.flatMap((testCase, caseIndex) =>
        Array.from({ length: REPETITIONS }, (_, offset) =>
          Effect.gen(function* () {
            const repetition = offset + 1;
            const [durationMs, tokens] = pick(
              spec.observations,
              caseIndex * REPETITIONS + offset,
              "observation",
            );
            const failed = spec.failures[testCase.id]?.[repetition] ?? [];
            const verdictFor = (name: PublicEvalCheckName): PublicEvalCheckVerdict => {
              const graded =
                name === "safety"
                  ? testCase.safety
                  : name === "skillActivation"
                    ? testCase.skillActivation
                    : true;
              if (!graded) {
                if (failed.includes(name)) throw new Error(`${testCase.id} does not grade ${name}`);
                return "not_applicable";
              }
              return failed.includes(name) ? "fail" : "pass";
            };
            const checks = {
              routing: verdictFor("routing"),
              arguments: verdictFor("arguments"),
              safety: verdictFor("safety"),
              completion: verdictFor("completion"),
              skillActivation: verdictFor("skillActivation"),
            };
            const failureCategories = CHECK_NAMES.filter((name) => checks[name] === "fail").map(
              (name) => FAILURE_CATEGORY_BY_CHECK[name],
            );
            return {
              id: `attempt-${yield* sha256(
                yield* encodeAttemptIdentity([runId, testCase.id, repetition]),
              )}`,
              runId,
              caseId: testCase.id,
              repetition,
              verdict: failureCategories.length === 0 ? "pass" : "fail",
              validity: "valid",
              evidenceAvailability: "available",
              checks,
              failureCategories,
              durationMs,
              tokenUsage:
                tokens === null
                  ? null
                  : {
                      inputTokens: tokens[0],
                      outputTokens: tokens[1],
                      totalTokens: tokens[0] + tokens[1],
                    },
              replacementOf: null,
            } satisfies PublicEvalAttemptSummary;
          }),
        ),
      ),
      { concurrency: "unbounded" },
    );
  });

interface FixtureIds {
  readonly publicationId: string;
  readonly runId: string;
  readonly resultId: string;
}

const fixtureIds = (slug: string): FixtureIds => ({
  publicationId: `synthetic-publication-${slug}`,
  runId: `synthetic-run-${slug}`,
  resultId: `synthetic-result-${slug}`,
});

/** Derives every aggregate from the retained attempts so raw totals, dimensions and metrics agree by construction. */
const buildResult = (
  ids: FixtureIds,
  benchmark: Benchmark,
  configuration: Configuration,
  startedAt: string,
  attempts: readonly PublicEvalAttemptSummary[],
) => {
  const total = attempts.length;
  let passed = 0;
  const caseIds = new Set<string>();
  const failedCases = new Set<string>();
  const durations: number[] = [];
  const tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0, sampleCount: 0 };
  const dimensions = {
    routing: { passed: 0, failed: 0, notApplicable: 0 },
    arguments: { passed: 0, failed: 0, notApplicable: 0 },
    safety: { passed: 0, failed: 0, notApplicable: 0 },
    completion: { passed: 0, failed: 0, notApplicable: 0 },
    skillActivation: { passed: 0, failed: 0, notApplicable: 0 },
  };
  for (const attempt of attempts) {
    caseIds.add(attempt.caseId);
    if (attempt.verdict === "pass") passed += 1;
    else failedCases.add(attempt.caseId);
    durations.push(attempt.durationMs);
    for (const name of CHECK_NAMES) {
      const verdict = attempt.checks[name];
      dimensions[name][
        verdict === "pass" ? "passed" : verdict === "fail" ? "failed" : "notApplicable"
      ] += 1;
    }
    if (attempt.tokenUsage !== null) {
      tokens.inputTokens += attempt.tokenUsage.inputTokens;
      tokens.outputTokens += attempt.tokenUsage.outputTokens;
      tokens.totalTokens += attempt.tokenUsage.totalTokens;
      tokens.sampleCount += 1;
    }
  }
  durations.sort((left, right) => left - right);
  return {
    schemaVersion: "eval-result.v1",
    resultId: ids.resultId,
    dataOrigin: "synthetic",
    measures: "conformance",
    run: { runId: ids.runId, startedAt },
    benchmark,
    configuration,
    coverage: {
      planSource: "run_manifest",
      planSha256: null,
      statusSha256: null,
      status: "complete",
      plannedCases: CASES.length,
      plannedAttempts: CASES.length * REPETITIONS,
    },
    counts: {
      attempts: { total, passed, failed: total - passed },
      cases: {
        total: caseIds.size,
        passedEveryAttempt: caseIds.size - failedCases.size,
        failedAnyAttempt: failedCases.size,
      },
    },
    dimensions,
    metrics: {
      passRate: {
        availability: "available",
        unit: "ratio",
        value: passed / total,
        numerator: passed,
        denominator: total,
      },
      latencyMs: {
        availability: "available",
        unit: "milliseconds",
        p50: nearestRank(durations, 0.5),
        p95: nearestRank(durations, 0.95),
        max: nearestRank(durations, 1),
        sampleCount: total,
      },
      tokenUsage:
        tokens.sampleCount === 0
          ? { availability: "not_retained", reason: "not_captured" }
          : { availability: "available", unit: "tokens", ...tokens },
      answerAccuracy: NOT_EVALUATED,
      usdCost: NOT_EVALUATED,
      uncertainty: NOT_EVALUATED,
    },
    evidence: { attemptDetail: "available" },
    ranking: { status: "unranked", reasons: ["pilot", "synthetic"] },
    attempts,
  } satisfies Omit<PublicEvalResult, "source">;
};

const publicationDoc = (
  result: PublicEvalResult,
  publicationId: string,
  revision: number,
  publishedAt: string,
  supersedes: PublicEvalPublication["supersedes"],
): PublicEvalPublication => ({
  schemaVersion: "eval-publication.v1",
  publicationId,
  revisionId: `${publicationId}-rev${revision}`,
  revision,
  runId: result.run.runId,
  dataOrigin: "synthetic",
  publishedAt,
  review: { status: "synthetic_preview" },
  supersedes,
  content: { kind: "result", result },
});

interface Snapshot {
  readonly path: string;
  readonly raw: string;
  readonly sha256: string;
  readonly publication: PublicEvalPublication;
}

/** Serializes, validates and hashes one publication; the parsed copy is what catalogs receive. */
const seal = (
  doc: PublicEvalPublication,
  path: string,
): Effect.Effect<Snapshot, Schema.SchemaError> =>
  Effect.gen(function* () {
    const raw = yield* encodeDocument(doc);
    const bytes = encode(raw);
    const parsed = parsePublicArtifact(bytes);
    if (parsed.kind !== "publication") {
      throw new Error(
        `Production fixture ${doc.revisionId} is invalid: ${artifactFailure(parsed, "publication")}`,
      );
    }
    return {
      path,
      raw,
      sha256: yield* Effect.promise(() => publicArtifactSha256(bytes)),
      publication: parsed.publication,
    };
  });

interface IndexedRecord {
  readonly entry: IndexEntry;
  readonly snapshots: readonly Snapshot[];
}

interface BuiltRun extends IndexedRecord {
  /** The current result revision, the only one a catalog may list. */
  readonly publication: PublicEvalPublication;
  readonly sourceDigests: readonly (string | null)[];
}

const currentEntry = (snapshots: readonly Snapshot[]): IndexEntry => {
  const current = pick(snapshots, snapshots.length - 1, "revision");
  const result = resultOf(current.publication);
  return {
    publicationId: current.publication.publicationId,
    runId: current.publication.runId,
    review: { status: "synthetic_preview" },
    status: "current",
    currentRevisionId: current.publication.revisionId,
    summary: {
      suiteId: result.benchmark.suiteId,
      candidate: result.configuration.candidate,
      model: result.configuration.model,
      startedAt: result.run.startedAt,
    },
    revisions: snapshots.map((snapshot): IndexRevision => ({
      revisionId: snapshot.publication.revisionId,
      revision: snapshot.publication.revision,
      kind: "result",
      state: snapshot === current ? "current" : "superseded",
      publishedAt: snapshot.publication.publishedAt,
      path: snapshot.path,
      sha256: snapshot.sha256,
    })),
  };
};

interface FixtureIdentity {
  readonly evaluatorSha256: string;
  readonly skillsSha256: string;
  readonly toolchainSha256: string;
}

const buildRun = (
  spec: RunSpec,
  benchmark: Benchmark,
  identity: FixtureIdentity,
): Effect.Effect<BuiltRun, Schema.SchemaError> =>
  Effect.gen(function* () {
    const { evaluatorSha256, skillsSha256, toolchainSha256 } = identity;
    const ids = fixtureIds(spec.slug);
    const labels = { candidate: spec.candidate, model: spec.model, reasoning: spec.reasoning };
    const settings = {
      cleanChat: benchmark.cleanChat,
      accountClass: benchmark.accountClass,
      repetitions: benchmark.repetitions,
    };
    const [attempts, runSettingsSha256] = yield* Effect.all(
      [
        buildAttempts(spec, ids.runId),
        encodeDocument({ ...labels, ...settings, target: benchmark.target }).pipe(
          Effect.flatMap(retainSource),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const pinnedSha256 = yield* retainSource(
      yield* encodeDocument({
        schemaVersion: "eval-configuration.v1",
        ...labels,
        target: benchmark.target,
        suiteId: benchmark.suiteId,
        suiteVersion: benchmark.suiteVersion,
        fixtureVersion: benchmark.fixtureVersion,
        catalogSha: benchmark.catalogSha,
        settings,
        identity: { evaluatorSha256, skillsSha256, toolchainSha256, runSettingsSha256 },
      }),
    );
    const body = buildResult(
      ids,
      benchmark,
      { availability: "pinned", ...labels, pinnedSha256 },
      spec.startedAt,
      attempts,
    );
    const dimension = (name: PublicEvalCheckName) => ({
      passed: body.dimensions[name].passed,
      failed: body.dimensions[name].failed,
    });
    const latency = body.metrics.latencyMs;
    const usage = body.metrics.tokenUsage;
    // These synthetic results consist only of the retained check summaries.
    const resultSizes = attempts.map(
      (attempt) => encode(encodeCheckSummary(attempt.checks)).byteLength,
    );
    resultSizes.sort((left, right) => left - right);
    const report: SanitizedEvalRunReport = {
      schemaVersion: "v1",
      runId: ids.runId,
      candidate: spec.candidate,
      model: spec.model,
      ...(spec.reasoning === null ? {} : { reasoning: spec.reasoning }),
      target: benchmark.target,
      startedAt: spec.startedAt,
      ...settings,
      aggregate: {
        schemaVersion: "v1",
        suiteId: benchmark.suiteId,
        suiteVersion: benchmark.suiteVersion,
        fixtureVersion: benchmark.fixtureVersion,
        catalogSha: benchmark.catalogSha,
        overall: { passed: body.counts.attempts.passed, total: attempts.length },
        dimensions: {
          routing: dimension("routing"),
          arguments: dimension("arguments"),
          safety: dimension("safety"),
          completion: dimension("completion"),
        },
        skillActivation: dimension("skillActivation"),
        latencyMs: { p50: latency.p50, p95: latency.p95, max: latency.max },
        totalResultBytes: {
          p50: nearestRank(resultSizes, 0.5),
          p95: nearestRank(resultSizes, 0.95),
          max: nearestRank(resultSizes, 1),
        },
        tokenUsage:
          usage.availability === "available"
            ? {
                observations: usage.sampleCount,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
              }
            : { observations: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        artifactPolicy: "sanitized",
      },
    };
    const reportSha256 = yield* retainSource(yield* encodeDocument(report));
    const capture: PublicEvalAttemptCapture = {
      schemaVersion: "eval-attempts.v1",
      runId: ids.runId,
      sourceReportSha256: reportSha256,
      attempts,
    };
    const pinned: PublicEvalResult = {
      ...body,
      source: {
        kind: "sanitized_aggregate_with_attempts",
        reportSchemaVersion: "v1",
        reportSha256,
        attemptCaptureSha256: yield* retainSource(yield* encodeDocument(capture)),
      },
    };
    const path = (revision: number): string => `synthetic/${spec.slug}-rev${revision}.json`;
    const snapshots: Snapshot[] = [];
    let supersedes: PublicEvalPublication["supersedes"] = null;
    if (spec.labelsOnlyRevisionPublishedAt !== undefined) {
      const labelsOnly: PublicEvalResult = {
        ...pinned,
        configuration: { availability: "labels_only", ...labels, pinnedSha256: null },
        ranking: {
          status: "unranked",
          reasons: ["pilot", "synthetic", "missing_pinned_configuration"],
        },
      };
      const superseded = yield* seal(
        publicationDoc(labelsOnly, ids.publicationId, 1, spec.labelsOnlyRevisionPublishedAt, null),
        path(1),
      );
      snapshots.push(superseded);
      supersedes = {
        revisionId: superseded.publication.revisionId,
        revision: superseded.publication.revision,
        reason: canonicalCorrection.reason,
        summary: canonicalCorrection.summary,
      };
    }
    const revision = snapshots.length + 1;
    const current = yield* seal(
      publicationDoc(pinned, ids.publicationId, revision, spec.publishedAt, supersedes),
      path(revision),
    );
    snapshots.push(current);
    return {
      publication: current.publication,
      entry: currentEntry(snapshots),
      snapshots,
      sourceDigests: [
        reportSha256,
        pinned.source.attemptCaptureSha256,
        pinnedSha256,
        benchmark.catalogSha,
        evaluatorSha256,
        skillsSha256,
        toolchainSha256,
        runSettingsSha256,
      ],
    };
  });

/** Publishes a canonical raw result as revision 1 of its own publication. */
const wrapCanonicalResult = (
  result: PublicEvalResult,
  slug: string,
  publishedAt: string,
): Effect.Effect<BuiltRun, Schema.SchemaError> =>
  Effect.gen(function* () {
    const current = yield* seal(
      publicationDoc(result, `synthetic-publication-${slug}`, 1, publishedAt, null),
      `synthetic/${slug}-rev1.json`,
    );
    return {
      publication: current.publication,
      entry: currentEntry([current]),
      snapshots: [current],
      sourceDigests: [
        result.source.reportSha256,
        result.source.attemptCaptureSha256,
        result.configuration.pinnedSha256,
        result.benchmark.catalogSha,
      ],
    };
  });

/** A withdrawn publication: revision 1 bytes removed, only the safe notice listed. */
const withdrawnRecord = (notice: Snapshot, removedPublishedAt: string): IndexedRecord => {
  const { publication } = notice;
  if (publication.content.kind !== "withdrawal_notice" || publication.supersedes === null) {
    throw new Error(`${publication.revisionId} is not a withdrawal notice`);
  }
  return {
    entry: {
      publicationId: publication.publicationId,
      runId: publication.runId,
      review: { status: "synthetic_preview" },
      status: "withdrawn",
      currentRevisionId: publication.revisionId,
      summary: null,
      revisions: [
        {
          revisionId: publication.supersedes.revisionId,
          revision: publication.supersedes.revision,
          kind: "result",
          state: "removed",
          publishedAt: removedPublishedAt,
          path: null,
          sha256: null,
        },
        {
          revisionId: publication.revisionId,
          revision: publication.revision,
          kind: "withdrawal_notice",
          state: "current",
          publishedAt: publication.publishedAt,
          path: notice.path,
          sha256: notice.sha256,
        },
      ],
    },
    snapshots: [notice],
  };
};

interface ProductionFixture {
  readonly state: ProductionReadyState;
  readonly artifacts: ProductionFixtureArtifacts;
}

/** Indexes the records, validates the index bytes and derives the catalog; withdrawn records contribute only their count. */
const fixture = (
  runs: readonly BuiltRun[],
  withdrawn: readonly IndexedRecord[] = [],
): ProductionFixture => {
  const records = [...runs, ...withdrawn];
  const doc: PublicEvalIndex = {
    schemaVersion: "eval-index.v1",
    dataOrigin: "synthetic",
    generatedAt: INDEX_GENERATED_AT,
    publications: records.map((record) => record.entry),
  };
  const indexRaw = encodeDocumentSync(doc);
  const parsed = parsePublicArtifact(encode(indexRaw));
  if (parsed.kind !== "index") {
    throw new Error(`Production fixture index is invalid: ${artifactFailure(parsed, "index")}`);
  }
  const sourceRawBySha256: Record<string, string> = {};
  for (const run of runs) {
    for (const digest of run.sourceDigests) {
      if (digest === null) continue;
      const raw = sourceBytes[digest];
      if (raw !== undefined) sourceRawBySha256[digest] = raw;
    }
  }
  return {
    state: {
      status: "ready",
      catalog: buildPublicComparisonCatalog(
        runs.map((run) => run.publication),
        parsed.index,
      ),
      message: null,
    },
    artifacts: {
      indexRaw,
      sourceRawBySha256,
      snapshots: Object.fromEntries(
        records.flatMap((record) =>
          record.snapshots.map((snapshot) => [snapshot.path, snapshot.raw]),
        ),
      ),
    },
  };
};

const benchmark = (fixtureVersion: number): Effect.Effect<Benchmark, Schema.SchemaError> =>
  Effect.gen(function* () {
    return {
      suiteId: SUITE_ID,
      suiteVersion: 2,
      fixtureVersion,
      catalogSha: yield* retainSource(
        yield* encodeDocument({ dataOrigin: "synthetic", fixtureVersion, cases: CASES }),
      ),
      target: "synthetic-target-gina-mcp",
      accountClass: "synthetic-account-class-test",
      cleanChat: true,
      repetitions: REPETITIONS,
    } satisfies Benchmark;
  });

const [
  readyRuns,
  fixturesV4Runs,
  missingMetricsRun,
  incompleteRun,
  aggregateOnlyRun,
  withheldRun,
  labelsOnlyRun,
  withdrawalNotice,
] = await Effect.runPromise(
  Effect.gen(function* () {
    const identity = yield* Effect.all(
      {
        evaluatorSha256: syntheticDigest("production-story-evaluator"),
        skillsSha256: syntheticDigest("production-story-skills"),
        toolchainSha256: syntheticDigest("production-story-toolchain"),
      },
      { concurrency: "unbounded" },
    );
    yield* retainSource(canonicalCaptureRaw);
    const [benchmarkV3, benchmarkV4] = yield* Effect.all([benchmark(3), benchmark(4)], {
      concurrency: "unbounded",
    });
    return yield* Effect.all(
      [
        Effect.forEach(READY_SPECS, (spec) => buildRun(spec, benchmarkV3, identity), {
          concurrency: "unbounded",
        }),
        Effect.forEach(FIXTURES_V4_SPECS, (spec) => buildRun(spec, benchmarkV4, identity), {
          concurrency: "unbounded",
        }),
        buildRun(MISSING_METRICS_SPEC, benchmarkV3, identity),
        wrapCanonicalResult(
          canonicalResult(incompleteCoverageRaw),
          "2026-09-07-003",
          "2026-09-07T11:30:00Z",
        ),
        wrapCanonicalResult(
          canonicalResult(aggregateOnlyRaw),
          "2026-09-06-legacy",
          "2026-09-06T12:00:00Z",
        ),
        wrapCanonicalResult(canonicalResult(withheldRaw), "2026-09-07-002", "2026-09-07T11:15:00Z"),
        wrapCanonicalResult(
          resultOf(
            canonicalPublication(correctionRev1Raw, "synthetic-publication-correction-rev1.json"),
          ),
          "2026-09-07-001-labels-only",
          "2026-09-07T09:00:00Z",
        ),
        seal(
          canonicalPublication(withdrawalNoticeRaw, "synthetic-publication-withdrawal-notice.json"),
          "synthetic-publication-withdrawal-notice.json",
        ),
      ],
      { concurrency: "unbounded" },
    );
  }),
);
const withdrawn = withdrawnRecord(withdrawalNotice, CANONICAL_WITHDRAWN_REVISION_1_PUBLISHED_AT);

const ready = fixture(readyRuns);
const multipleCohorts = fixture([...readyRuns, ...fixturesV4Runs], [withdrawn]);
const incomplete = fixture([incompleteRun]);
const aggregateOnly = fixture([aggregateOnlyRun]);
const missingMetrics = fixture([missingMetricsRun]);
const withheld = fixture([withheldRun]);
const labelsOnly = fixture([labelsOnlyRun]);
const empty = fixture([]);
const withdrawnOnly = fixture([], [withdrawn]);

/** Five pinned, complete, detailed publications in one cohort; the first is a revision 2 correction. */
export const productionReadyState: ProductionReadyState = ready.state;
/** The ready cohort plus a fixture-catalog v4 cohort repeating two candidates, and one withdrawn entry. */
export const productionMultipleCohortsState: ProductionReadyState = multipleCohorts.state;
/** Canonical declared-plan run with 6 of 10 planned attempts, no headline pass rate and no retained attempts. */
export const productionIncompleteState: ProductionReadyState = incomplete.state;
/** Canonical labels-only legacy run with aggregate-only evidence and null per-case counts. */
export const productionAggregateOnlyState: ProductionReadyState = aggregateOnly.state;
/** Retained attempts whose usage was never captured: token metric not retained, latency available. */
export const productionMissingMetricsState: ProductionReadyState = missingMetrics.state;
/** Canonical run whose attempt detail and latency are withheld after privacy review. */
export const productionWithheldState: ProductionReadyState = withheld.state;
/** The canonical correction's revision 1 result republished on its own: labels only, no configuration pin. */
export const productionLabelsOnlyState: ProductionReadyState = labelsOnly.state;
/** A valid index listing nothing. */
export const productionEmptyState: ProductionReadyState = empty.state;
/** Only the canonical withdrawal notice is indexed: no rows, withdrawnCount 1. */
export const productionWithdrawnState: ProductionReadyState = withdrawnOnly.state;
export const productionLoadingState: Extract<PublicComparisonState, { status: "loading" }> = {
  status: "loading",
  catalog: null,
  message: null,
};
export const productionErrorState: Extract<PublicComparisonState, { status: "error" }> = {
  status: "error",
  catalog: null,
  message: "This index does not have a supported public results shape.",
};

/** synthetic-publication-2026-09-10-claude-sonnet-4.5: revision 2, one failed attempt, one uncaptured usage sample. */
export const productionPrimaryPublicationId = pick(readyRuns, 0, "ready run").publication
  .publicationId;
/** synthetic-publication-2026-09-10-gpt-5: revision 1, every attempt passed. */
export const productionSecondaryPublicationId = pick(readyRuns, 1, "ready run").publication
  .publicationId;

/** Raw bytes per state for the Node-only schema check; states share snapshots where they share publications. */
export const productionFixtureArtifacts = {
  ready: ready.artifacts,
  multipleCohorts: multipleCohorts.artifacts,
  incomplete: incomplete.artifacts,
  aggregateOnly: aggregateOnly.artifacts,
  missingMetrics: missingMetrics.artifacts,
  withheld: withheld.artifacts,
  labelsOnly: labelsOnly.artifacts,
  empty: empty.artifacts,
  withdrawn: withdrawnOnly.artifacts,
} as const satisfies Readonly<Record<string, ProductionFixtureArtifacts>>;
