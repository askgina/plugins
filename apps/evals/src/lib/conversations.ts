/** Identifies retained evidence without embedding any private text or local paths. */
export interface ConversationReference {
  readonly campaignId: string;
  readonly rowId: string;
  readonly family: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly sourceSummarySha256: string;
  readonly sourceCommit: string;
  readonly catalogSha: string;
  readonly target: string;
}

export interface ConversationBlock {
  readonly type: "text" | "toolCall" | "toolResult";
  readonly text?: string;
  readonly name?: string;
  readonly id?: string;
  readonly call_id?: string;
  readonly arguments?: unknown;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
}

export interface ConversationMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly sequence: number;
  readonly content: readonly ConversationBlock[];
}

export interface Conversation {
  readonly rowId: string;
  readonly family: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly visibleEvidenceSource: string;
  readonly frozenUserTurns: readonly { readonly role: string; readonly content: string }[];
  readonly visibleMessages: readonly ConversationMessage[];
  readonly completeness: {
    readonly transcriptCaptureComplete: boolean;
    readonly modelObservedTruncation: boolean;
    readonly auxiliarySourceComplete: boolean;
    readonly finalAnswerPresent: boolean;
    readonly nativeVisibleEvidenceAvailable: boolean;
  };
  readonly publication?: {
    readonly kind: "public_redacted";
    readonly sourceConversationSha256: string;
    readonly redactions: Readonly<Record<string, number>>;
  };
  readonly gaps: readonly { readonly code: string; readonly scope: string }[];
}

export type ConversationResponse =
  | { readonly status: "available"; readonly conversation: Conversation; readonly sha256: string }
  | {
      readonly status: "unavailable";
      readonly reason: "not_configured" | "not_found" | "mismatch" | "invalid_bundle" | "forbidden";
    };

export const CONVERSATION_ENDPOINT = "/__evals/conversation";

export function conversationUrl(reference: ConversationReference): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(reference)) params.set(key, String(value));
  return `${CONVERSATION_ENDPOINT}?${params}`;
}

export function conversationNotices(conversation: Conversation): readonly string[] {
  const { completeness } = conversation;
  return [
    ...(!completeness.transcriptCaptureComplete
      ? ["Capture gaps: some messages or tool results were not retained."]
      : []),
    ...(completeness.modelObservedTruncation
      ? ["Some tool output was already truncated when the model received it."]
      : []),
    ...(!completeness.auxiliarySourceComplete
      ? ["Some supporting files or tool receipts are unavailable."]
      : []),
    ...(!completeness.finalAnswerPresent ? ["No final answer was retained."] : []),
    ...(!completeness.nativeVisibleEvidenceAvailable
      ? ["The native conversation is unavailable. Showing the retained fallback evidence."]
      : []),
  ];
}
