import type { PublicEvalIndex, PublicEvalPublication, PublicEvalResult } from "@askgina/contracts";

export const MAX_PUBLIC_ARTIFACT_BYTES = 5 * 1024 * 1024;

export type ParsedPublicArtifact =
  | { kind: "empty" }
  | { kind: "unsupported"; message: string }
  | { kind: "publication"; publication: PublicEvalPublication }
  | { kind: "index"; index: PublicEvalIndex };

const WHITESPACE_ONLY = /^\s*$/u;
const MESSAGES = {
  oversize: "This viewer accepts public JSON files up to 5 MiB.",
  invalidUtf8: "This file is not valid UTF-8 text.",
  invalidJson: "This file is not valid JSON.",
  notArtifact: "This file is not a public evaluation results artifact.",
  unsupportedVersion: "This artifact uses a schema version this viewer does not support.",
  notViewable: "This file is an evaluator result or attempt capture, not a publication or index.",
  malformedPublication: "This publication does not have a supported public results shape.",
  malformedIndex: "This index does not have a supported public results shape.",
} as const;

// Check display shapes, not exporter policy. Extra keys stay unread; views must
// select named fields rather than serialize artifacts, especially withdrawals.
const isObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown, max = 128): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isNonNegativeInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;

const isPositiveInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  isNonNegativeInt(value, max) && value > 0;

const isRatio = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isArrayOf = (
  value: unknown,
  max: number,
  check: (item: unknown) => boolean,
  min = 0,
): boolean =>
  Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);

const enumValue = (...values: string[]) => (value: unknown): boolean =>
  typeof value === "string" && values.includes(value);

const isOrigin = enumValue("synthetic", "measured");
const isVerdict = enumValue("pass", "fail", "not_applicable");
const isFailure = enumValue(
  "routing_mismatch", "argument_mismatch", "safety_violation",
  "trial_or_tool_failure", "skill_activation_mismatch",
);
const isUnavailable = enumValue("not_evaluated", "not_applicable", "not_retained", "withheld");
const isUnavailableReason = enumValue("no_declared_method", "incomplete_coverage", "not_captured", "privacy_review");
const isEvidence = enumValue("available", "aggregate_only", "not_retained", "withheld", "not_evaluated", "not_applicable");
const isUnrankedReason = enumValue("pilot", "synthetic", "incomplete_coverage", "missing_pinned_configuration");

const hasChecks = (value: unknown): boolean =>
  isObject(value) && isVerdict(value.routing) && isVerdict(value.arguments) &&
  isVerdict(value.safety) && isVerdict(value.completion) && isVerdict(value.skillActivation);

const hasTokens = (value: unknown): boolean =>
  isObject(value) && isNonNegativeInt(value.inputTokens) &&
  isNonNegativeInt(value.outputTokens) && isNonNegativeInt(value.totalTokens);

const hasAttempt = (value: unknown): boolean =>
  isObject(value) && isText(value.id, 72) && isText(value.runId, 128) && isText(value.caseId, 128) &&
  isPositiveInt(value.repetition, 5000) && (value.verdict === "pass" || value.verdict === "fail") &&
  value.validity === "valid" && value.evidenceAvailability === "available" &&
  hasChecks(value.checks) && isArrayOf(value.failureCategories, 5, isFailure) &&
  isNonNegativeInt(value.durationMs) && (value.tokenUsage === null || hasTokens(value.tokenUsage)) &&
  value.replacementOf === null;

const hasUnavailableMetric = (value: unknown): boolean =>
  isObject(value) && isUnavailable(value.availability) && isUnavailableReason(value.reason);

const hasPassRate = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.availability !== "available") return hasUnavailableMetric(value);
  return value.unit === "ratio" && isRatio(value.value) &&
    isNonNegativeInt(value.numerator) && isPositiveInt(value.denominator);
};

const hasLatency = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.availability !== "available") return hasUnavailableMetric(value);
  return value.unit === "milliseconds" && isNonNegativeInt(value.p50) &&
    isNonNegativeInt(value.p95) && isNonNegativeInt(value.max) && isPositiveInt(value.sampleCount, 5000);
};

const hasTokenMetric = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.availability !== "available") return hasUnavailableMetric(value);
  return value.unit === "tokens" && hasTokens(value) && isPositiveInt(value.sampleCount, 5000);
};

const hasDimension = (value: unknown): boolean =>
  isObject(value) && isNonNegativeInt(value.passed) && isNonNegativeInt(value.failed) && isNonNegativeInt(value.notApplicable);

const hasResult = (value: unknown): value is PublicEvalResult => {
  if (!isObject(value)) return false;
  const { run, source, benchmark, configuration, coverage, counts, dimensions, metrics, evidence, ranking } = value;
  return value.schemaVersion === "eval-result.v1" && isText(value.resultId, 128) &&
    isOrigin(value.dataOrigin) && value.measures === "conformance" &&
    isObject(run) && isText(run.runId, 128) && isText(run.startedAt, 64) &&
    isObject(source) &&
    (source.kind === "sanitized_aggregate" || source.kind === "sanitized_aggregate_with_attempts") &&
    source.reportSchemaVersion === "v1" && isText(source.reportSha256, 64) &&
    (source.attemptCaptureSha256 === null || isText(source.attemptCaptureSha256, 64)) &&
    isObject(benchmark) && isText(benchmark.suiteId, 128) && isPositiveInt(benchmark.suiteVersion) &&
    isPositiveInt(benchmark.fixtureVersion) && isText(benchmark.catalogSha, 64) &&
    isText(benchmark.target, 128) && isText(benchmark.accountClass, 128) &&
    benchmark.cleanChat === true && isPositiveInt(benchmark.repetitions, 5000) &&
    isObject(configuration) &&
    (configuration.availability === "pinned" || configuration.availability === "labels_only") &&
    isText(configuration.candidate, 128) && isText(configuration.model, 128) &&
    (configuration.reasoning === null || isText(configuration.reasoning, 128)) &&
    (configuration.pinnedSha256 === null || isText(configuration.pinnedSha256, 64)) &&
    isObject(coverage) && (coverage.planSource === "run_manifest" || coverage.planSource === "declared_plan") &&
    (coverage.planSha256 === null || isText(coverage.planSha256, 64)) &&
    (coverage.statusSha256 === null || isText(coverage.statusSha256, 64)) &&
    (coverage.status === "complete" || coverage.status === "incomplete") &&
    isPositiveInt(coverage.plannedCases, 5000) && isPositiveInt(coverage.plannedAttempts, 5000) &&
    isObject(counts) && isObject(counts.attempts) && isObject(counts.cases) &&
    isNonNegativeInt(counts.attempts.total, 5000) && isNonNegativeInt(counts.attempts.passed, 5000) &&
    isNonNegativeInt(counts.attempts.failed, 5000) && isNonNegativeInt(counts.cases.total, 5000) &&
    (counts.cases.passedEveryAttempt === null || isNonNegativeInt(counts.cases.passedEveryAttempt, 5000)) &&
    (counts.cases.failedAnyAttempt === null || isNonNegativeInt(counts.cases.failedAnyAttempt, 5000)) &&
    isObject(dimensions) && hasDimension(dimensions.routing) && hasDimension(dimensions.arguments) &&
    hasDimension(dimensions.safety) && hasDimension(dimensions.completion) && hasDimension(dimensions.skillActivation) &&
    isObject(metrics) && hasPassRate(metrics.passRate) && hasLatency(metrics.latencyMs) &&
    hasTokenMetric(metrics.tokenUsage) && hasUnavailableMetric(metrics.answerAccuracy) &&
    hasUnavailableMetric(metrics.usdCost) && hasUnavailableMetric(metrics.uncertainty) &&
    isObject(evidence) && isEvidence(evidence.attemptDetail) &&
    isObject(ranking) && ranking.status === "unranked" && isArrayOf(ranking.reasons, 4, isUnrankedReason, 1) &&
    (value.attempts === null || isArrayOf(value.attempts, 5000, hasAttempt));
};

const hasReview = (value: unknown, origin: unknown): boolean => {
  if (!isObject(value)) return false;
  if (origin === "synthetic") return value.status === "synthetic_preview";
  return origin === "measured" && value.status === "approved" && value.method === "manual" &&
    isText(value.approvedBy, 128) && isText(value.approvedAt, 64) &&
    isText(value.subjectSha256, 64) && isText(value.record, 500);
};

const hasPublication = (value: unknown): value is PublicEvalPublication => {
  if (!isObject(value)) return false;
  const { content, supersedes } = value;
  if (!(value.schemaVersion === "eval-publication.v1" && isText(value.publicationId, 128) &&
    isText(value.revisionId, 128) && isPositiveInt(value.revision, 50) && isText(value.runId, 128) &&
    isOrigin(value.dataOrigin) && isText(value.publishedAt, 64) && hasReview(value.review, value.dataOrigin) &&
    (supersedes === null || (isObject(supersedes) && isText(supersedes.revisionId, 128) &&
      isPositiveInt(supersedes.revision) && (supersedes.reason === "correction" || supersedes.reason === "withdrawal") &&
      isText(supersedes.summary, 500))) && isObject(content))) return false;
  if (content.kind === "result") {
    return hasResult(content.result) && content.result.dataOrigin === value.dataOrigin &&
      content.result.run.runId === value.runId;
  }
  return content.kind === "withdrawal_notice" &&
    (content.reason === "privacy" || content.reason === "data_integrity" || content.reason === "owner_request") &&
    isText(content.withdrawnAt, 64) && isText(content.notice, 500);
};

const hasIndexRevision = (value: unknown): boolean =>
  isObject(value) && isText(value.revisionId, 128) && isPositiveInt(value.revision) &&
  (value.kind === "result" || value.kind === "withdrawal_notice") &&
  (value.state === "current" || value.state === "superseded" || value.state === "removed") &&
  isText(value.publishedAt, 64) && (value.path === null || isText(value.path, 256)) &&
  (value.sha256 === null || isText(value.sha256, 64));

const hasIndex = (value: unknown): value is PublicEvalIndex => {
  if (!(isObject(value) && value.schemaVersion === "eval-index.v1" && isOrigin(value.dataOrigin) &&
    isText(value.generatedAt, 64) && Array.isArray(value.publications) && value.publications.length <= 1000)) return false;
  for (const entry of value.publications) {
    if (!isObject(entry)) return false;
    const { summary } = entry;
    if (!(isText(entry.publicationId, 128) && isText(entry.runId, 128) && hasReview(entry.review, value.dataOrigin) &&
      (entry.status === "current" || entry.status === "withdrawn") && isText(entry.currentRevisionId, 128) &&
      (summary === null || (isObject(summary) && isText(summary.suiteId, 128) && isText(summary.candidate, 128) &&
        isText(summary.model, 128) && isText(summary.startedAt, 64))) &&
      isArrayOf(entry.revisions, 50, hasIndexRevision, 1))) return false;
  }
  return true;
};

// Fatal decoding rejects malformed sequences; a BOM stays in the text and is
// therefore invalid JSON, matching the exporter which never writes one.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const unsupported = (message: string): ParsedPublicArtifact => ({ kind: "unsupported", message });

/** Parses exact file bytes with fixed rejection messages; successful artifacts are not copied. */
export const parsePublicArtifact = (bytes: ArrayBuffer): ParsedPublicArtifact => {
  if (bytes.byteLength > MAX_PUBLIC_ARTIFACT_BYTES) return unsupported(MESSAGES.oversize);
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return unsupported(MESSAGES.invalidUtf8);
  }
  if (WHITESPACE_ONLY.test(text)) return { kind: "empty" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unsupported(MESSAGES.invalidJson);
  }
  if (!isObject(json) || typeof json.schemaVersion !== "string") return unsupported(MESSAGES.notArtifact);
  const { schemaVersion } = json;
  if (schemaVersion === "eval-publication.v1") {
    return hasPublication(json)
      ? { kind: "publication", publication: json }
      : unsupported(MESSAGES.malformedPublication);
  }
  if (schemaVersion === "eval-index.v1") {
    return hasIndex(json) ? { kind: "index", index: json } : unsupported(MESSAGES.malformedIndex);
  }
  if (schemaVersion.startsWith("eval-publication.") || schemaVersion.startsWith("eval-index.")) {
    return unsupported(MESSAGES.unsupportedVersion);
  }
  if (schemaVersion.startsWith("eval-result.") || schemaVersion.startsWith("eval-attempts.")) {
    return unsupported(MESSAGES.notViewable);
  }
  return unsupported(MESSAGES.notArtifact);
};
