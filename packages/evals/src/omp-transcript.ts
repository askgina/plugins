import { Schema } from "effect";

import { findPublicTextViolations } from "./sanitize";

export const OMP_TRANSCRIPT_SCHEMA_VERSION = "omp-transcript.v1" as const;
export const OMP_TRANSCRIPT_MAX_MESSAGES = 512;
export const OMP_TRANSCRIPT_MAX_BYTES = 1_048_576;
export const OMP_TRANSCRIPT_MAX_FIELD_BYTES = 65_536;
export const OMP_TRANSCRIPT_REDACTION = "[redacted]";
export const OMP_TRANSCRIPT_OMITTED = "[omitted]";

const DELTA_BUFFER_SLACK_BYTES = OMP_TRANSCRIPT_MAX_FIELD_BYTES;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 4_096;
const MAX_LABEL_LENGTH = 256;
const MIN_SECRET_PREFIX_LENGTH = 3;
const BOUNDARY_WINDOW = 256;
const TRUNCATION_SUFFIX = "...[truncated]";
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PRIVATE_KEY_END = "-----END";
// Mirrors the private credential-key policy in sanitize.ts for JSON object keys.
const CREDENTIAL_KEY =
  /^(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|authorization|bearer|cookie|credential|password|private[_-]?key|secret(?:[_-]?key)?|session(?:[_-]?id)?|token(?:[_-]?id)?)$/i;

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();
const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });

const BoundedTextSchema = Schema.String.check(
  Schema.isMaxLength(OMP_TRANSCRIPT_MAX_FIELD_BYTES + TRUNCATION_SUFFIX.length + 64),
);
const BoundedLabelSchema = Schema.String.check(Schema.isMaxLength(MAX_LABEL_LENGTH));

export const OmpTranscriptTextMessageSchema = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  type: Schema.Literal("text"),
  text: BoundedTextSchema,
});

export const OmpTranscriptToolCallMessageSchema = Schema.Struct({
  role: Schema.Literal("assistant"),
  type: Schema.Literal("tool-call"),
  toolCallId: BoundedLabelSchema,
  toolName: Schema.NonEmptyString.check(Schema.isMaxLength(MAX_LABEL_LENGTH)),
  input: Schema.Json,
});

export const OmpTranscriptToolResultMessageSchema = Schema.Struct({
  role: Schema.Literal("tool"),
  type: Schema.Literal("tool-result"),
  toolCallId: BoundedLabelSchema,
  toolName: Schema.NonEmptyString.check(Schema.isMaxLength(MAX_LABEL_LENGTH)),
  output: Schema.Json,
  isError: Schema.Boolean,
});

export const OmpTranscriptMessageSchema = Schema.Union([
  OmpTranscriptTextMessageSchema,
  OmpTranscriptToolCallMessageSchema,
  OmpTranscriptToolResultMessageSchema,
]);

export const OmpTrialTranscriptStatusSchema = Schema.Literals([
  "completed",
  "failed",
  "blocked",
  "timeout",
  "interruption",
]);

export const OmpTrialTranscriptSchema = Schema.Struct({
  runId: Schema.NonEmptyString.check(Schema.isMaxLength(MAX_LABEL_LENGTH)),
  caseId: Schema.NonEmptyString.check(Schema.isMaxLength(MAX_LABEL_LENGTH)),
  repetition: Schema.Int.check(Schema.isGreaterThan(0)),
  model: Schema.NonEmptyString.check(Schema.isMaxLength(MAX_LABEL_LENGTH)),
  startedAt: Schema.NonEmptyString.check(Schema.isMaxLength(64), Schema.isPattern(UTC_TIMESTAMP)),
  status: OmpTrialTranscriptStatusSchema,
  messages: Schema.Array(OmpTranscriptMessageSchema).check(
    Schema.isMaxLength(OMP_TRANSCRIPT_MAX_MESSAGES),
  ),
  truncated: Schema.Boolean,
});

export type OmpTranscriptTextMessage = typeof OmpTranscriptTextMessageSchema.Type;
export type OmpTranscriptToolCallMessage = typeof OmpTranscriptToolCallMessageSchema.Type;
export type OmpTranscriptToolResultMessage = typeof OmpTranscriptToolResultMessageSchema.Type;
export type OmpTranscriptMessage = typeof OmpTranscriptMessageSchema.Type;
export type OmpTrialTranscriptStatus = typeof OmpTrialTranscriptStatusSchema.Type;
export type OmpTrialTranscript = typeof OmpTrialTranscriptSchema.Type;

export interface OmpTranscriptCollectorResult {
  readonly messages: readonly OmpTranscriptMessage[];
  readonly truncated: boolean;
}

export interface OmpTranscriptCollector {
  readonly user: (text: string) => void;
  readonly assistant: (delta: string) => void;
  readonly toolCall: (toolCallId: string, toolName: string, input: unknown) => void;
  readonly toolResult: (
    toolCallId: string,
    toolName: string,
    output: unknown,
    isError: boolean,
  ) => void;
  readonly finish: () => OmpTranscriptCollectorResult;
}

const omittedValue = (reason: string): string => `[omitted:${reason}]`;

const isPlainJsonObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Collects a private per-trial chat transcript from OMP harness stream events.
 *
 * Redaction runs on coalesced terminal text and on every JSON string value
 * before storage: explicit `secrets` first, then `findPublicTextViolations`
 * spans (excluding `host-absolute-path`, which is not a credential), then a
 * tail-prefix mask so a stream that dies mid-secret never persists a usable
 * fragment. Unsupported or oversized values become explicit `[omitted:*]`
 * placeholders and raise `truncated`; nothing is silently dropped.
 */
export const createOmpTranscriptCollector = (
  secrets: readonly string[],
): OmpTranscriptCollector => {
  const explicitSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
  const redactionMarker = explicitSecrets.some((secret) =>
    OMP_TRANSCRIPT_REDACTION.includes(secret),
  )
    ? ""
    : OMP_TRANSCRIPT_REDACTION;

  const messages: OmpTranscriptMessage[] = [];
  let bytesUsed = 2; // JSON array brackets; commas are charged when messages are added.
  let truncated = false;
  let sealed = false;
  let outputExhausted = false;
  let finished: OmpTranscriptCollectorResult | undefined;

  let pendingRole: "user" | "assistant" | null = null;
  let pendingParts: string[] = [];
  let pendingBytes = 0;
  let pendingDropped = false;

  const maskSecretTail = (text: string): string => {
    for (const secret of explicitSecrets) {
      const longest = Math.min(secret.length - 1, text.length);
      for (let prefix = longest; prefix >= MIN_SECRET_PREFIX_LENGTH; prefix -= 1) {
        if (text.endsWith(secret.slice(0, prefix))) {
          return text.slice(0, text.length - prefix) + redactionMarker;
        }
      }
    }
    return text;
  };

  const redactText = (input: string): string => {
    let text = input;
    for (const secret of explicitSecrets) {
      if (text.includes(secret)) text = text.split(secret).join(redactionMarker);
    }
    // Violations arrive sorted by start; a shorter assignment/header match on a
    // private-key BEGIN line must extend, not suppress, the overlapping block
    // span, so overlapping spans are unioned by their maximum end.
    const spans: Array<[number, number]> = [];
    for (const violation of findPublicTextViolations(text)) {
      if (violation.kind === "host-absolute-path") continue;
      const last = spans[spans.length - 1];
      if (last !== undefined && violation.index < last[1] && violation.kind !== "private-key")
        continue;
      let end: number;
      if (violation.kind === "private-key") {
        const marker = text.indexOf(PRIVATE_KEY_END, violation.index);
        const newline = marker === -1 ? -1 : text.indexOf("\n", marker);
        end = marker === -1 ? text.length : newline === -1 ? text.length : newline;
      } else {
        const newline = text.indexOf("\n", violation.index);
        end = newline === -1 ? text.length : newline;
      }
      if (last !== undefined && violation.index < last[1]) {
        if (end > last[1]) last[1] = end;
        continue;
      }
      spans.push([violation.index, end]);
    }
    if (spans.length > 0) {
      let redacted = "";
      let cursor = 0;
      for (const [start, end] of spans) {
        redacted += text.slice(cursor, start) + redactionMarker;
        cursor = end;
      }
      text = redacted + text.slice(cursor);
    }
    return maskSecretTail(text);
  };

  // Input must already be redacted; a byte cut can only expose a fragment when
  // the source text was itself truncated, so the cut retreats to whitespace and
  // a single oversized token is dropped whole rather than persisted as a prefix.
  const capText = (redacted: string): string => {
    const bytes = UTF8.encode(redacted);
    if (bytes.byteLength <= OMP_TRANSCRIPT_MAX_FIELD_BYTES) return redacted;
    truncated = true;
    let kept = UTF8_DECODER.decode(bytes.slice(0, OMP_TRANSCRIPT_MAX_FIELD_BYTES));
    let boundary = -1;
    for (
      let index = kept.length - 1;
      index >= Math.max(0, kept.length - BOUNDARY_WINDOW);
      index -= 1
    ) {
      if (/\s/u.test(kept[index])) {
        boundary = index;
        break;
      }
    }
    if (boundary === -1) return omittedValue("too-large");
    kept = maskSecretTail(kept.slice(0, boundary));
    return kept + TRUNCATION_SUFFIX;
  };

  const capLabel = (value: string): string => {
    if (value.length > MAX_LABEL_LENGTH) {
      truncated = true;
      return omittedValue("too-large");
    }
    // Redaction can expand a label (a short secret becomes the longer marker),
    // so the bound is enforced again on the redacted text.
    const redacted = redactText(value);
    if (redacted.length > MAX_LABEL_LENGTH) {
      truncated = true;
      return omittedValue("too-large");
    }
    return redacted;
  };

  const sanitizeJson = (value: unknown): Schema.Json => {
    let nodes = 0;
    let traversalBytes = 0;
    let traversalBudgetExceeded = false;
    const chargeText = (text: string): boolean => {
      const remaining = OMP_TRANSCRIPT_MAX_FIELD_BYTES - traversalBytes;
      if (text.length > remaining) {
        traversalBudgetExceeded = true;
        truncated = true;
        return false;
      }
      const size = UTF8.encode(text).byteLength;
      if (size > remaining) {
        traversalBudgetExceeded = true;
        truncated = true;
        return false;
      }
      traversalBytes += size;
      return true;
    };
    const visit = (current: unknown, depth: number, seen: Set<object>): Schema.Json => {
      nodes += 1;
      if (nodes > MAX_JSON_NODES) {
        truncated = true;
        return omittedValue("too-large");
      }
      if (current === null) return null;
      switch (typeof current) {
        case "string":
          return chargeText(current) ? redactText(current) : omittedValue("too-large");
        case "number":
          if (Number.isFinite(current)) return current;
          truncated = true;
          return omittedValue("non-finite-number");
        case "boolean":
          return current;
        case "object": {
          if (seen.has(current)) {
            truncated = true;
            return omittedValue("circular-reference");
          }
          if (depth >= MAX_JSON_DEPTH) {
            truncated = true;
            return omittedValue("too-deep");
          }
          if (Array.isArray(current)) {
            seen.add(current);
            const items: Schema.Json[] = [];
            for (const item of current) {
              if (nodes >= MAX_JSON_NODES) {
                truncated = true;
                items.push(omittedValue("too-large"));
                break;
              }
              const safeItem = visit(item, depth + 1, seen);
              if (traversalBudgetExceeded) break;
              items.push(safeItem);
            }
            seen.delete(current);
            return items;
          }
          if (!isPlainJsonObject(current)) {
            truncated = true;
            return omittedValue("unsupported-type");
          }
          seen.add(current);
          const record: Record<string, Schema.Json> = {};
          for (const key in current) {
            if (!Object.hasOwn(current, key)) continue;
            if (nodes >= MAX_JSON_NODES) {
              truncated = true;
              record[omittedValue("too-large")] = OMP_TRANSCRIPT_OMITTED;
              break;
            }
            if (!chargeText(key)) break;
            const safeKey = redactText(key);
            if (Object.hasOwn(record, safeKey)) {
              truncated = true;
              continue;
            }
            let safeValue: Schema.Json = redactionMarker;
            if (!CREDENTIAL_KEY.test(key)) {
              try {
                safeValue = visit(current[key], depth + 1, seen);
              } catch {
                truncated = true;
                safeValue = omittedValue("unsupported-type");
              }
            }
            if (traversalBudgetExceeded) break;
            Object.defineProperty(record, safeKey, {
              configurable: true,
              enumerable: true,
              value: safeValue,
              writable: true,
            });
          }
          seen.delete(current);
          return record;
        }
        default:
          truncated = true;
          return omittedValue("unsupported-type");
      }
    };
    try {
      const sanitized = visit(value, 0, new Set());
      if (traversalBudgetExceeded) return omittedValue("too-large");
      if (UTF8.encode(JSON.stringify(sanitized)).byteLength > OMP_TRANSCRIPT_MAX_FIELD_BYTES) {
        truncated = true;
        return omittedValue("too-large");
      }
      return sanitized;
    } catch {
      truncated = true;
      return omittedValue("unsupported-type");
    }
  };

  const canAcceptMessage = (): boolean => {
    if (outputExhausted) return false;
    if (messages.length >= OMP_TRANSCRIPT_MAX_MESSAGES || bytesUsed >= OMP_TRANSCRIPT_MAX_BYTES) {
      truncated = true;
      outputExhausted = true;
      return false;
    }
    return true;
  };

  const pushMessage = (message: OmpTranscriptMessage): void => {
    if (!canAcceptMessage()) return;
    const size = UTF8.encode(JSON.stringify(message)).byteLength;
    const separator = messages.length === 0 ? 0 : 1;
    if (bytesUsed + separator + size > OMP_TRANSCRIPT_MAX_BYTES) {
      truncated = true;
      outputExhausted = true;
      return;
    }
    messages.push(message);
    bytesUsed += separator + size;
  };

  const flushPending = (): void => {
    if (pendingRole === null) return;
    const role = pendingRole;
    const parts = pendingParts;
    pendingRole = null;
    pendingParts = [];
    pendingBytes = 0;
    if (pendingDropped) {
      pendingDropped = false;
      truncated = true;
    }
    const text = parts.join("");
    if (text.length === 0) return;
    pushMessage({ role, type: "text", text: capText(redactText(text)) });
  };

  const appendText = (role: "user" | "assistant", text: string): void => {
    if (sealed || typeof text !== "string" || text.length === 0) return;
    if (pendingRole !== null && pendingRole !== role) flushPending();
    if (!canAcceptMessage()) return;
    pendingRole = role;
    const remaining = OMP_TRANSCRIPT_MAX_FIELD_BYTES + DELTA_BUFFER_SLACK_BYTES - pendingBytes;
    if (remaining <= 0) {
      pendingDropped = true;
      return;
    }
    const candidate = text.slice(0, Math.min(text.length, remaining + 1));
    const bytes = UTF8.encode(candidate);
    if (bytes.byteLength <= remaining) {
      pendingParts.push(candidate);
      pendingBytes += bytes.byteLength;
      if (candidate.length < text.length) pendingDropped = true;
      return;
    }
    let end = remaining;
    while (end > 0) {
      try {
        const prefix = UTF8_FATAL_DECODER.decode(bytes.slice(0, end));
        if (prefix.length > 0) {
          pendingParts.push(prefix);
          pendingBytes += end;
        }
        break;
      } catch {
        end -= 1;
      }
    }
    pendingDropped = true;
  };

  return {
    user: (text) => appendText("user", text),
    assistant: (delta) => appendText("assistant", delta),
    toolCall: (toolCallId, toolName, input) => {
      if (sealed) return;
      flushPending();
      if (!canAcceptMessage()) return;
      pushMessage({
        role: "assistant",
        type: "tool-call",
        toolCallId: capLabel(toolCallId),
        toolName: capLabel(toolName) || OMP_TRANSCRIPT_OMITTED,
        input: sanitizeJson(input),
      });
    },
    toolResult: (toolCallId, toolName, output, isError) => {
      if (sealed) return;
      flushPending();
      if (!canAcceptMessage()) return;
      pushMessage({
        role: "tool",
        type: "tool-result",
        toolCallId: capLabel(toolCallId),
        toolName: capLabel(toolName) || OMP_TRANSCRIPT_OMITTED,
        output: sanitizeJson(output),
        isError: isError === true,
      });
    },
    finish: () => {
      if (finished !== undefined) return finished;
      flushPending();
      sealed = true;
      finished = { messages: Object.freeze(messages.slice()), truncated };
      return finished;
    },
  };
};
