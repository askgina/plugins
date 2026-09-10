import { assert, describe, it } from "@effect/vitest";
import { Cause, Duration, Effect, Exit, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import {
  OPENROUTER_BUDGET_DEADLINE_MS,
  OPENROUTER_BUDGET_LIMITATIONS,
  OPENROUTER_KEY_URL,
  OpenRouterBudgetError,
  admitOpenRouterBudgetEvidence,
  preflightOpenRouterBudget,
  validateOpenRouterBudgetEvidence,
  type OpenRouterBudgetErrorReason,
} from "../src/openrouter-budget";

const API_KEY = Redacted.make(["sk", "-or-v1-secret-budget-key-must-not-leak"].join(""));
const PLANTED_LABEL = ["sk", "-or-v1-au7-planted-label-must-not-leak"].join("");
const PLANTED_BODY = "provider-key-body-must-not-be-copied";
const MAXIMUM_USD = 5;

const admittedPayload = {
  data: {
    limit: 5,
    limit_remaining: 4,
    limit_reset: null,
    usage: 1,
    include_byok_in_limit: true,
    is_management_key: false,
    label: PLANTED_LABEL,
  },
} as const;

const serialized = (value: unknown): string => JSON.stringify(value);

const assertReason = (
  result: { readonly _tag: string; readonly failure?: unknown },
  reason: OpenRouterBudgetErrorReason,
) => {
  assert.strictEqual(result._tag, "Failure");
  if (result._tag !== "Failure") return;
  assert.instanceOf(result.failure, OpenRouterBudgetError);
  if (!(result.failure instanceof OpenRouterBudgetError)) return;
  assert.strictEqual(result.failure.reason, reason);
  const text = serialized(result.failure);
  assert.notInclude(text, Redacted.value(API_KEY));
  assert.notInclude(text, PLANTED_LABEL);
  assert.notInclude(text, PLANTED_BODY);
};

const admittedEvidence = {
  kind: "openrouter-provider-limit-admission" as const,
  requestedMaximumUsd: MAXIMUM_USD,
  providerLimitUsd: 5,
  providerUsageUsd: 1,
  providerRemainingUsd: 4,
  includeByokInLimit: true as const,
  limitations: OPENROUTER_BUDGET_LIMITATIONS,
};

const admit = (payload: unknown, maximumUsd = MAXIMUM_USD) =>
  admitOpenRouterBudgetEvidence({ maximumUsd, payload }).pipe(Effect.result);

const validate = (value: unknown) => validateOpenRouterBudgetEvidence(value).pipe(Effect.result);

const responseFor = (
  request: HttpClientRequest.HttpClientRequest,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );

const runPreflight = (client: HttpClient.HttpClient, maximumUsd = MAXIMUM_USD) =>
  preflightOpenRouterBudget({ apiKey: API_KEY, maximumUsd }).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.result,
  );

describe("admitOpenRouterBudgetEvidence", () => {
  it.effect("admits a finite nonresetting lifetime limit that fits the requested budget", () =>
    Effect.gen(function* () {
      const evidence = yield* admitOpenRouterBudgetEvidence({
        maximumUsd: MAXIMUM_USD,
        payload: admittedPayload,
      });
      assert.deepStrictEqual(evidence, {
        kind: "openrouter-provider-limit-admission",
        requestedMaximumUsd: MAXIMUM_USD,
        providerLimitUsd: 5,
        providerUsageUsd: 1,
        providerRemainingUsd: 4,
        includeByokInLimit: true,
        limitations: OPENROUTER_BUDGET_LIMITATIONS,
      });
      assert.notInclude(serialized(evidence), PLANTED_LABEL);
      assert.ok(evidence.limitations.includes("overshoot-unproven"));
      assert.ok(evidence.limitations.includes("in-flight-usage-unobserved"));
      assert.ok(evidence.limitations.includes("delayed-settlement-unobserved"));
      assert.ok(evidence.limitations.includes("provider-limit-mutable"));
      assert.ok(evidence.limitations.includes("external-auth-unobserved"));
    }),
  );

  it.effect(
    "rejects malformed infinity, negative, used-up, null, resetting, and inconsistent values",
    () =>
      Effect.gen(function* () {
        const rows: ReadonlyArray<{
          readonly reason: OpenRouterBudgetErrorReason;
          readonly payload: unknown;
          readonly maximumUsd?: number;
        }> = [
          {
            reason: "malformed-payload",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit: Number.POSITIVE_INFINITY },
            },
          },
          {
            reason: "unbounded-limit",
            payload: { ...admittedPayload, data: { ...admittedPayload.data, limit: null } },
          },
          {
            reason: "malformed-payload",
            payload: { ...admittedPayload, data: { ...admittedPayload.data, limit: -1 } },
          },
          {
            reason: "malformed-payload",
            payload: { ...admittedPayload, data: { ...admittedPayload.data, usage: Number.NaN } },
          },
          {
            reason: "malformed-payload",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_remaining: Number.POSITIVE_INFINITY },
            },
          },
          {
            reason: "remaining-exhausted",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_remaining: 0, usage: 5 },
            },
          },
          {
            reason: "inconsistent-limit",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_remaining: null },
            },
          },
          {
            reason: "inconsistent-limit",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_remaining: -0.5 },
            },
          },
          {
            reason: "inconsistent-limit",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_remaining: 6, usage: 0 },
            },
          },
          {
            reason: "inconsistent-limit",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_remaining: 4, usage: 2 },
            },
          },
          {
            reason: "resetting-limit",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit_reset: "monthly" },
            },
          },
          {
            reason: "management-key",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, is_management_key: true },
            },
          },
          {
            reason: "byok-excluded",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, include_byok_in_limit: false },
            },
          },
          {
            reason: "limit-exceeds-maximum",
            payload: {
              ...admittedPayload,
              data: { ...admittedPayload.data, limit: 100, limit_remaining: 4, usage: 96 },
            },
          },
          {
            reason: "invalid-request",
            payload: admittedPayload,
            maximumUsd: Number.POSITIVE_INFINITY,
          },
          { reason: "invalid-request", payload: admittedPayload, maximumUsd: 0 },
          { reason: "malformed-payload", payload: { label: PLANTED_LABEL } },
        ];
        for (const row of rows) {
          assertReason(yield* admit(row.payload, row.maximumUsd), row.reason);
        }
      }),
  );

  it.effect("does not treat leftover remaining on a larger lifetime limit as the run budget", () =>
    Effect.gen(function* () {
      assertReason(
        yield* admit({
          data: {
            ...admittedPayload.data,
            limit: 100,
            limit_remaining: 1,
            usage: 99,
          },
        }),
        "limit-exceeds-maximum",
      );
    }),
  );

  it.effect("admits decimal usage and remaining that sum to the lifetime limit", () =>
    Effect.gen(function* () {
      const evidence = yield* admitOpenRouterBudgetEvidence({
        maximumUsd: 0.3,
        payload: {
          data: {
            ...admittedPayload.data,
            limit: 0.3,
            usage: 0.1,
            limit_remaining: 0.2,
          },
        },
      });
      assert.deepStrictEqual(evidence, {
        kind: "openrouter-provider-limit-admission",
        requestedMaximumUsd: 0.3,
        providerLimitUsd: 0.3,
        providerUsageUsd: 0.1,
        providerRemainingUsd: 0.2,
        includeByokInLimit: true,
        limitations: OPENROUTER_BUDGET_LIMITATIONS,
      });
    }),
  );

  it.effect("admits zero usage when remaining equals the lifetime limit", () =>
    Effect.gen(function* () {
      const evidence = yield* admitOpenRouterBudgetEvidence({
        maximumUsd: MAXIMUM_USD,
        payload: {
          data: {
            ...admittedPayload.data,
            usage: 0,
            limit_remaining: 5,
          },
        },
      });
      assert.strictEqual(evidence.providerUsageUsd, 0);
      assert.strictEqual(evidence.providerRemainingUsd, 5);
    }),
  );

  it.effect(
    "admits a binary-sum cap equal to the requested maximum and rejects a two-ulp overshoot",
    () =>
      Effect.gen(function* () {
        const cap = 0.1 + 0.2;
        const evidence = yield* admitOpenRouterBudgetEvidence({
          maximumUsd: 0.3,
          payload: {
            data: {
              ...admittedPayload.data,
              limit: cap,
              usage: 0,
              limit_remaining: cap,
            },
          },
        });
        assert.strictEqual(evidence.providerLimitUsd, cap);
        assert.strictEqual(evidence.providerRemainingUsd, cap);
        assert.strictEqual(evidence.providerUsageUsd, 0);
        assert.strictEqual(evidence.requestedMaximumUsd, 0.3);
        assertReason(
          yield* admit(
            {
              data: {
                ...admittedPayload.data,
                limit: 0.3000000000000001,
                usage: 0,
                limit_remaining: 0.3000000000000001,
              },
            },
            0.3,
          ),
          "limit-exceeds-maximum",
        );
      }),
  );

  it.effect("rejects a truly inconsistent decimal remaining-plus-usage sum", () =>
    Effect.gen(function* () {
      assertReason(
        yield* admit(
          {
            data: {
              ...admittedPayload.data,
              limit: 0.3,
              usage: 0.2,
              limit_remaining: 0.2,
            },
          },
          0.3,
        ),
        "inconsistent-limit",
      );
    }),
  );
});

describe("validateOpenRouterBudgetEvidence", () => {
  it.effect("admits decimal usage and remaining that sum to the lifetime limit", () =>
    Effect.gen(function* () {
      const evidence = yield* validateOpenRouterBudgetEvidence({
        ...admittedEvidence,
        requestedMaximumUsd: 0.3,
        providerLimitUsd: 0.3,
        providerUsageUsd: 0.1,
        providerRemainingUsd: 0.2,
      });
      assert.strictEqual(evidence.providerLimitUsd, 0.3);
      assert.strictEqual(evidence.providerUsageUsd, 0.1);
      assert.strictEqual(evidence.providerRemainingUsd, 0.2);
    }),
  );

  it.effect(
    "admits a binary-sum cap equal to the requested maximum and rejects a two-ulp overshoot",
    () =>
      Effect.gen(function* () {
        const cap = 0.1 + 0.2;
        const evidence = yield* validateOpenRouterBudgetEvidence({
          ...admittedEvidence,
          requestedMaximumUsd: 0.3,
          providerLimitUsd: cap,
          providerUsageUsd: 0,
          providerRemainingUsd: cap,
        });
        assert.strictEqual(evidence.providerLimitUsd, cap);
        assert.strictEqual(evidence.providerRemainingUsd, cap);
        assert.strictEqual(evidence.providerUsageUsd, 0);
        assert.strictEqual(evidence.requestedMaximumUsd, 0.3);
        assertReason(
          yield* validate({
            ...admittedEvidence,
            requestedMaximumUsd: 0.3,
            providerLimitUsd: 0.3000000000000001,
            providerUsageUsd: 0,
            providerRemainingUsd: 0.3000000000000001,
          }),
          "limit-exceeds-maximum",
        );
      }),
  );

  it.effect("rejects inconsistent tiny amounts and overflowing sums without decimal rounding", () =>
    Effect.gen(function* () {
      assertReason(
        yield* validateOpenRouterBudgetEvidence({
          ...admittedEvidence,
          requestedMaximumUsd: 1.5e-17,
          providerLimitUsd: 1.5e-17,
          providerUsageUsd: 1e-17,
          providerRemainingUsd: 1e-17,
        }).pipe(Effect.result),
        "inconsistent-limit",
      );
      assertReason(
        yield* validateOpenRouterBudgetEvidence({
          ...admittedEvidence,
          requestedMaximumUsd: 1e308,
          providerLimitUsd: 1e308,
          providerUsageUsd: 9e307,
          providerRemainingUsd: 9e307,
        }).pipe(Effect.result),
        "inconsistent-limit",
      );
    }),
  );

  it.effect("rejects zeros, oversized limits, inconsistent decimals, and wrong limitations", () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<{
        readonly reason: OpenRouterBudgetErrorReason;
        readonly value: unknown;
      }> = [
        {
          reason: "malformed-payload",
          value: { ...admittedEvidence, requestedMaximumUsd: 0 },
        },
        {
          reason: "malformed-payload",
          value: {
            ...admittedEvidence,
            providerLimitUsd: 0,
            providerUsageUsd: 0,
            providerRemainingUsd: 0,
          },
        },
        {
          reason: "malformed-payload",
          value: { ...admittedEvidence, providerRemainingUsd: 0, providerUsageUsd: 5 },
        },
        {
          reason: "malformed-payload",
          value: { ...admittedEvidence, providerUsageUsd: -1, providerRemainingUsd: 5 },
        },
        {
          reason: "malformed-payload",
          value: { ...admittedEvidence, includeByokInLimit: false },
        },
        {
          reason: "malformed-payload",
          value: {
            ...admittedEvidence,
            limitations: OPENROUTER_BUDGET_LIMITATIONS.slice(1),
          },
        },
        {
          reason: "malformed-payload",
          value: {
            ...admittedEvidence,
            limitations: [...OPENROUTER_BUDGET_LIMITATIONS, OPENROUTER_BUDGET_LIMITATIONS[0]],
          },
        },
        {
          reason: "malformed-payload",
          value: {
            ...admittedEvidence,
            limitations: [
              OPENROUTER_BUDGET_LIMITATIONS[0],
              OPENROUTER_BUDGET_LIMITATIONS[0],
              OPENROUTER_BUDGET_LIMITATIONS[1],
              OPENROUTER_BUDGET_LIMITATIONS[2],
              OPENROUTER_BUDGET_LIMITATIONS[3],
            ],
          },
        },
        {
          reason: "malformed-payload",
          value: { ...admittedEvidence, label: PLANTED_LABEL },
        },
        {
          reason: "inconsistent-limit",
          value: {
            ...admittedEvidence,
            requestedMaximumUsd: 0.3,
            providerLimitUsd: 0.3,
            providerUsageUsd: 0.2,
            providerRemainingUsd: 0.2,
          },
        },
        {
          reason: "inconsistent-limit",
          value: {
            ...admittedEvidence,
            providerLimitUsd: 0.3,
            providerUsageUsd: 0,
            providerRemainingUsd: 0.4,
          },
        },
        {
          reason: "limit-exceeds-maximum",
          value: {
            ...admittedEvidence,
            requestedMaximumUsd: 0.3,
            providerLimitUsd: 0.4,
            providerUsageUsd: 0.1,
            providerRemainingUsd: 0.2,
          },
        },
      ];
      for (const row of rows) {
        assertReason(yield* validate(row.value), row.reason);
      }
    }),
  );
});

describe("preflightOpenRouterBudget", () => {
  it.effect("GETs the current-key document and returns bounded numeric evidence", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const client = HttpClient.make((request) => {
        requests.push(request);
        return Effect.succeed(responseFor(request, 200, admittedPayload));
      });
      const result = yield* runPreflight(client);
      assert.strictEqual(result._tag, "Success");
      if (result._tag !== "Success") return;
      assert.strictEqual(result.success.kind, "openrouter-provider-limit-admission");
      assert.strictEqual(result.success.requestedMaximumUsd, MAXIMUM_USD);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0]?.method, "GET");
      assert.strictEqual(requests[0]?.url, OPENROUTER_KEY_URL);
      assert.strictEqual(requests[0]?.headers.authorization, `Bearer ${Redacted.value(API_KEY)}`);
      assert.notInclude(serialized(result.success), Redacted.value(API_KEY));
      assert.notInclude(serialized(result.success), PLANTED_LABEL);
    }),
  );

  it.effect("rejects redirects without following them or copying location bodies", () =>
    Effect.gen(function* () {
      let calls = 0;
      const client = HttpClient.make((request) => {
        calls += 1;
        return Effect.succeed(
          responseFor(request, 302, PLANTED_BODY, {
            location: "https://evil.example/steal",
          }),
        );
      });
      const result = yield* runPreflight(client);
      assertReason(result, "redirect");
      assert.strictEqual(calls, 1);
    }),
  );

  it.effect("rejects HTTP failures without copying provider bodies", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(responseFor(request, 401, { error: { message: PLANTED_BODY } })),
      );
      assertReason(yield* runPreflight(client), "http-rejected");
    }),
  );

  it.effect("maps transport failure to unavailable without a fallback budget", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: PLANTED_BODY,
            }),
          }),
        ),
      );
      assertReason(yield* runPreflight(client), "unavailable");
    }),
  );

  it.effect("rejects an empty key before connecting", () =>
    Effect.gen(function* () {
      let calls = 0;
      const client = HttpClient.make(() => {
        calls += 1;
        return Effect.die("unreachable");
      });
      const result = yield* preflightOpenRouterBudget({
        apiKey: Redacted.make(""),
        maximumUsd: MAXIMUM_USD,
      }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.result);
      assertReason(result, "invalid-request");
      assert.strictEqual(calls, 0);
    }),
  );

  it.effect("times out a hanging current-key read", () =>
    Effect.gen(function* () {
      const client = HttpClient.make(
        () =>
          Effect.never as Effect.Effect<
            HttpClientResponse.HttpClientResponse,
            HttpClientError.HttpClientError
          >,
      );
      const fiber = yield* Effect.forkChild(
        preflightOpenRouterBudget({ apiKey: API_KEY, maximumUsd: MAXIMUM_USD }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      );
      yield* TestClock.adjust(Duration.millis(OPENROUTER_BUDGET_DEADLINE_MS));
      const exit = yield* Fiber.await(fiber);
      assert.strictEqual(Exit.isFailure(exit), true);
      if (!Exit.isFailure(exit)) return;
      const failure = Cause.squash(exit.cause);
      assertReason({ _tag: "Failure", failure }, "timeout");
    }),
  );
});
