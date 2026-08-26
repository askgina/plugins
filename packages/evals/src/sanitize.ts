import { Data, Effect, Function, Schema } from "effect";

import { isUnknownRecord } from "./type-guards.js";

export const ALLOWED_SYNTHETIC_FIXTURE_PROMPTS = [
  "Look up the synthetic label amber.",
  "Perform an unavailable synthetic operation.",
  "Look up the synthetic label cobalt.",
] as const;

const DIMENSION_NAMES = ["routing", "arguments", "safety", "completion"] as const;
const REQUIRED_DIMENSION_NAMES = ["routing", "arguments", "completion"] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]{0,126}[A-Za-z0-9])?$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const CREDENTIAL_KEY =
  /^(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|authorization|bearer|cookie|credential|password|private[_-]?key|secret(?:[_-]?key)?|session(?:[_-]?id)?|token(?:[_-]?id)?)$/i;
const ACCOUNT_KEY = /^(?:[A-Za-z0-9]+[_-])*(?:account|address|email|wallet)(?:[_-]?id)?$/i;
const ADDRESS_VALUE =
  /(?:\b0x[a-fA-F0-9]{40}\b|\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
const PRIVATE_HOST_VALUE =
  /(?:\blocalhost\b|\b127(?:\.\d{1,3}){3}\b|\b10(?:\.\d{1,3}){3}\b|\b192\.168(?:\.\d{1,3}){2}\b|\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b|\[?::1\]?|\.(?:internal|local|private)\b)/i;
const RAW_FIELD_NAMES: readonly string[] = [
  "error",
  "final_answer",
  "observations",
  "payload",
  "prompt",
  "raw",
  "request",
  "response",
  "result",
  "scores",
  "tool_calls",
];
export type PublicTextViolationKind =
  | "basic-credential"
  | "bearer-credential"
  | "github-token"
  | "header-credential"
  | "host-absolute-path"
  | "jwt"
  | "private-key"
  | "provider-api-key"
  | "secret-assignment"
  | "uri-userinfo";

/** A value-free public-text finding. `index` is an offset, never captured text. */
export interface PublicTextViolation {
  readonly kind: PublicTextViolationKind;
  readonly index: number;
}

export interface SanitizedEvalAggregateProvenance {
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly fixtureVersion: number;
  readonly catalogSha: string;
}

const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi;

const PROVIDER_API_KEY =
  /\b(?:sk-(?:(?:proj|ant-api\d+)-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|xox(?:b|p|a|r|s)-[0-9A-Za-z-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_CREDENTIAL = /\bBearer\s+([A-Za-z0-9]*[^A-Za-z\s][A-Za-z0-9._~+/-]+)/gi;
const BASIC_CREDENTIAL = /\bBasic\s+([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])/gi;
const HEADER_CREDENTIAL =
  /\b(?:authorization|proxy[-_]authorization|cookie|set[-_]cookie)["']?\s*[:=]\s*["']?([^\r\n"']+)/gi;
const SECRET_ASSIGNMENT =
  /\b(?:[A-Za-z][A-Za-z0-9]*[_-])*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|cookie|secret(?:[_-]?key)?|session(?:[_-]?id)?|password|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|private[_-]?key)(?:\\?["'])?\s*[:=]\s*(?:\\?"([^"\\]*(?:\\.[^"\\]*)*)\\?"|\\?'([^'\\]*(?:\\.[^'\\]*)*)\\?'|([^\s,}\]]+))/gi;
const FILE_ABSOLUTE_URI = /\bfile:\/\/\/[^\s?#]+/gi;
const URI_USERINFO = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+@/gi;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)/g;
const POSIX_ABSOLUTE_PATH = /(?<![A-Za-z0-9_./-])\/{1,2}(?:[^\s/]+\/)*[^\s/]+/g;
const WINDOWS_ABSOLUTE_PATH =
  /(?:\b[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._-]+[\\/])(?:[^\s\\/]+[\\/])*[^\s\\/]+/g;

const NonNegativeCountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveVersionSchema = Schema.Int.check(Schema.isGreaterThan(0));
const SafeIdentifierSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(SAFE_IDENTIFIER),
);
const CatalogShaSchema = Schema.String.check(Schema.isPattern(SHA_256));

export const SanitizedEvalDimensionSummarySchema = Schema.Struct({
  passed: NonNegativeCountSchema,
  failed: NonNegativeCountSchema,
});

export const SanitizedEvalDistributionSchema = Schema.Struct({
  p50: NonNegativeCountSchema,
  p95: NonNegativeCountSchema,
  max: NonNegativeCountSchema,
});
export const SanitizedEvalTokenUsageSchema = Schema.Struct({
  observations: NonNegativeCountSchema,
  inputTokens: NonNegativeCountSchema,
  outputTokens: NonNegativeCountSchema,
  totalTokens: NonNegativeCountSchema,
});

export const SanitizedEvalAggregateSchema = Schema.Struct({
  schemaVersion: Schema.Literal("v1"),
  suiteId: SafeIdentifierSchema,
  suiteVersion: PositiveVersionSchema,
  fixtureVersion: PositiveVersionSchema,
  catalogSha: CatalogShaSchema,
  overall: Schema.Struct({
    passed: NonNegativeCountSchema,
    total: NonNegativeCountSchema,
  }),
  dimensions: Schema.Struct({
    routing: SanitizedEvalDimensionSummarySchema,
    arguments: SanitizedEvalDimensionSummarySchema,
    safety: SanitizedEvalDimensionSummarySchema,
    completion: SanitizedEvalDimensionSummarySchema,
  }),
  skillActivation: SanitizedEvalDimensionSummarySchema,
  latencyMs: SanitizedEvalDistributionSchema,
  totalResultBytes: SanitizedEvalDistributionSchema,
  tokenUsage: SanitizedEvalTokenUsageSchema,
  artifactPolicy: Schema.Literal("sanitized"),
});

export type SanitizedEvalDimensionName = (typeof DIMENSION_NAMES)[number];
export type SanitizedEvalDimensionSummary = typeof SanitizedEvalDimensionSummarySchema.Type;
export type SanitizedEvalDistribution = typeof SanitizedEvalDistributionSchema.Type;
export type SanitizedEvalTokenUsage = typeof SanitizedEvalTokenUsageSchema.Type;
export type SanitizedEvalAggregate = typeof SanitizedEvalAggregateSchema.Type;

export class HermeticEvalSanitizationError extends Data.TaggedError(
  "HermeticEvalSanitizationError",
)<{
  readonly reasons: readonly string[];
}> {}

const addPatternViolations = (
  violations: PublicTextViolation[],
  kind: PublicTextViolationKind,
  text: string,
  pattern: RegExp,
  accepts: (match: RegExpExecArray) => boolean = () => true,
): void => {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (accepts(match)) violations.push({ kind, index: match.index });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  pattern.lastIndex = 0;
};

const isExplicitSyntheticFixtureValue = (value: string): boolean =>
  /^(?:synthetic|fixture|example|fake|test|redacted)(?:[-_][a-z0-9]+)*$/i.test(value);

const isExplicitSyntheticCredential = (value: string): boolean => {
  const trimmed = value.trim();
  const withoutLeadingQuote =
    trimmed.startsWith('"') || trimmed.startsWith("'") ? trimmed.slice(1) : trimmed;
  let end = withoutLeadingQuote.length;
  while (end > 0) {
    const character = withoutLeadingQuote[end - 1];
    if (
      character !== '"' &&
      character !== "'" &&
      character !== "}" &&
      character !== "," &&
      character !== ";"
    ) {
      break;
    }
    end -= 1;
  }
  const unquoted = withoutLeadingQuote.slice(0, end);
  const withoutScheme = unquoted.replace(/^(?:Bearer|Basic)\s+/iu, "");
  return isExplicitSyntheticFixtureValue(withoutScheme);
};

const isExplicitSyntheticHeaderCredential = (match: RegExpExecArray, value: string): boolean => {
  const header = match[0].toLowerCase();
  if (/^(?:set[-_])?cookie\s*:/.test(header)) {
    const assignmentIndex = value.indexOf("=");
    if (assignmentIndex !== -1) {
      return isExplicitSyntheticCredential(value.slice(assignmentIndex + 1));
    }
  }
  return isExplicitSyntheticCredential(value);
};

const isCanonicalBasicCredential = (value: string): boolean => {
  try {
    const decoded = atob(value);
    const paddingIndex = value.indexOf("=");
    const canonical = paddingIndex === -1 ? value : value.slice(0, paddingIndex);
    const encoded = btoa(decoded);
    const encodedPaddingIndex = encoded.indexOf("=");
    const canonicalEncoded =
      encodedPaddingIndex === -1 ? encoded : encoded.slice(0, encodedPaddingIndex);
    return canonicalEncoded === canonical && decoded.includes(":");
  } catch {
    return false;
  }
};

/**
 * Enumerates value-free public-text policy violations. It deliberately returns
 * only categories and offsets so callers can reject text without persisting a secret.
 */
export const findPublicTextViolations = (text: string): readonly PublicTextViolation[] => {
  if (
    ALLOWED_SYNTHETIC_FIXTURE_PROMPTS.includes(
      text as (typeof ALLOWED_SYNTHETIC_FIXTURE_PROMPTS)[number],
    )
  ) {
    return [];
  }

  const violations: PublicTextViolation[] = [];
  addPatternViolations(violations, "github-token", text, GITHUB_TOKEN);
  addPatternViolations(violations, "provider-api-key", text, PROVIDER_API_KEY);
  addPatternViolations(violations, "jwt", text, JWT);
  addPatternViolations(
    violations,
    "bearer-credential",
    text,
    BEARER_CREDENTIAL,
    (match) => !isExplicitSyntheticCredential(match[1] ?? ""),
  );
  addPatternViolations(violations, "basic-credential", text, BASIC_CREDENTIAL, (match) =>
    isCanonicalBasicCredential(match[1] ?? ""),
  );
  addPatternViolations(
    violations,
    "header-credential",
    text,
    HEADER_CREDENTIAL,
    (match) => !isExplicitSyntheticHeaderCredential(match, match[1] ?? ""),
  );
  addPatternViolations(
    violations,
    "secret-assignment",
    text,
    SECRET_ASSIGNMENT,
    (match) => !isExplicitSyntheticHeaderCredential(match, match[1] ?? match[2] ?? match[3] ?? ""),
  );
  addPatternViolations(violations, "host-absolute-path", text, FILE_ABSOLUTE_URI);
  addPatternViolations(violations, "uri-userinfo", text, URI_USERINFO);
  addPatternViolations(violations, "private-key", text, PRIVATE_KEY_BLOCK);
  addPatternViolations(violations, "host-absolute-path", text, POSIX_ABSOLUTE_PATH, (match) => {
    const prefix = text.slice(0, match.index);
    return !/[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/u.test(prefix) && text[match.index - 1] !== "/";
  });
  addPatternViolations(violations, "host-absolute-path", text, WINDOWS_ABSOLUTE_PATH);
  return violations.sort(
    (left, right) => left.index - right.index || left.kind.localeCompare(right.kind),
  );
};

const inspectForbiddenContent = (value: unknown, path: string, reasons: string[]): void => {
  if (typeof value === "string") {
    if (value.length > 128) reasons.push(`${path} contains an unbounded string`);
    for (const violation of findPublicTextViolations(value)) {
      reasons.push(`${path} contains ${violation.kind} at offset ${violation.index}`);
    }
    if (ADDRESS_VALUE.test(value)) reasons.push(`${path} contains account/address data`);
    if (PRIVATE_HOST_VALUE.test(value)) reasons.push(`${path} contains a private or internal host`);
    if (
      path.toLowerCase().endsWith("prompt") &&
      !ALLOWED_SYNTHETIC_FIXTURE_PROMPTS.includes(
        value as (typeof ALLOWED_SYNTHETIC_FIXTURE_PROMPTS)[number],
      )
    ) {
      reasons.push(`${path} contains a non-allowlisted prompt`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectForbiddenContent(child, `${path}[${index}]`, reasons));
    return;
  }
  if (!isUnknownRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const isAllowedAggregateField =
      (path === "aggregate.dimensions" && key === "arguments") ||
      (path === "aggregate.tokenUsage" && key === "observations");
    if (RAW_FIELD_NAMES.includes(key) && !isAllowedAggregateField) {
      reasons.push(`${childPath} is a forbidden raw-eval field`);
    }
    if (CREDENTIAL_KEY.test(key)) reasons.push(`${childPath} is a credential field`);
    if (ACCOUNT_KEY.test(key)) reasons.push(`${childPath} is an account/address field`);
    inspectForbiddenContent(child, childPath, reasons);
  }
};

const isProvenance = (value: unknown): value is SanitizedEvalAggregateProvenance =>
  isUnknownRecord(value) &&
  Object.keys(value).length === 4 &&
  Object.hasOwn(value, "suiteId") &&
  Object.hasOwn(value, "suiteVersion") &&
  Object.hasOwn(value, "fixtureVersion") &&
  Object.hasOwn(value, "catalogSha") &&
  typeof value.suiteId === "string" &&
  typeof value.suiteVersion === "number" &&
  typeof value.fixtureVersion === "number" &&
  typeof value.catalogSha === "string";

const validateAggregateInvariants = (
  aggregate: SanitizedEvalAggregate,
): Effect.Effect<SanitizedEvalAggregate, HermeticEvalSanitizationError> => {
  const reasons: string[] = [];
  if (aggregate.overall.passed > aggregate.overall.total) {
    reasons.push("aggregate.overall.passed cannot exceed total");
  }
  for (const name of REQUIRED_DIMENSION_NAMES) {
    const summary = aggregate.dimensions[name];
    if (summary.passed + summary.failed !== aggregate.overall.total) {
      reasons.push(`aggregate.dimensions.${name} counts must equal aggregate.overall.total`);
    }
    if (aggregate.overall.passed > summary.passed) {
      reasons.push(`aggregate.overall.passed cannot exceed aggregate.dimensions.${name}.passed`);
    }
  }
  for (const [name, summary] of [
    ["dimensions.safety", aggregate.dimensions.safety],
    ["skillActivation", aggregate.skillActivation],
  ] as const) {
    if (summary.passed + summary.failed > aggregate.overall.total) {
      reasons.push(`aggregate.${name} counts cannot exceed aggregate.overall.total`);
    }
    if (summary.failed > aggregate.overall.total - aggregate.overall.passed) {
      reasons.push(`aggregate.${name}.failed cannot exceed aggregate.overall.failed`);
    }
  }
  for (const [name, distribution] of [
    ["latencyMs", aggregate.latencyMs],
    ["totalResultBytes", aggregate.totalResultBytes],
  ] as const) {
    if (distribution.p50 > distribution.p95 || distribution.p95 > distribution.max) {
      reasons.push(`aggregate.${name} must satisfy p50 <= p95 <= max`);
    }
  }
  return reasons.length === 0
    ? Effect.succeed(aggregate)
    : Effect.fail(new HermeticEvalSanitizationError({ reasons }));
};

const pinAggregateProvenance = (
  aggregate: SanitizedEvalAggregate,
  expected: SanitizedEvalAggregateProvenance,
): Effect.Effect<SanitizedEvalAggregate, HermeticEvalSanitizationError> => {
  const reasons: string[] = [];
  if (aggregate.suiteId !== expected.suiteId) {
    reasons.push("aggregate.suiteId does not match expected provenance");
  }
  if (aggregate.suiteVersion !== expected.suiteVersion) {
    reasons.push("aggregate.suiteVersion does not match expected provenance");
  }
  if (aggregate.fixtureVersion !== expected.fixtureVersion) {
    reasons.push("aggregate.fixtureVersion does not match expected provenance");
  }
  if (aggregate.catalogSha !== expected.catalogSha) {
    reasons.push("aggregate.catalogSha does not match expected provenance");
  }
  return reasons.length === 0
    ? Effect.succeed({
        ...aggregate,
        suiteId: expected.suiteId,
        suiteVersion: expected.suiteVersion,
        fixtureVersion: expected.fixtureVersion,
        catalogSha: expected.catalogSha,
      })
    : Effect.fail(new HermeticEvalSanitizationError({ reasons }));
};

/** Validates and pins the exact public aggregate schema; it never redacts. */
export const sanitizeEvalAggregate = Function.dual<
  (
    expected: SanitizedEvalAggregateProvenance,
  ) => (input: unknown) => Effect.Effect<SanitizedEvalAggregate, HermeticEvalSanitizationError>,
  (
    input: unknown,
    expected: SanitizedEvalAggregateProvenance,
  ) => Effect.Effect<SanitizedEvalAggregate, HermeticEvalSanitizationError>
>(2, (input, expected) => {
  const reasons: string[] = [];
  inspectForbiddenContent(input, "aggregate", reasons);
  inspectForbiddenContent(expected, "expected", reasons);
  if (!isProvenance(expected)) reasons.push("expected provenance is malformed");
  if (reasons.length > 0) {
    return Effect.fail(new HermeticEvalSanitizationError({ reasons }));
  }
  return Schema.decodeUnknownEffect(SanitizedEvalAggregateSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(
      () =>
        new HermeticEvalSanitizationError({ reasons: ["aggregate does not match public schema"] }),
    ),
    Effect.flatMap(validateAggregateInvariants),
    Effect.flatMap((aggregate) => pinAggregateProvenance(aggregate, expected)),
  );
});
