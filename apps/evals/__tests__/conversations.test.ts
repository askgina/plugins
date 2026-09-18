import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canonicalRuns } from "../src/canonical/canonical";
import { ConversationView } from "../src/components/conversation-panel";
import { conversationNotices, conversationUrl, type Conversation } from "../src/lib/conversations";

const conversation: Conversation = {
  rowId: "sample-high",
  family: "spot",
  caseId: "spot-test",
  repetition: 1,
  visibleEvidenceSource: "native",
  frozenUserTurns: [{ role: "user", content: "<script>private input</script>" }],
  visibleMessages: [
    {
      role: "assistant",
      sequence: 1,
      content: [{ type: "toolCall", id: "call-1", name: "spot.read", arguments: { limit: 1 } }],
    },
    {
      role: "tool",
      sequence: 2,
      content: [
        {
          type: "toolResult",
          toolCallId: "call-1",
          text: "<img src=https://example.com/private>",
          isError: true,
        },
      ],
    },
    { role: "assistant", sequence: 3, content: [{ type: "text", text: "Retained answer" }] },
  ],
  completeness: {
    transcriptCaptureComplete: false,
    modelObservedTruncation: true,
    auxiliarySourceComplete: false,
    finalAnswerPresent: false,
    nativeVisibleEvidenceAvailable: true,
  },
  gaps: [{ code: "native-tool-result-truncated", scope: "model-observed-truncation" }],
};

describe("attempt conversations", () => {
  test("binds all sweep attempts uniquely without attaching transcripts to older runs", () => {
    const refs = canonicalRuns.flatMap((run) => {
      if (run.attempts.availability !== "available") return [];
      return run.attempts.value.flatMap((attempt) => {
        if (run.campaignId !== "reasoning-sweep-2026-09-16") {
          expect(attempt.conversation).toBeUndefined();
          return [];
        }
        expect(attempt.conversation).toMatchObject({
          caseId: attempt.caseId,
          repetition: attempt.repetition,
          campaignId: run.campaignId,
          sourceSummarySha256: run.provenance.sourceArtifactSha256,
        });
        return [conversationUrl(attempt.conversation!)];
      });
    });
    expect(refs).toHaveLength(3675);
    expect(new Set(refs).size).toBe(3675);
  });

  test("shows capture limitations separately and escapes retained text", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationView, { conversation, sha256: "a".repeat(64) }),
    );
    expect(html).toContain("Partial transcript.");
    expect(html).toContain("Capture completeness is separate from grading.");
    expect(html).toContain("No final answer was retained.");
    expect(html).toContain("Tool result: <code>spot.read</code> (error)");
    expect(html).toContain("&lt;script&gt;private input&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("Retained answer");
    expect(conversationNotices(conversation)).toHaveLength(4);
  });

  test("shows missing messages and fallback evidence without implying a complete native chat", () => {
    const empty = {
      ...conversation,
      visibleMessages: [],
      completeness: { ...conversation.completeness, nativeVisibleEvidenceAvailable: false },
    };
    const html = renderToStaticMarkup(
      createElement(ConversationView, { conversation: empty, sha256: "a".repeat(64) }),
    );
    expect(html).toContain("No conversation messages were retained");
    expect(html).toContain("native conversation is unavailable");
    expect(html).toContain("Recorded task input");
  });
});
