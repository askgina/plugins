import { useEffect, useState } from "react";
import {
  conversationNotices,
  conversationUrl,
  type Conversation,
  type ConversationBlock,
  type ConversationReference,
  type ConversationResponse,
} from "../lib/conversations";
import { Button } from "./ui/button";
import "../styles/conversation.css";

const unavailableText = {
  not_configured:
    "Local conversations are not connected. Set EVAL_TRANSCRIPTS_DIR to the private evidence bundle and restart the evals server.",
  not_found: "No retained conversation was found for this attempt in the connected bundle.",
  mismatch:
    "This conversation could not be verified against the selected attempt. Check that the evidence bundle matches these results.",
  invalid_bundle:
    "The evidence bundle could not be read or verified. Check the local bundle, then retry.",
  forbidden: "Private conversations are available only from the local evals server.",
};

function TranscriptText({ text }: { text: string }) {
  if (text.length <= 1600) return <pre className="conversation-text">{text}</pre>;
  return (
    <details className="conversation-output">
      <summary>Show message ({text.length.toLocaleString()} characters)</summary>
      <pre className="conversation-text">{text}</pre>
    </details>
  );
}

function ContentBlock({
  block,
  toolNames,
}: {
  block: ConversationBlock;
  toolNames: ReadonlyMap<string, string>;
}) {
  if (block.type === "text") return block.text ? <TranscriptText text={block.text} /> : null;
  if (block.type === "toolCall") {
    return (
      <details className="conversation-output">
        <summary>
          Tool call: <code>{block.name}</code>
        </summary>
        <p className="conversation-label">Arguments</p>
        <pre className="conversation-text">
          {typeof block.arguments === "string"
            ? block.arguments
            : JSON.stringify(block.arguments, null, 2)}
        </pre>
      </details>
    );
  }
  const name = block.toolName ?? (block.toolCallId ? toolNames.get(block.toolCallId) : undefined);
  return (
    <details className="conversation-output">
      <summary>
        Tool result
        {name ? (
          <>
            : <code>{name}</code>
          </>
        ) : (
          ""
        )}
        {block.isError ? " (error)" : ""}
      </summary>
      <pre className="conversation-text">{block.text}</pre>
    </details>
  );
}

export function ConversationView({
  conversation,
  sha256,
}: {
  conversation: Conversation;
  sha256: string;
}) {
  const notices = conversationNotices(conversation);
  const toolNames = new Map<string, string>();
  for (const message of conversation.visibleMessages) {
    for (const block of message.content) {
      if (block.type !== "toolCall" || !block.name) continue;
      if (block.id) toolNames.set(block.id, block.name);
      if (block.call_id) toolNames.set(block.call_id, block.name);
    }
  }
  return (
    <div className="conversation-view">
      <p className="conversation-label">
        {conversation.visibleMessages.length} recorded messages · {conversation.rowId} · Attempt{" "}
        {conversation.repetition}
      </p>
      <p className="conversation-label">
        {conversation.completeness.transcriptCaptureComplete
          ? "Transcript capture complete."
          : "Partial transcript."}{" "}
        Capture completeness is separate from grading.
      </p>
      {notices.length > 0 && (
        <ul className="conversation-notices">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
      <details
        className="conversation-output"
        open={!conversation.visibleMessages.some((message) => message.role === "user")}
      >
        <summary>Recorded task input</summary>
        {conversation.frozenUserTurns.map((turn, index) => (
          <TranscriptText key={index} text={turn.content} />
        ))}
      </details>
      {conversation.visibleMessages.length === 0 ? (
        <p>No conversation messages were retained for this attempt.</p>
      ) : (
        <ol className="conversation-messages" aria-label="Recorded conversation">
          {conversation.visibleMessages.map((message, index) => (
            <li key={`${message.sequence}-${index}`} className="conversation-message">
              <p className="conversation-speaker">
                <span>
                  {message.role === "user"
                    ? "User"
                    : message.role === "assistant"
                      ? "Assistant"
                      : "Tool"}
                </span>
                <span className="conversation-label">{index + 1}</span>
              </p>
              {message.content.map((block, blockIndex) => (
                <ContentBlock key={blockIndex} block={block} toolNames={toolNames} />
              ))}
            </li>
          ))}
        </ol>
      )}
      <details className="conversation-output">
        <summary>Capture details</summary>
        <p>Source: {conversation.visibleEvidenceSource}</p>
        <p>
          Verified SHA-256: <code className="conversation-hash">{sha256}</code>
        </p>
        {conversation.gaps.length > 0 && (
          <ul>
            {conversation.gaps.map((gap, index) => (
              <li key={index}>
                {gap.code} ({gap.scope})
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

type LoadState = { readonly status: "loading" | "error" } | ConversationResponse;

function LoadedConversation({ reference }: { reference: ConversationReference }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const url = conversationUrl(reference);
  useEffect(() => {
    const controller = new AbortController();
    void window
      .fetch(url, { signal: controller.signal, cache: "no-store", credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("Conversation request failed");
        return response.json() as Promise<ConversationResponse>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [url, retry]);
  if (state.status === "loading")
    return (
      <p role="status" className="conversation-loading">
        Loading conversation…
      </p>
    );
  if (state.status === "available")
    return <ConversationView conversation={state.conversation} sha256={state.sha256} />;
  return (
    <div>
      <p role="status">
        {state.status === "unavailable"
          ? unavailableText[state.reason]
          : "Could not load this conversation. Check that the local evals server is running, then retry."}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setState({ status: "loading" });
          setRetry((value) => value + 1);
        }}
      >
        Retry conversation
      </Button>
    </div>
  );
}

export function ConversationPanel({ reference }: { reference?: ConversationReference }) {
  const [open, setOpen] = useState(false);
  if (!reference)
    return (
      <p className="conversation-label">A retained conversation is not linked to this attempt.</p>
    );
  if (!import.meta.env.DEV)
    return (
      <p className="conversation-label">
        Private conversation evidence is available in the local evals viewer.
      </p>
    );
  return (
    <details
      className="results-accordion conversation-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Conversation</summary>
      <div>
        {open && <LoadedConversation key={conversationUrl(reference)} reference={reference} />}
      </div>
    </details>
  );
}
