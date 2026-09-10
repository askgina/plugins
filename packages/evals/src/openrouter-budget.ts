import { Data, Duration, Effect, Redacted, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { collectBoundedUtf8Output } from "./bounded-output";

/** GET current-key document used for provider-limit admission. */
export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

/** Short bound for the read-only current-key preflight. Not a dollar cap. */
export const OPENROUTER_BUDGET_DEADLINE_MS = 5_000;

const MAX_KEY_BODY_BYTES = 16_384;
const KEY_HOST = "openrouter.ai";
const KEY_PATH = "/api/v1/key";

/**
 * OpenRouter GET /key is provider-limit admission, not a mathematical
 * end-to-end cost guarantee. In-flight usage, recharges, external auth, and
 * provider overshoot remain unproven. Timeout and max_price are not dollar caps.
 */
export const OPENROUTER_BUDGET_LIMITATIONS = [
  "in-flight-usage-unobserved",
  "delayed-settlement-unobserved",
  "provider-limit-mutable",
  "external-auth-unobserved",
  "overshoot-unproven",
] as const;

export type OpenRouterBudgetLimitation = (typeof OPENROUTER_BUDGET_LIMITATIONS)[number];

export type OpenRouterBudgetErrorReason =
  | "invalid-request"
  | "unavailable"
  | "timeout"
  | "redirect"
  | "http-rejected"
  | "malformed-payload"
  | "management-key"
  | "unbounded-limit"
  | "resetting-limit"
  | "byok-excluded"
  | "limit-exceeds-maximum"
  | "remaining-exhausted"
  | "inconsistent-limit";

/** Bounded failure: reason enum only. Never keys, labels, or provider bodies. */
export class OpenRouterBudgetError extends Data.TaggedError("OpenRouterBudgetError")<{
  readonly reason: OpenRouterBudgetErrorReason;
}> {}

export const OpenRouterBudgetEvidenceSchema = Schema.Struct({
  kind: Schema.Literal("openrouter-provider-limit-admission"),
  requestedMaximumUsd: Schema.Finite.check(Schema.isGreaterThan(0)),
  providerLimitUsd: Schema.Finite.check(Schema.isGreaterThan(0)),
  providerUsageUsd: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  providerRemainingUsd: Schema.Finite.check(Schema.isGreaterThan(0)),
  includeByokInLimit: Schema.Literal(true),
  limitations: Schema.Array(Schema.Literals(OPENROUTER_BUDGET_LIMITATIONS)).check(
    Schema.isMinLength(OPENROUTER_BUDGET_LIMITATIONS.length),
    Schema.isMaxLength(OPENROUTER_BUDGET_LIMITATIONS.length),
    Schema.makeFilter((limitations) => {
      const unique = new Set(limitations);
      return (
        unique.size === OPENROUTER_BUDGET_LIMITATIONS.length &&
        OPENROUTER_BUDGET_LIMITATIONS.every((limitation) => unique.has(limitation))
      );
    }),
  ),
});

export type OpenRouterBudgetEvidence = typeof OpenRouterBudgetEvidenceSchema.Type;

const NullableFinite = Schema.NullOr(Schema.Finite);
const OpenRouterKeyDataSchema = Schema.Struct({
  limit: NullableFinite,
  limit_remaining: NullableFinite,
  limit_reset: Schema.NullOr(Schema.String),
  usage: Schema.Finite,
  include_byok_in_limit: Schema.Boolean,
  is_management_key: Schema.Boolean,
});
const OpenRouterKeyResponseSchema = Schema.Struct({
  data: OpenRouterKeyDataSchema,
});
const decodeKeyJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown), {
  errors: "all",
});
const decodeKeyPayload = Schema.decodeUnknownEffect(OpenRouterKeyResponseSchema, {
  errors: "all",
});
const decodeBudgetEvidence = Schema.decodeUnknownEffect(OpenRouterBudgetEvidenceSchema, {
  errors: "all",
  onExcessProperty: "error",
});

const fail = (reason: OpenRouterBudgetErrorReason): Effect.Effect<never, OpenRouterBudgetError> =>
  Effect.fail(new OpenRouterBudgetError({ reason }));

const usageRemainingFitsLimit = (usage: number, remaining: number, limit: number): boolean => {
  const sum = usage + remaining;
  // Allow only addition roundoff; provider consistency bounds remain exact.
  return (
    Number.isFinite(sum) &&
    (sum <= limit || sum - limit <= Number.EPSILON * Math.max(usage, remaining, limit))
  );
};

// Maxima are positive and finite. No fixed dollar allowance is introduced.
const exceeds = (value: number, maximum: number): boolean =>
  value > maximum && (value - maximum) / maximum > Number.EPSILON;

const hasInconsistentLimit = (limit: number, usage: number, remaining: number): boolean =>
  remaining > limit || usage > limit || !usageRemainingFitsLimit(usage, remaining, limit);

const isExactKeyUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === KEY_HOST &&
      parsed.port === "" &&
      parsed.pathname === KEY_PATH &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
};

/**
 * Pure admission over a GET /key-shaped payload. Deterministic: no network.
 * Provider `limit` is the lifetime total for this key and must fit the requested
 * per-run budget; remaining is not an independent loophole.
 */
export const admitOpenRouterBudgetEvidence = (options: {
  readonly maximumUsd: number;
  readonly payload: unknown;
}): Effect.Effect<OpenRouterBudgetEvidence, OpenRouterBudgetError> => {
  if (!Number.isFinite(options.maximumUsd) || options.maximumUsd <= 0) {
    return fail("invalid-request");
  }
  return decodeKeyPayload(options.payload).pipe(
    Effect.mapError(() => new OpenRouterBudgetError({ reason: "malformed-payload" })),
    Effect.flatMap((parsed) => {
      const { data } = parsed;
      if (data.is_management_key) {
        return fail("management-key");
      }
      if (data.limit === null) {
        return fail("unbounded-limit");
      }
      if (data.limit <= 0) {
        return fail("malformed-payload");
      }
      if (data.limit_reset !== null) {
        return fail("resetting-limit");
      }
      if (!data.include_byok_in_limit) {
        return fail("byok-excluded");
      }
      if (data.limit_remaining === null) {
        return fail("inconsistent-limit");
      }
      if (data.usage < 0 || data.limit_remaining < 0) {
        return fail("inconsistent-limit");
      }
      if (hasInconsistentLimit(data.limit, data.usage, data.limit_remaining)) {
        return fail("inconsistent-limit");
      }
      if (data.limit_remaining <= 0) {
        return fail("remaining-exhausted");
      }
      return validateOpenRouterBudgetEvidence({
        kind: "openrouter-provider-limit-admission",
        requestedMaximumUsd: options.maximumUsd,
        providerLimitUsd: data.limit,
        providerUsageUsd: data.usage,
        providerRemainingUsd: data.limit_remaining,
        includeByokInLimit: true,
        limitations: OPENROUTER_BUDGET_LIMITATIONS,
      });
    }),
  );
};

export const validateOpenRouterBudgetEvidence = (
  value: unknown,
): Effect.Effect<OpenRouterBudgetEvidence, OpenRouterBudgetError> =>
  decodeBudgetEvidence(value).pipe(
    Effect.mapError(() => new OpenRouterBudgetError({ reason: "malformed-payload" })),
    Effect.flatMap((evidence) => {
      if (
        hasInconsistentLimit(
          evidence.providerLimitUsd,
          evidence.providerUsageUsd,
          evidence.providerRemainingUsd,
        )
      ) {
        return fail("inconsistent-limit");
      }
      if (
        exceeds(evidence.providerLimitUsd, evidence.requestedMaximumUsd) ||
        exceeds(evidence.providerRemainingUsd, evidence.requestedMaximumUsd)
      ) {
        return fail("limit-exceeds-maximum");
      }
      return Effect.succeed(evidence);
    }),
  );

const executeKeyRequest = (
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<
  { readonly status: number; readonly text: string; readonly truncated: boolean },
  OpenRouterBudgetError
> => {
  if (!isExactKeyUrl(request.url) || request.method !== "GET") {
    return fail("redirect");
  }
  const guarded = HttpClient.mapRequest(client, (outgoing) =>
    isExactKeyUrl(outgoing.url)
      ? outgoing
      : HttpClientRequest.removeHeader(outgoing, "authorization"),
  );
  return guarded.execute(request).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    Effect.mapError(() => new OpenRouterBudgetError({ reason: "unavailable" })),
    Effect.flatMap((response) => {
      if (!isExactKeyUrl(response.request.url)) {
        return fail("redirect");
      }
      if (response.status >= 300 && response.status < 400) {
        return fail("redirect");
      }
      if (response.status < 200 || response.status >= 300) {
        return fail("http-rejected");
      }
      return collectBoundedUtf8Output(response.stream, MAX_KEY_BODY_BYTES).pipe(
        Effect.mapError(() => new OpenRouterBudgetError({ reason: "unavailable" })),
      );
    }),
    Effect.flatMap((body) => {
      if (body.truncated) {
        return fail("malformed-payload");
      }
      return Effect.succeed({ status: 200, text: body.text, truncated: false });
    }),
  );
};

/**
 * Read-only OpenRouter current-key preflight. Does not create or mutate keys.
 * Does not prove a hard external dollar cap.
 */
export const preflightOpenRouterBudget = (options: {
  readonly apiKey: Redacted.Redacted<string>;
  readonly maximumUsd: number;
}): Effect.Effect<OpenRouterBudgetEvidence, OpenRouterBudgetError, HttpClient.HttpClient> => {
  if (
    !Number.isFinite(options.maximumUsd) ||
    options.maximumUsd <= 0 ||
    Redacted.value(options.apiKey).length === 0
  ) {
    return fail("invalid-request");
  }
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${Redacted.value(options.apiKey)}` },
      acceptJson: true,
    });
    const body = yield* executeKeyRequest(client, request);
    const payload = yield* decodeKeyJson(body.text).pipe(
      Effect.mapError(() => new OpenRouterBudgetError({ reason: "malformed-payload" })),
    );
    return yield* admitOpenRouterBudgetEvidence({
      maximumUsd: options.maximumUsd,
      payload,
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(OPENROUTER_BUDGET_DEADLINE_MS),
      orElse: () => fail("timeout"),
    }),
  );
};
