import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  createOmpTranscriptCollector,
  OMP_TRANSCRIPT_MAX_BYTES,
  OMP_TRANSCRIPT_MAX_FIELD_BYTES,
  OMP_TRANSCRIPT_MAX_MESSAGES,
  OMP_TRANSCRIPT_REDACTION,
  OmpTranscriptToolCallMessageSchema,
  OmpTrialTranscriptSchema,
} from "../src/omp-transcript";

describe("OMP private transcript collection", () => {
  it("coalesces text deltas while preserving chronological tool events", () => {
    const collector = createOmpTranscriptCollector([]);

    collector.user("Find ");
    collector.user("the market");
    collector.assistant("I will ");
    collector.assistant("look it up.");
    collector.toolCall("call-1", "searchMarkets", { query: "weather" });
    collector.toolResult("call-1", "searchMarkets", { markets: ["rain"] }, false);
    collector.assistant("One market matched.");

    assert.deepStrictEqual(collector.finish().messages, [
      { role: "user", type: "text", text: "Find the market" },
      { role: "assistant", type: "text", text: "I will look it up." },
      {
        role: "assistant",
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "searchMarkets",
        input: { query: "weather" },
      },
      {
        role: "tool",
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "searchMarkets",
        output: { markets: ["rain"] },
        isError: false,
      },
      { role: "assistant", type: "text", text: "One market matched." },
    ]);
  });

  it("redacts secrets split across deltas and incomplete terminal prefixes", () => {
    const secret = ["sk", "-live-abcdef0123456789abcdef0123456789"].join("");
    const collector = createOmpTranscriptCollector([secret]);
    collector.assistant(`full=${secret.slice(0, 13)}`);
    collector.assistant(`${secret.slice(13)} done`);

    const complete = collector.finish().messages[0];
    assert.strictEqual(complete?.type, "text");
    if (complete?.type !== "text") return;
    assert.strictEqual(complete.text.includes(secret), false);
    assert.strictEqual(complete.text.includes(OMP_TRANSCRIPT_REDACTION), true);

    const interrupted = createOmpTranscriptCollector([secret]);
    const terminalPrefix = secret.slice(0, 17);
    interrupted.assistant(`partial=${terminalPrefix}`);
    const partial = interrupted.finish().messages[0];
    assert.strictEqual(partial?.type, "text");
    if (partial?.type !== "text") return;
    assert.strictEqual(partial.text.includes(terminalPrefix), false);
    assert.strictEqual(partial.text.endsWith(OMP_TRANSCRIPT_REDACTION), true);

    const shortSecret = "a";
    const short = createOmpTranscriptCollector([shortSecret]);
    short.user(shortSecret);
    const shortMessage = short.finish().messages[0];
    assert.strictEqual(shortMessage?.type, "text");
    if (shortMessage?.type !== "text") return;
    assert.strictEqual(shortMessage.text.includes(shortSecret), false);
  });

  it("unions assignment and header spans with complete or truncated private-key blocks", () => {
    const genericBody = "GENERIC_KEY_BODY_SHOULD_NOT_SURVIVE";
    const openSshBody = "OPENSSH_KEY_BODY_SHOULD_NOT_SURVIVE";
    const truncatedBody = "TRUNCATED_KEY_BODY_SHOULD_NOT_SURVIVE";
    const openSshHeader = ["-----BEGIN OPENSSH", " PRIVATE KEY-----"].join("");
    const collector = createOmpTranscriptCollector([]);

    collector.assistant("safe text before\nPRIVATE_KEY=-----BEGIN PRIVATE");
    collector.assistant(` KEY-----\n${genericBody}\n-----END PRIVATE KEY-----\nsafe text after`);
    collector.toolResult(
      "call-key",
      "inspect",
      {
        complete:
          `safe JSON before\nAuthorization: ${openSshHeader}\n` +
          `${openSshBody}\n-----END OPENSSH PRIVATE KEY-----\nsafe JSON after`,
        truncated: `safe truncated prefix\nOPENSSH_PRIVATE_KEY=${openSshHeader}\n` + truncatedBody,
      },
      false,
    );

    const result = collector.finish();
    assert.deepStrictEqual(result.messages, [
      {
        role: "assistant",
        type: "text",
        text: `safe text before\n${OMP_TRANSCRIPT_REDACTION}\nsafe text after`,
      },
      {
        role: "tool",
        type: "tool-result",
        toolCallId: "call-key",
        toolName: "inspect",
        output: {
          complete: `safe JSON before\n${OMP_TRANSCRIPT_REDACTION}\nsafe JSON after`,
          truncated: `safe truncated prefix\n${OMP_TRANSCRIPT_REDACTION}`,
        },
        isError: false,
      },
    ]);
    const encoded = JSON.stringify(result.messages);
    assert.strictEqual(encoded.includes(genericBody), false);
    assert.strictEqual(encoded.includes(openSshBody), false);
    assert.strictEqual(encoded.includes(truncatedBody), false);
  });

  it("redacts a split secret at the text cap without breaking UTF-8", () => {
    const secret = "secret-value-abcdef0123456789abcdef0123456789";
    const split = Math.floor(secret.length / 2);
    const collector = createOmpTranscriptCollector([secret]);
    const prefix = "safe ".repeat(Math.ceil((OMP_TRANSCRIPT_MAX_FIELD_BYTES - split) / 5));
    collector.assistant(prefix + secret.slice(0, split));
    collector.assistant(secret.slice(split) + " trailing words ".repeat(64));

    const result = collector.finish();
    const message = result.messages[0];
    assert.strictEqual(message?.type, "text");
    if (message?.type !== "text") return;
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(message.text.includes(secret), false);
    assert.strictEqual(message.text.includes(secret.slice(0, split)), false);
    assert.strictEqual(message.text.includes(OMP_TRANSCRIPT_REDACTION), true);
    assert.strictEqual(message.text.includes("�"), false);
  });

  it("keeps JSON arguments and results as cloned redacted snapshots", () => {
    const token = ["gh", "p_abcdefghijklmnopqrstuvwxyz0123456789"].join("");
    const input = {
      path: "/private/worktree/input.json",
      nested: { api_key: "caller-owned-secret", keep: [1, "two"] },
    };
    const output = {
      note: `provider returned ${token}`,
      authorization: ["Bearer", "caller-owned-secret"].join(" "),
      rows: [{ value: 3 }],
    };
    const collector = createOmpTranscriptCollector([]);
    collector.toolCall("call-2", "query", input);
    collector.toolResult("call-2", "query", output, true);

    input.nested.api_key = "mutated";
    input.nested.keep.push(9);
    output.note = "mutated";
    output.rows[0].value = 99;

    const result = collector.finish();
    assert.deepStrictEqual(result.messages, [
      {
        role: "assistant",
        type: "tool-call",
        toolCallId: "call-2",
        toolName: "query",
        input: {
          path: "/private/worktree/input.json",
          nested: { api_key: OMP_TRANSCRIPT_REDACTION, keep: [1, "two"] },
        },
      },
      {
        role: "tool",
        type: "tool-result",
        toolCallId: "call-2",
        toolName: "query",
        output: {
          note: `provider returned ${OMP_TRANSCRIPT_REDACTION}`,
          authorization: OMP_TRANSCRIPT_REDACTION,
          rows: [{ value: 3 }],
        },
        isError: true,
      },
    ]);
    const encoded = JSON.stringify(result.messages);
    assert.strictEqual(encoded.includes(token), false);
    assert.strictEqual(encoded.includes("caller-owned-secret"), false);
    assert.strictEqual(encoded.includes("/private/worktree/input.json"), true);
  });

  it("replaces unsupported and oversized JSON without retaining SDK objects", () => {
    const circular: Record<string, unknown> = { value: 1 };
    circular.self = circular;
    const collector = createOmpTranscriptCollector([]);
    collector.toolCall("call-3", "unsafe", {
      circular,
      bigint: 12n,
      callback: () => "raw",
      instance: /sdk-object/u,
      huge: "x".repeat(OMP_TRANSCRIPT_MAX_FIELD_BYTES + 1),
    });

    const result = collector.finish();
    const call = result.messages[0];
    assert.strictEqual(call?.type, "tool-call");
    if (call?.type !== "tool-call") return;
    assert.strictEqual(result.truncated, true);
    const encoded = JSON.stringify(call.input);
    assert.strictEqual(encoded.includes("[omitted:"), true);
    assert.strictEqual(encoded.includes("raw"), false);
    assert.strictEqual(encoded.includes("x".repeat(256)), false);
  });

  it("stops traversing JSON as soon as its cumulative text budget is exhausted", () => {
    const chunk = "x".repeat(Math.floor(OMP_TRANSCRIPT_MAX_FIELD_BYTES * 0.6));
    let readAfterBudget = false;
    const input: Record<string, unknown> = { first: chunk, second: chunk };
    Object.defineProperty(input, "afterBudget", {
      enumerable: true,
      get: () => {
        readAfterBudget = true;
        return "must not be read";
      },
    });
    const collector = createOmpTranscriptCollector([]);
    collector.toolCall("call-budget", "query", input);

    const result = collector.finish();
    assert.strictEqual(readAfterBudget, false);
    assert.strictEqual(result.truncated, true);
    const call = result.messages[0];
    assert.strictEqual(call?.type, "tool-call");
    if (call?.type !== "tool-call") return;
    assert.strictEqual(typeof call.input, "string");
    assert.strictEqual(String(call.input).length < 64, true);
  });

  it("seals immutable snapshots against late deltas and caller mutation", () => {
    const input = { nested: { value: 1 } };
    const collector = createOmpTranscriptCollector([]);
    collector.toolCall("call-4", "read", input);
    const first = collector.finish();

    input.nested.value = 2;
    collector.assistant("late text");
    collector.toolResult("call-4", "read", { value: 2 }, false);
    const second = collector.finish();

    assert.strictEqual(first, second);
    assert.deepStrictEqual(second.messages, [
      {
        role: "assistant",
        type: "tool-call",
        toolCallId: "call-4",
        toolName: "read",
        input: { nested: { value: 1 } },
      },
    ]);
    assert.strictEqual(Object.isFrozen(second.messages), true);
  });

  it("bounds entry count and encoded UTF-8 output", () => {
    const entries = createOmpTranscriptCollector([]);
    for (let index = 0; index < OMP_TRANSCRIPT_MAX_MESSAGES + 20; index += 1) {
      if (index % 2 === 0) entries.user(`u${index}`);
      else entries.assistant(`a${index}`);
    }
    let readAfterCapacity = false;
    const ignoredPayload: Record<string, unknown> = {};
    Object.defineProperty(ignoredPayload, "value", {
      enumerable: true,
      get: () => {
        readAfterCapacity = true;
        return "must not be read";
      },
    });
    entries.toolCall("ignored", "ignored", ignoredPayload);
    assert.strictEqual(readAfterCapacity, false);
    const cappedEntries = entries.finish();
    assert.strictEqual(cappedEntries.messages.length, OMP_TRANSCRIPT_MAX_MESSAGES);
    assert.strictEqual(cappedEntries.truncated, true);

    const bytes = createOmpTranscriptCollector([]);
    for (let index = 0; index < 40; index += 1) {
      bytes.toolResult(
        `call-${index}`,
        "bulk",
        {
          value: `${index}:` + "🦉 ".repeat(8_000),
        },
        false,
      );
    }
    let readAfterByteCapacity = false;
    const ignoredBytePayload: Record<string, unknown> = {};
    Object.defineProperty(ignoredBytePayload, "value", {
      enumerable: true,
      get: () => {
        readAfterByteCapacity = true;
        return "must not be read";
      },
    });
    bytes.toolResult("ignored", "bulk", ignoredBytePayload, false);
    assert.strictEqual(readAfterByteCapacity, false);
    const cappedBytes = bytes.finish();
    assert.strictEqual(cappedBytes.truncated, true);
    assert.strictEqual(
      new TextEncoder().encode(JSON.stringify(cappedBytes.messages)).byteLength <=
        OMP_TRANSCRIPT_MAX_BYTES,
      true,
    );
    assert.strictEqual(JSON.stringify(cappedBytes.messages).includes("�"), false);
  });

  it("bounds labels after redaction expansion and validates the stored message", () => {
    const collector = createOmpTranscriptCollector(["x"]);
    collector.toolCall("call-label", "x".repeat(256), { ok: true });

    const result = collector.finish();
    const message = result.messages[0];
    assert.strictEqual(result.truncated, true);
    assert.deepStrictEqual(message, {
      role: "assistant",
      type: "tool-call",
      toolCallId: "call-label",
      toolName: "[omitted:too-large]",
      input: { ok: true },
    });
    const decoded = Effect.runSync(
      Schema.decodeUnknownEffect(OmpTranscriptToolCallMessageSchema, {
        onExcessProperty: "error",
      })(message),
    );
    assert.deepStrictEqual(decoded, message);
  });

  it("decodes a collected transcript through the shared Effect schema", () => {
    const collector = createOmpTranscriptCollector([]);
    collector.user("hello");
    const collected = collector.finish();
    const transcript = {
      runId: "run-1",
      caseId: "case-1",
      repetition: 1,
      model: "provider/model",
      startedAt: "2026-09-11T12:00:00.000Z",
      status: "completed",
      messages: collected.messages,
      truncated: collected.truncated,
    };

    const decoded = Effect.runSync(
      Schema.decodeUnknownEffect(OmpTrialTranscriptSchema, { onExcessProperty: "error" })(
        transcript,
      ),
    );
    assert.deepStrictEqual(decoded, transcript);
  });

  it("drops a single oversized text token instead of preserving a prefix", () => {
    const collector = createOmpTranscriptCollector([]);
    collector.assistant("x".repeat(OMP_TRANSCRIPT_MAX_FIELD_BYTES * 3));

    const result = collector.finish();
    assert.deepStrictEqual(result.messages, [
      { role: "assistant", type: "text", text: "[omitted:too-large]" },
    ]);
    assert.strictEqual(result.truncated, true);
  });
});
