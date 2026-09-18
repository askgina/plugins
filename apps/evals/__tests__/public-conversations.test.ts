import { describe, expect, test } from "vitest";
import {
  isPublicTranscript,
  isPublicTranscriptIndex,
  matchesConversationReference,
  publicTranscriptPath,
} from "../src/lib/public-transcript-schema";
import { verifyPublicTranscriptBytes } from "../src/lib/public-conversations";
import type { ConversationReference } from "../src/lib/conversations";

const reference: ConversationReference = {
  campaignId: "reasoning-sweep-2026-09-16",
  rowId: "sample-high",
  family: "spot",
  caseId: "spot-example",
  repetition: 1,
  sourceSummarySha256: "a".repeat(64),
  sourceCommit: "b".repeat(40),
  catalogSha: "c".repeat(64),
  target: "omp_harness",
};
const document = {
  schemaVersion: "ask-gina-public-conversation.v1",
  reference,
  conversation: {
    rowId: reference.rowId,
    family: reference.family,
    caseId: reference.caseId,
    repetition: 1,
    visibleEvidenceSource: "native",
    frozenUserTurns: [{ role: "user", content: "Read the market." }],
    visibleMessages: [
      { role: "assistant", sequence: 1, content: [{ type: "text", text: "Public answer" }] },
    ],
    completeness: {
      transcriptCaptureComplete: true,
      modelObservedTruncation: false,
      auxiliarySourceComplete: true,
      finalAnswerPresent: true,
      nativeVisibleEvidenceAvailable: true,
    },
    gaps: [],
    publication: {
      kind: "public_redacted",
      sourceConversationSha256: "d".repeat(64),
      redactions: { address: 1 },
    },
  },
};

describe("public conversations", () => {
  test("binds every provenance field and rejects traversal and older campaigns", () => {
    expect(publicTranscriptPath(reference)).toBe("sample-high/spot/1-spot-example.json");
    expect(publicTranscriptPath({ ...reference, rowId: "../private" })).toBeUndefined();
    expect(publicTranscriptPath({ ...reference, campaignId: "older-campaign" })).toBeUndefined();
    expect(matchesConversationReference({ left: reference, right: { ...reference } })).toBe(true);
    for (const key of Object.keys(reference) as (keyof ConversationReference)[])
      expect(
        matchesConversationReference({
          left: reference,
          right: { ...reference, [key]: key === "repetition" ? 2 : "different" },
        }),
      ).toBe(false);
  });
  test("allows only the public projection and consistent identities", () => {
    expect(isPublicTranscript(document)).toBe(true);
    expect(isPublicTranscript({ ...document, nativeSession: "private" })).toBe(false);
    expect(
      isPublicTranscript({
        ...document,
        conversation: { ...document.conversation, repetition: 2 },
      }),
    ).toBe(false);
    expect(
      isPublicTranscript({
        ...document,
        conversation: { ...document.conversation, forwardedMcpReceipts: [] },
      }),
    ).toBe(false);
    expect(
      isPublicTranscript({
        ...document,
        conversation: { ...document.conversation, publication: undefined },
      }),
    ).toBe(false);
  });
  test("rejects ambiguous or unsafe manifest entries", () => {
    const entry = { path: publicTranscriptPath(reference), sha256: "f".repeat(64), bytes: 123 };
    const index = {
      schemaVersion: "ask-gina-public-conversations.v1",
      campaignId: reference.campaignId,
      sourceManifestSha256: "a".repeat(64),
      exporterSha256: "b".repeat(64),
      redactions: {},
      conversationCount: 1,
      files: [entry],
    };
    expect(isPublicTranscriptIndex(index)).toBe(true);
    expect(isPublicTranscriptIndex({ ...index, conversationCount: 2, files: [entry, entry] })).toBe(
      false,
    );
    expect(
      isPublicTranscriptIndex({ ...index, files: [{ ...entry, path: "../../private.json" }] }),
    ).toBe(false);
  });
  test("checks the exact response bytes before parsing or rendering", () => {
    const bytes = new TextEncoder().encode('{"ok":true}').buffer;
    return crypto.subtle
      .digest("SHA-256", bytes)
      .then((hash) => {
        const sha = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(
          "",
        );
        return expect(verifyPublicTranscriptBytes(bytes, sha)).resolves.toEqual({ ok: true });
      })
      .then(() =>
        expect(verifyPublicTranscriptBytes(bytes, "0".repeat(64))).rejects.toThrow(
          "integrity mismatch",
        ),
      );
  });
});
