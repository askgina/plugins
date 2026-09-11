import type {
  PublicEvalAttemptSummary,
  PublicEvalPublication,
  PublicEvalResult,
} from "@askgina/contracts";

// parsePublicArtifact checks display shapes and leaves unread keys in place,
// while the public v1 decoder rejects excess properties. The download therefore
// rebuilds every object from named schema fields, in schema order: unknown keys
// never cross the boundary and unavailable metrics carry only availability and
// reason. Arrays of primitive enums are shared, not copied.

type Metrics = PublicEvalResult["metrics"];
type UnavailableMetric = Metrics["answerAccuracy"];
type Dimension = PublicEvalResult["dimensions"]["routing"];
type TokenUsage = NonNullable<PublicEvalAttemptSummary["tokenUsage"]>;

const unavailable = ({ availability, reason }: UnavailableMetric): UnavailableMetric => ({
  availability,
  reason,
});

const passRate = (metric: Metrics["passRate"]): Metrics["passRate"] =>
  metric.availability === "available"
    ? {
        availability: metric.availability,
        unit: metric.unit,
        value: metric.value,
        numerator: metric.numerator,
        denominator: metric.denominator,
      }
    : unavailable(metric);

const latency = (metric: Metrics["latencyMs"]): Metrics["latencyMs"] =>
  metric.availability === "available"
    ? {
        availability: metric.availability,
        unit: metric.unit,
        p50: metric.p50,
        p95: metric.p95,
        max: metric.max,
        sampleCount: metric.sampleCount,
      }
    : unavailable(metric);

const tokenTotals = (metric: Metrics["tokenUsage"]): Metrics["tokenUsage"] =>
  metric.availability === "available"
    ? {
        availability: metric.availability,
        unit: metric.unit,
        inputTokens: metric.inputTokens,
        outputTokens: metric.outputTokens,
        totalTokens: metric.totalTokens,
        sampleCount: metric.sampleCount,
      }
    : unavailable(metric);

const dimension = ({ passed, failed, notApplicable }: Dimension): Dimension => ({
  passed,
  failed,
  notApplicable,
});

const tokenUsage = ({ inputTokens, outputTokens, totalTokens }: TokenUsage): TokenUsage => ({
  inputTokens,
  outputTokens,
  totalTokens,
});

const attempt = (summary: PublicEvalAttemptSummary): PublicEvalAttemptSummary => ({
  id: summary.id,
  runId: summary.runId,
  caseId: summary.caseId,
  repetition: summary.repetition,
  verdict: summary.verdict,
  validity: summary.validity,
  evidenceAvailability: summary.evidenceAvailability,
  checks: {
    routing: summary.checks.routing,
    arguments: summary.checks.arguments,
    safety: summary.checks.safety,
    completion: summary.checks.completion,
    skillActivation: summary.checks.skillActivation,
  },
  failureCategories: summary.failureCategories,
  durationMs: summary.durationMs,
  tokenUsage: summary.tokenUsage === null ? null : tokenUsage(summary.tokenUsage),
  replacementOf: summary.replacementOf,
});

const result = (value: PublicEvalResult): PublicEvalResult => ({
  schemaVersion: value.schemaVersion,
  resultId: value.resultId,
  dataOrigin: value.dataOrigin,
  measures: value.measures,
  run: { runId: value.run.runId, startedAt: value.run.startedAt },
  source: {
    kind: value.source.kind,
    reportSchemaVersion: value.source.reportSchemaVersion,
    reportSha256: value.source.reportSha256,
    attemptCaptureSha256: value.source.attemptCaptureSha256,
  },
  benchmark: {
    suiteId: value.benchmark.suiteId,
    suiteVersion: value.benchmark.suiteVersion,
    fixtureVersion: value.benchmark.fixtureVersion,
    catalogSha: value.benchmark.catalogSha,
    target: value.benchmark.target,
    accountClass: value.benchmark.accountClass,
    cleanChat: value.benchmark.cleanChat,
    repetitions: value.benchmark.repetitions,
  },
  configuration: {
    availability: value.configuration.availability,
    candidate: value.configuration.candidate,
    model: value.configuration.model,
    reasoning: value.configuration.reasoning,
    pinnedSha256: value.configuration.pinnedSha256,
  },
  coverage: {
    planSource: value.coverage.planSource,
    planSha256: value.coverage.planSha256,
    statusSha256: value.coverage.statusSha256,
    status: value.coverage.status,
    plannedCases: value.coverage.plannedCases,
    plannedAttempts: value.coverage.plannedAttempts,
  },
  counts: {
    attempts: {
      total: value.counts.attempts.total,
      passed: value.counts.attempts.passed,
      failed: value.counts.attempts.failed,
    },
    cases: {
      total: value.counts.cases.total,
      passedEveryAttempt: value.counts.cases.passedEveryAttempt,
      failedAnyAttempt: value.counts.cases.failedAnyAttempt,
    },
  },
  dimensions: {
    routing: dimension(value.dimensions.routing),
    arguments: dimension(value.dimensions.arguments),
    safety: dimension(value.dimensions.safety),
    completion: dimension(value.dimensions.completion),
    skillActivation: dimension(value.dimensions.skillActivation),
  },
  metrics: {
    passRate: passRate(value.metrics.passRate),
    latencyMs: latency(value.metrics.latencyMs),
    tokenUsage: tokenTotals(value.metrics.tokenUsage),
    answerAccuracy: unavailable(value.metrics.answerAccuracy),
    usdCost: unavailable(value.metrics.usdCost),
    uncertainty: unavailable(value.metrics.uncertainty),
  },
  evidence: { attemptDetail: value.evidence.attemptDetail },
  ranking: { status: value.ranking.status, reasons: value.ranking.reasons },
  attempts: value.attempts === null ? null : value.attempts.map(attempt),
});

const review = (value: PublicEvalPublication["review"]): PublicEvalPublication["review"] =>
  value.status === "approved"
    ? {
        status: value.status,
        method: value.method,
        approvedBy: value.approvedBy,
        approvedAt: value.approvedAt,
        subjectSha256: value.subjectSha256,
        record: value.record,
      }
    : { status: value.status };

const content = (value: PublicEvalPublication["content"]): PublicEvalPublication["content"] =>
  value.kind === "result"
    ? { kind: value.kind, result: result(value.result) }
    : {
        kind: value.kind,
        reason: value.reason,
        withdrawnAt: value.withdrawnAt,
        notice: value.notice,
      };

const publication = (value: PublicEvalPublication): PublicEvalPublication => ({
  schemaVersion: value.schemaVersion,
  publicationId: value.publicationId,
  revisionId: value.revisionId,
  revision: value.revision,
  runId: value.runId,
  dataOrigin: value.dataOrigin,
  publishedAt: value.publishedAt,
  review: review(value.review),
  supersedes:
    value.supersedes === null
      ? null
      : {
          revisionId: value.supersedes.revisionId,
          revision: value.supersedes.revision,
          reason: value.supersedes.reason,
          summary: value.supersedes.summary,
        },
  content: content(value.content),
});

/**
 * The exact text of the Run page's JSON download: the current publication's
 * supported public v1 fields, re-serialized for inspection. It is not the
 * indexed snapshot's original bytes, so it does not reproduce the index digest.
 */
export const serializePublicPublication = (value: PublicEvalPublication): string =>
  `${JSON.stringify(publication(value), null, 2)}\n`;
