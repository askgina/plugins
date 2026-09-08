import type { PublicEvalIndex, PublicEvalPublication, PublicEvalResult } from "@askgina/contracts";

export const MAX_PUBLIC_ARTIFACT_BYTES = 5 * 1024 * 1024;

export type ParsedPublicArtifact =
  | { kind: "empty" }
  | { kind: "unsupported"; message: string }
  | { kind: "publication"; publication: PublicEvalPublication }
  | { kind: "index"; index: PublicEvalIndex };

const WHITESPACE_ONLY = /^\s*$/u;
const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const MODEL_IDENTIFIER =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?)*$/u;
const SHA_256 = /^[a-f0-9]{64}$/u;
const ATTEMPT_ID = /^attempt-[a-f0-9]{64}$/u;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/u;
const SINGLE_LINE_TEXT = /^[^\p{Cc}]*$/u;
const SNAPSHOT_PATH =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)*\.json$/u;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

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

const isIdentifier = (value: unknown): value is string => isText(value) && IDENTIFIER.test(value);

const isModelIdentifier = (value: unknown): value is string =>
  isText(value) && MODEL_IDENTIFIER.test(value);

const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && SHA_256.test(value);

const isTimestamp = (value: unknown): value is string => {
  if (!isText(value, 64)) return false;
  const match = UTC_TIMESTAMP.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapDay = month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 1 : 0;
  const daysInMonth = DAYS_IN_MONTH[month - 1];
  return (
    daysInMonth !== undefined &&
    day >= 1 &&
    day <= daysInMonth + leapDay &&
    Number(match[4]) < 24 &&
    Number(match[5]) < 60 &&
    Number(match[6]) < 60
  );
};

const timestampSortKey = (value: string): string =>
  value.length === 20 ? `${value.slice(0, 19)}.000Z` : value;

const isNote = (value: unknown): value is string =>
  isText(value, 500) && SINGLE_LINE_TEXT.test(value);

const isSnapshotPath = (value: unknown): value is string =>
  isText(value, 256) && SNAPSHOT_PATH.test(value);

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

const enumValue =
  (...values: string[]) =>
  (value: unknown): boolean =>
    typeof value === "string" && values.includes(value);

const isOrigin = enumValue("synthetic", "measured");
const isVerdict = enumValue("pass", "fail", "not_applicable");
const isFailure = enumValue(
  "routing_mismatch",
  "argument_mismatch",
  "safety_violation",
  "trial_or_tool_failure",
  "skill_activation_mismatch",
);
const isUnavailable = enumValue("not_evaluated", "not_applicable", "not_retained", "withheld");
const isUnavailableReason = enumValue(
  "no_declared_method",
  "incomplete_coverage",
  "not_captured",
  "privacy_review",
);
const isEvidence = enumValue(
  "available",
  "aggregate_only",
  "not_retained",
  "withheld",
  "not_evaluated",
  "not_applicable",
);
const isUnrankedReason = enumValue(
  "pilot",
  "synthetic",
  "incomplete_coverage",
  "missing_pinned_configuration",
);

const hasChecks = (value: unknown): boolean =>
  isObject(value) &&
  isVerdict(value.routing) &&
  isVerdict(value.arguments) &&
  isVerdict(value.safety) &&
  isVerdict(value.completion) &&
  isVerdict(value.skillActivation);

const hasTokens = (value: unknown): boolean =>
  isObject(value) &&
  isNonNegativeInt(value.inputTokens) &&
  isNonNegativeInt(value.outputTokens) &&
  isNonNegativeInt(value.totalTokens);

const hasAttempt = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.id === "string" &&
  ATTEMPT_ID.test(value.id) &&
  isIdentifier(value.runId) &&
  isIdentifier(value.caseId) &&
  isPositiveInt(value.repetition, 5000) &&
  (value.verdict === "pass" || value.verdict === "fail") &&
  value.validity === "valid" &&
  value.evidenceAvailability === "available" &&
  hasChecks(value.checks) &&
  isArrayOf(value.failureCategories, 5, isFailure) &&
  isNonNegativeInt(value.durationMs) &&
  (value.tokenUsage === null || hasTokens(value.tokenUsage)) &&
  value.replacementOf === null;

const hasUnavailableMetric = (value: unknown): boolean =>
  isObject(value) && isUnavailable(value.availability) && isUnavailableReason(value.reason);

const hasPassRate = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.availability !== "available") return hasUnavailableMetric(value);
  return (
    value.unit === "ratio" &&
    isRatio(value.value) &&
    isNonNegativeInt(value.numerator) &&
    isPositiveInt(value.denominator)
  );
};

const hasLatency = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.availability !== "available") return hasUnavailableMetric(value);
  return (
    value.unit === "milliseconds" &&
    isNonNegativeInt(value.p50) &&
    isNonNegativeInt(value.p95) &&
    isNonNegativeInt(value.max) &&
    isPositiveInt(value.sampleCount, 5000)
  );
};

const hasTokenMetric = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.availability !== "available") return hasUnavailableMetric(value);
  return value.unit === "tokens" && hasTokens(value) && isPositiveInt(value.sampleCount, 5000);
};

const hasDimension = (value: unknown): boolean =>
  isObject(value) &&
  isNonNegativeInt(value.passed) &&
  isNonNegativeInt(value.failed) &&
  isNonNegativeInt(value.notApplicable);

const hasResult = (value: unknown): value is PublicEvalResult => {
  if (!isObject(value)) return false;
  const {
    run,
    source,
    benchmark,
    configuration,
    coverage,
    counts,
    dimensions,
    metrics,
    evidence,
    ranking,
  } = value;
  return (
    value.schemaVersion === "eval-result.v1" &&
    isIdentifier(value.resultId) &&
    isOrigin(value.dataOrigin) &&
    value.measures === "conformance" &&
    isObject(run) &&
    isIdentifier(run.runId) &&
    isTimestamp(run.startedAt) &&
    isObject(source) &&
    (source.kind === "sanitized_aggregate" ||
      source.kind === "sanitized_aggregate_with_attempts") &&
    source.reportSchemaVersion === "v1" &&
    isSha256(source.reportSha256) &&
    (source.attemptCaptureSha256 === null || isSha256(source.attemptCaptureSha256)) &&
    isObject(benchmark) &&
    isIdentifier(benchmark.suiteId) &&
    isPositiveInt(benchmark.suiteVersion) &&
    isPositiveInt(benchmark.fixtureVersion) &&
    isSha256(benchmark.catalogSha) &&
    isIdentifier(benchmark.target) &&
    isIdentifier(benchmark.accountClass) &&
    benchmark.cleanChat === true &&
    isPositiveInt(benchmark.repetitions, 5000) &&
    isObject(configuration) &&
    (configuration.availability === "pinned" || configuration.availability === "labels_only") &&
    isIdentifier(configuration.candidate) &&
    isModelIdentifier(configuration.model) &&
    (configuration.reasoning === null || isIdentifier(configuration.reasoning)) &&
    (configuration.pinnedSha256 === null || isSha256(configuration.pinnedSha256)) &&
    isObject(coverage) &&
    (coverage.planSource === "run_manifest" || coverage.planSource === "declared_plan") &&
    (coverage.planSha256 === null || isSha256(coverage.planSha256)) &&
    (coverage.statusSha256 === null || isSha256(coverage.statusSha256)) &&
    (coverage.status === "complete" || coverage.status === "incomplete") &&
    isPositiveInt(coverage.plannedCases, 5000) &&
    isPositiveInt(coverage.plannedAttempts, 5000) &&
    isObject(counts) &&
    isObject(counts.attempts) &&
    isObject(counts.cases) &&
    isNonNegativeInt(counts.attempts.total, 5000) &&
    isNonNegativeInt(counts.attempts.passed, 5000) &&
    isNonNegativeInt(counts.attempts.failed, 5000) &&
    isNonNegativeInt(counts.cases.total, 5000) &&
    (counts.cases.passedEveryAttempt === null ||
      isNonNegativeInt(counts.cases.passedEveryAttempt, 5000)) &&
    (counts.cases.failedAnyAttempt === null ||
      isNonNegativeInt(counts.cases.failedAnyAttempt, 5000)) &&
    isObject(dimensions) &&
    hasDimension(dimensions.routing) &&
    hasDimension(dimensions.arguments) &&
    hasDimension(dimensions.safety) &&
    hasDimension(dimensions.completion) &&
    hasDimension(dimensions.skillActivation) &&
    isObject(metrics) &&
    hasPassRate(metrics.passRate) &&
    hasLatency(metrics.latencyMs) &&
    hasTokenMetric(metrics.tokenUsage) &&
    hasUnavailableMetric(metrics.answerAccuracy) &&
    hasUnavailableMetric(metrics.usdCost) &&
    hasUnavailableMetric(metrics.uncertainty) &&
    isObject(evidence) &&
    isEvidence(evidence.attemptDetail) &&
    isObject(ranking) &&
    ranking.status === "unranked" &&
    isArrayOf(ranking.reasons, 4, isUnrankedReason, 1) &&
    (value.attempts === null || isArrayOf(value.attempts, 5000, hasAttempt))
  );
};

const hasReview = (value: unknown, origin: unknown): boolean => {
  if (!isObject(value)) return false;
  if (origin === "synthetic") return value.status === "synthetic_preview";
  return (
    origin === "measured" &&
    value.status === "approved" &&
    value.method === "manual" &&
    isIdentifier(value.approvedBy) &&
    isTimestamp(value.approvedAt) &&
    isSha256(value.subjectSha256) &&
    isNote(value.record)
  );
};

const hasPublication = (value: unknown): value is PublicEvalPublication => {
  if (!isObject(value)) return false;
  const { content, publishedAt, review, revision, revisionId, supersedes } = value;
  if (
    !(
      value.schemaVersion === "eval-publication.v1" &&
      isIdentifier(value.publicationId) &&
      isIdentifier(revisionId) &&
      isPositiveInt(revision) &&
      isIdentifier(value.runId) &&
      isOrigin(value.dataOrigin) &&
      isTimestamp(publishedAt) &&
      hasReview(review, value.dataOrigin) &&
      (supersedes === null ||
        (isObject(supersedes) &&
          isIdentifier(supersedes.revisionId) &&
          isPositiveInt(supersedes.revision) &&
          (supersedes.reason === "correction" || supersedes.reason === "withdrawal") &&
          isNote(supersedes.summary))) &&
      isObject(content)
    )
  )
    return false;

  if (
    isObject(review) &&
    review.status === "approved" &&
    isTimestamp(review.approvedAt) &&
    timestampSortKey(review.approvedAt) > timestampSortKey(publishedAt)
  )
    return false;
  if ((revision === 1) !== (supersedes === null)) return false;
  if (supersedes !== null) {
    if (supersedes.revision !== revision - 1 || supersedes.revisionId === revisionId) return false;
    const expectedReason = content.kind === "withdrawal_notice" ? "withdrawal" : "correction";
    if (supersedes.reason !== expectedReason) return false;
  }

  if (content.kind === "result") {
    return (
      hasResult(content.result) &&
      content.result.dataOrigin === value.dataOrigin &&
      content.result.run.runId === value.runId
    );
  }
  return (
    content.kind === "withdrawal_notice" &&
    supersedes !== null &&
    (content.reason === "privacy" ||
      content.reason === "data_integrity" ||
      content.reason === "owner_request") &&
    isTimestamp(content.withdrawnAt) &&
    timestampSortKey(content.withdrawnAt) <= timestampSortKey(publishedAt) &&
    isNote(content.notice)
  );
};

type IndexRevision = PublicEvalIndex["publications"][number]["revisions"][number];

const hasIndexRevision = (value: unknown): value is IndexRevision =>
  isObject(value) &&
  isIdentifier(value.revisionId) &&
  isPositiveInt(value.revision) &&
  (value.kind === "result" || value.kind === "withdrawal_notice") &&
  (value.state === "current" || value.state === "superseded" || value.state === "removed") &&
  isTimestamp(value.publishedAt) &&
  (value.path === null || isSnapshotPath(value.path)) &&
  (value.sha256 === null || isSha256(value.sha256));

const hasIndex = (value: unknown): value is PublicEvalIndex => {
  if (
    !(
      isObject(value) &&
      value.schemaVersion === "eval-index.v1" &&
      isOrigin(value.dataOrigin) &&
      isTimestamp(value.generatedAt) &&
      Array.isArray(value.publications) &&
      value.publications.length <= 1000
    )
  )
    return false;
  const publicationIds = new Set<string>();
  const revisionIds = new Set<string>();
  const paths = new Set<string>();
  for (const entry of value.publications) {
    if (!isObject(entry)) return false;
    const { publicationId, revisions, status, summary } = entry;
    if (
      !(
        isIdentifier(publicationId) &&
        isIdentifier(entry.runId) &&
        hasReview(entry.review, value.dataOrigin) &&
        (status === "current" || status === "withdrawn") &&
        isIdentifier(entry.currentRevisionId) &&
        (summary === null ||
          (isObject(summary) &&
            isIdentifier(summary.suiteId) &&
            isIdentifier(summary.candidate) &&
            isModelIdentifier(summary.model) &&
            isTimestamp(summary.startedAt))) &&
        Array.isArray(revisions) &&
        revisions.length > 0
      )
    )
      return false;
    const publicationKey = publicationId.toLowerCase();
    if (publicationIds.has(publicationKey) || (summary !== null) !== (status === "current"))
      return false;
    publicationIds.add(publicationKey);

    let withdrawn = false;
    for (let index = 0; index < revisions.length; index += 1) {
      const revision = revisions[index];
      if (!hasIndexRevision(revision) || revision.revision !== index + 1) return false;
      const revisionKey = revision.revisionId.toLowerCase();
      if (revisionIds.has(revisionKey)) return false;
      revisionIds.add(revisionKey);
      const removed = revision.state === "removed";
      if ((revision.path === null) !== removed || (revision.sha256 === null) !== removed)
        return false;
      if (revision.path !== null) {
        if (paths.has(revision.path)) return false;
        paths.add(revision.path);
      }
      if ((revision.state === "current") !== (index === revisions.length - 1)) return false;
      if (revision.kind === "withdrawal_notice" && revision.revision === 1) return false;
      if (withdrawn && revision.kind === "result") return false;
      withdrawn ||= revision.kind === "withdrawal_notice";
      if (status === "current" && removed) return false;
      if (status === "withdrawn" && revision.kind === "result" && !removed) return false;
    }
    const last = revisions[revisions.length - 1];
    if (
      last === undefined ||
      last.revisionId !== entry.currentRevisionId ||
      last.kind !== (status === "withdrawn" ? "withdrawal_notice" : "result")
    )
      return false;
  }
  return true;
};

// Fatal decoding rejects malformed sequences; a BOM stays in the text and is
// therefore invalid JSON, matching the exporter which never writes one.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const unsupported = (message: string): ParsedPublicArtifact => ({ kind: "unsupported", message });

export type PublicationIndexAssessment =
  | { status: "current"; message: null }
  | { status: "superseded"; message: string }
  | { status: "hidden"; message: string };

/** Hashes the selected file's original bytes without decoding or reserialization. */
export const publicArtifactSha256 = (bytes: ArrayBuffer): Promise<string> =>
  crypto.subtle.digest("SHA-256", bytes).then((buffer) => {
    const digest = new Uint8Array(buffer);
    let sha256 = "";
    for (const byte of digest) sha256 += byte.toString(16).padStart(2, "0");
    return sha256;
  });

/** Decides whether an indexed publication may render, using its original-byte digest. */
export const assessPublicationAgainstIndex = (
  publication: PublicEvalPublication,
  index: PublicEvalIndex,
  publicationSha256: string | null,
): PublicationIndexAssessment => {
  if (publication.dataOrigin !== index.dataOrigin) {
    return {
      status: "hidden",
      message:
        "The index and publication have different data origins. The publication is not displayed.",
    };
  }
  const entry = index.publications.find((item) => item.publicationId === publication.publicationId);
  if (entry === undefined || entry.runId !== publication.runId) {
    return {
      status: "hidden",
      message:
        "This publication is not identified by the selected index. The publication is not displayed.",
    };
  }
  const revision = entry.revisions.find((item) => item.revisionId === publication.revisionId);
  if (
    revision === undefined ||
    revision.revision !== publication.revision ||
    revision.kind !== publication.content.kind
  ) {
    return {
      status: "hidden",
      message:
        "This snapshot is absent or inconsistent with the selected index. The publication is not displayed.",
    };
  }
  if (entry.status === "withdrawn" && publication.content.kind === "result") {
    return {
      status: "hidden",
      message:
        "The selected index marks this publication withdrawn. Result content is hidden. Select the current withdrawal notice to read its reason.",
    };
  }
  if (revision.state === "removed") {
    return {
      status: "hidden",
      message:
        "The selected index records that this snapshot's bytes were removed. The publication is not displayed.",
    };
  }
  if (revision.sha256 === null || revision.sha256 !== publicationSha256) {
    return {
      status: "hidden",
      message:
        "The snapshot's SHA-256 is missing or does not match the selected index. The publication is not displayed.",
    };
  }
  if (entry.currentRevisionId === publication.revisionId && revision.state === "current") {
    return { status: "current", message: null };
  }
  if (revision.state === "superseded") {
    return {
      status: "superseded",
      message:
        "This snapshot's bytes match the selected index, but a newer revision supersedes it. The result below is historical, not current.",
    };
  }
  return {
    status: "hidden",
    message:
      "This snapshot has an inconsistent lifecycle in the selected index. The publication is not displayed.",
  };
};

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
  if (!isObject(json) || typeof json.schemaVersion !== "string")
    return unsupported(MESSAGES.notArtifact);
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
