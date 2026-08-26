import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  findPublicTextViolations,
  sanitizeEvalAggregate,
  type SanitizedEvalAggregate,
  type SanitizedEvalAggregateProvenance,
} from "../src/index.js";

const collectPublicStrings = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectPublicStrings);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectPublicStrings(nested)]);
  }
  return [];
};

const aggregate: SanitizedEvalAggregate = {
  schemaVersion: "v1",
  suiteId: "synthetic-model-smoke-v1",
  suiteVersion: 1,
  fixtureVersion: 1,
  catalogSha: "06a3c7ca4f56617e7aebdcc840b96f4fcfbffeafb7d5b359d1d4c90eb4aeefda",
  overall: { passed: 2, total: 3 },
  dimensions: {
    routing: { passed: 2, failed: 1 },
    arguments: { passed: 2, failed: 1 },
    safety: { passed: 2, failed: 0 },
    completion: { passed: 3, failed: 0 },
  },
  skillActivation: { passed: 0, failed: 0 },
  latencyMs: { p50: 1, p95: 1, max: 1 },
  totalResultBytes: { p50: 0, p95: 0, max: 0 },
  tokenUsage: { observations: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  artifactPolicy: "sanitized",
};

const expected: SanitizedEvalAggregateProvenance = {
  suiteId: aggregate.suiteId,
  suiteVersion: aggregate.suiteVersion,
  fixtureVersion: aggregate.fixtureVersion,
  catalogSha: aggregate.catalogSha,
};

const failureReasons = (input: unknown, provenance = expected) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(sanitizeEvalAggregate(input, provenance));
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Success") return [];
    assert.strictEqual(result.failure._tag, "HermeticEvalSanitizationError");
    return result.failure.reasons;
  });

describe("public eval text detection", () => {
  it("enumerates decoy-then-real assignments and provider tokens without values", () => {
    const secret = ["sk", "-proj-0123456789abcdefghijklmnop"].join("");
    const text = `OPENAI_API_KEY=synthetic-fixture OPENAI_API_KEY=${secret}`;
    const violations = findPublicTextViolations(text);

    assert.deepStrictEqual(violations.map(({ kind }) => kind).sort(), [
      "provider-api-key",
      "secret-assignment",
    ]);
    assert.notInclude(collectPublicStrings(violations).join("\n"), secret);
  });

  it("enumerates canonical GitHub token forms", () => {
    const text = [
      ["gh", "p_0123456789abcdefghijklmnopqrstuvwxyz"].join(""),
      ["github", "_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ"].join(""),
      ["gh", "o_abcdefghijklmnopqrstuvwxyz0123456789"].join(""),
    ].join(" ");

    assert.deepStrictEqual(
      findPublicTextViolations(text).map(({ kind }) => kind),
      ["github-token", "github-token", "github-token"],
    );
  });

  it("detects URI userinfo without treating ordinary URLs or email addresses as credentials", () => {
    assert.deepStrictEqual(
      findPublicTextViolations(["https://user", ":password@example.test/repo"].join("")),
      [{ kind: "uri-userinfo", index: 0 }],
    );
    assert.deepStrictEqual(
      findPublicTextViolations("See https://example.test/docs or email user@example.test."),
      [],
    );
  });

  it("detects complete and truncated private-key blocks", () => {
    const complete = [
      ["-----BEGIN OPENSSH", " PRIVATE KEY-----"].join(""),
      "c2VjcmV0LWtleS1tYXRlcmlhbA==",
      ["-----END OPENSSH", " PRIVATE KEY-----"].join(""),
    ].join("\n");
    const truncated = [
      "diagnostic prefix",
      ["-----BEGIN RSA", " PRIVATE KEY-----"].join(""),
      "c2VjcmV0LWtleS1tYXRlcmlhbA==",
    ].join("\n");

    assert.deepStrictEqual(
      findPublicTextViolations(complete).map(({ kind }) => kind),
      ["private-key"],
    );
    assert.deepStrictEqual(
      findPublicTextViolations(truncated).map(({ kind }) => kind),
      ["private-key"],
    );
  });

  it("detects POSIX, drive-letter, and UNC host-absolute paths", () => {
    const text = [
      "read /s",
      "rv/private/config.json C:",
      "\\Users\\alice\\.config\\token \\\\host\\share\\secret.txt",
    ].join("");
    assert.deepStrictEqual(
      findPublicTextViolations(text).map(({ kind }) => kind),
      ["host-absolute-path", "host-absolute-path", "host-absolute-path"],
    );
  });

  it("detects session cookies, AWS access-key IDs, and canonical file URIs", () => {
    const text = [
      "SESSION_COOKIE=opaque-session-value",
      "AWS_ACCESS_KEY_ID=opaque-access-key-id",
      "AKIA1234567890ABCDEF",
      "ASIA1234567890ABCDEF",
      "file:///srv/private/config.json",
    ].join("\n");

    assert.deepStrictEqual(
      findPublicTextViolations(text).map(({ kind }) => kind),
      [
        "secret-assignment",
        "secret-assignment",
        "provider-api-key",
        "provider-api-key",
        "host-absolute-path",
      ],
    );
  });

  it("allows nearby session, AWS, and file URI controls", () => {
    const text = [
      "SESSION_COOKIE=example-fixture",
      "AWS_ACCESS_KEY_ID=synthetic-fixture",
      "AWS_ACCESS_KEY_IDENTITY=ordinary",
      "sessionCount=3 and cookiePolicy=strict",
      "AKIA1234 and ASIA documentation are ordinary prose.",
      "file://example.test/public.txt and file:/relative.txt are public references.",
    ].join("\n");

    assert.deepStrictEqual(findPublicTextViolations(text), []);
  });

  it("detects auth headers, namespaced secrets, API keys, and JWTs", () => {
    const text = [
      ["Bea", "rer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature0123456789"].join(""),
      ["Bas", "ic dXNlcjpwYXNz"].join(""),
      ["Coo", "kie: session=abcdef0123456789"].join(""),
      ["AWS_SECRET", "_ACCESS_KEY=abcdef0123456789"].join(""),
      ["AI", "za0123456789abcdefghijklmnopqrstuv"].join(""),
    ].join("\n");
    const kinds = findPublicTextViolations(text).map(({ kind }) => kind);

    assert.includeMembers(kinds, [
      "bearer-credential",
      "basic-credential",
      "header-credential",
      "jwt",
      "provider-api-key",
      "secret-assignment",
    ]);
  });
  it("rejects a production credential with a synthetic-looking suffix", () => {
    const kinds = findPublicTextViolations("Authorization: opaque-production-secret=fixture").map(
      ({ kind }) => kind,
    );

    assert.includeMembers(kinds, ["header-credential"]);
  });

  it("rejects a cookie whose assigned value is not entirely synthetic", () => {
    const kinds = findPublicTextViolations("Cookie: session=opaque-production-secret=fixture").map(
      ({ kind }) => kind,
    );

    assert.includeMembers(kinds, ["header-credential"]);
  });

  it("allows negative prose and explicitly synthetic fixture values", () => {
    const text = [
      "tokenCount=3",
      "secret_sauce=recipe",
      "Basic documentation is public.",
      "Bearer test-token",
      "Authorization: Bearer synthetic-fixture",
      "Cookie: session=example-fixture",
      "cookie=example-fixture",
      "A 1/2 ratio and/or choice is ordinary prose.",
      "OPENAI_API_KEY=synthetic-fixture",
      "See https://example.test/docs.",
    ].join("\n");

    assert.deepStrictEqual(findPublicTextViolations(text), []);
    assert.deepStrictEqual(findPublicTextViolations("Look up the synthetic label amber."), []);
  });
  it("handles long trailing delimiters and Base64 input", () => {
    const syntheticHeader = `Authorization: Bearer synthetic-fixture${";".repeat(100_000)}`;
    const longBasic = `Basic ${btoa("x".repeat(74_999))}`;

    assert.deepStrictEqual(findPublicTextViolations(syntheticHeader), []);
    assert.deepStrictEqual(findPublicTextViolations(longBasic), []);
  });
});

describe("eval aggregate sanitization", () => {
  it.effect("accepts only the pinned provenance and four-dimension aggregate", () =>
    Effect.gen(function* () {
      const sanitized = yield* sanitizeEvalAggregate(aggregate, expected);
      assert.deepStrictEqual(sanitized, aggregate);
      assert.deepStrictEqual(Object.keys(sanitized.dimensions).sort(), [
        "arguments",
        "completion",
        "routing",
        "safety",
      ]);
      assert.isFalse(Object.hasOwn(sanitized, "scores"));
      assert.isFalse(Object.hasOwn(sanitized.dimensions, "skill"));
      assert.isFalse(Object.hasOwn(sanitized.dimensions, "performance"));
      assert.isFalse(Object.hasOwn(sanitized.dimensions, "answer"));
    }),
  );

  it.effect("rejects raw, credential, account, prompt, and private-host inputs", () =>
    Effect.gen(function* () {
      const forbidden: Readonly<Record<string, unknown>> = {
        tool_calls: [{ arguments: { secret: "not-for-publication" } }],
        credential: "not-a-credential",
        account: "private-account",
        address: "0x0000000000000000000000000000000000000001",
        prompt: "private prompt text",
        host: "service.internal",
      };
      for (const [field, value] of Object.entries(forbidden)) {
        const reasons = yield* failureReasons({ ...aggregate, [field]: value });
        assert.include(reasons.join("\n"), field);
      }
    }),
  );
  it.effect("rejects scanner bypasses before producing a sanitized aggregate", () =>
    Effect.gen(function* () {
      for (const [value, kind] of [
        ["SESSION_COOKIE=opaque-session-value", "secret-assignment"],
        ["AWS_ACCESS_KEY_ID=opaque-access-key-id", "secret-assignment"],
        ["ASIA1234567890ABCDEF", "provider-api-key"],
        ["file:///srv/private/config.json", "host-absolute-path"],
      ] as const) {
        const reasons = yield* failureReasons(
          { ...aggregate, suiteId: value },
          { ...expected, suiteId: value },
        );
        const serializedReasons = reasons.join("\n");
        assert.include(serializedReasons, kind);
        assert.notInclude(serializedReasons, value);
      }
    }),
  );

  it.effect("rejects inconsistent counts and distributions", () =>
    Effect.gen(function* () {
      const reasons = yield* failureReasons({
        ...aggregate,
        dimensions: {
          ...aggregate.dimensions,
          routing: { passed: 1, failed: 1 },
        },
        latencyMs: { p50: 2, p95: 1, max: 1 },
      });
      assert.include(reasons.join("\n"), "routing");
      assert.include(reasons.join("\n"), "latencyMs");
    }),
  );

  it.effect("rejects aggregate provenance that does not match caller-derived inputs", () =>
    Effect.gen(function* () {
      for (const [field, value] of [
        ["suiteId", "other-suite"],
        ["suiteVersion", 2],
        ["fixtureVersion", 2],
        ["catalogSha", "f".repeat(64)],
      ] as const) {
        const reasons = yield* failureReasons({ ...aggregate, [field]: value });
        assert.include(reasons.join("\n"), `aggregate.${field}`);
      }
    }),
  );

  it.effect("rejects secret-shaped suite and catalog identifiers without echoing values", () =>
    Effect.gen(function* () {
      const suiteSecret = ["gh", "p_0123456789abcdefghijklmnopqrstuvwxyz"].join("");
      const catalogSecret = ["github", "_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ"].join("");

      const suiteReasons = yield* failureReasons(
        { ...aggregate, suiteId: suiteSecret },
        { ...expected, suiteId: suiteSecret },
      );
      const catalogReasons = yield* failureReasons(
        { ...aggregate, catalogSha: catalogSecret },
        { ...expected, catalogSha: catalogSecret },
      );
      const serializedReasons = [...suiteReasons, ...catalogReasons].join("\n");

      assert.include(serializedReasons, "github-token");
      assert.notInclude(serializedReasons, suiteSecret);
      assert.notInclude(serializedReasons, catalogSecret);
    }),
  );
});
