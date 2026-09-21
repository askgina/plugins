import { useEffect, useId, useRef, useState } from "react";
import { UserRound, Terminal } from "lucide-react";
import type { CanonicalAttempt, CanonicalModel } from "../canonical/canonical";
import { ModelAvatar } from "./eval-ui";
import { TranscriptContent } from "./transcript-content";
import {
  conversationNotices,
  conversationUrl,
  type Conversation,
  type ConversationBlock,
  type ConversationReference,
  type ConversationResponse,
} from "../lib/conversations";
import { loadPublicConversation } from "../lib/public-conversations";
import { Button } from "./ui/button";
import "../styles/conversation.css";

const unavailableText = {
  not_configured: "Public transcripts are not available for this campaign yet.",
  not_found: "No public transcript is linked to this attempt.",
  mismatch: "This transcript could not be verified against the selected attempt.",
  invalid_bundle: "This transcript could not be read or verified. Please retry.",
  forbidden: "This transcript is unavailable.",
};

function TranscriptText({ text, source }: { text: string; source: boolean }) {
  if (text.length <= 1600) return <TranscriptContent text={text} source={source} />;
  return (
    <details className="conversation-output conversation-long-message">
      <summary>Show message ({text.length.toLocaleString()} characters)</summary>
      <TranscriptContent text={text} source={source} />
    </details>
  );
}

function ContentBlock({
  block,
  toolNames,
  source,
}: {
  block: ConversationBlock;
  source: boolean;
  toolNames: ReadonlyMap<string, string>;
}) {
  if (block.type === "text")
    return block.text ? <TranscriptText text={block.text} source={source} /> : null;
  if (block.type === "toolCall") {
    return (
      <details className="conversation-output">
        <summary>
          Tool call: <code>{block.name}</code>
        </summary>
        <p className="conversation-label">Arguments</p>
        <TranscriptContent
          text={
            typeof block.arguments === "string"
              ? block.arguments
              : (JSON.stringify(block.arguments, null, 2) ?? "")
          }
          source={source}
          data
        />
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
      <TranscriptContent text={block.text ?? ""} source={source} data />
    </details>
  );
}

export function ConversationView({
  conversation,
  sha256,
  model,
}: {
  conversation: Conversation;
  sha256: string;
  model?: CanonicalModel;
}) {
  const transcriptId = useId();
  const transcript = useRef<HTMLDivElement>(null);
  const [fullHeight, setFullHeight] = useState(false);
  const [source, setSource] = useState(false);
  function setAllExpanded(open: boolean) {
    // These are native, individually toggleable disclosures. Apply the command
    // on every click, including after someone has closed a section manually.
    for (const section of transcript.current?.querySelectorAll("details") ?? []) {
      section.open = open;
    }
    setFullHeight(open);
  }
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
    <div className="conversation-view" data-expanded={fullHeight}>
      <div className="conversation-heading">
        <p className="conversation-title">
          Conversation{" "}
          <span>
            {conversation.visibleMessages.length} messages · Attempt {conversation.repetition}
          </span>
        </p>
        <span className="conversation-capture">
          {conversation.completeness.transcriptCaptureComplete
            ? "Capture complete"
            : "Partial transcript"}
        </span>
      </div>
      {conversation.publication && (
        <p className="conversation-label">
          Public transcript.{" "}
          {Object.values(conversation.publication.redactions).some((count) => count > 0)
            ? "Redactions are marked inline."
            : "No content required redaction."}
        </p>
      )}
      <div className="conversation-controls" role="group" aria-label="Transcript controls">
        <Button
          variant="outline"
          size="sm"
          aria-controls={transcriptId}
          onClick={() => setAllExpanded(true)}
        >
          Expand all
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-controls={transcriptId}
          onClick={() => setAllExpanded(false)}
        >
          Collapse all
        </Button>
        <div className="conversation-format" role="group" aria-label="Transcript format">
          <Button variant="ghost" size="sm" aria-pressed={!source} onClick={() => setSource(false)}>
            Formatted
          </Button>
          <Button variant="ghost" size="sm" aria-pressed={source} onClick={() => setSource(true)}>
            Source
          </Button>
        </div>
      </div>
      {notices.length > 0 && (
        <ul className="conversation-notices">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
      <div id={transcriptId} ref={transcript}>
        <details
          className="conversation-output"
          open={!conversation.visibleMessages.some((message) => message.role === "user")}
        >
          <summary>Recorded task input</summary>
          {conversation.frozenUserTurns.map((turn, index) => (
            <TranscriptText key={index} text={turn.content} source={source} />
          ))}
        </details>
        {conversation.visibleMessages.length === 0 ? (
          <p>No conversation messages were retained for this attempt.</p>
        ) : (
          <ol className="conversation-messages" aria-label="Recorded conversation">
            {conversation.visibleMessages.map((message, index) => (
              <li
                key={`${message.sequence}-${index}`}
                className="conversation-message"
                data-role={message.role}
              >
                <p className="conversation-speaker">
                  {message.role === "assistant" && model ? (
                    <span className="conversation-model-icon" title={model.name}>
                      <ModelAvatar model={model} />
                      <span className="sr-only">{model.name}</span>
                    </span>
                  ) : (
                    <span className="conversation-role-icon" aria-hidden="true">
                      {message.role === "user" ? (
                        <UserRound size={14} />
                      ) : message.role === "assistant" ? (
                        "A"
                      ) : (
                        <Terminal size={14} />
                      )}
                    </span>
                  )}
                  <span>
                    {message.role === "user"
                      ? "User"
                      : message.role === "assistant"
                        ? "Assistant"
                        : "Tool"}
                  </span>
                  <span className="conversation-label">{index + 1}</span>
                </p>
                <div className="conversation-body">
                  {message.content.map((block, blockIndex) => (
                    <ContentBlock
                      key={blockIndex}
                      block={block}
                      toolNames={toolNames}
                      source={source}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
        <details className="conversation-output">
          <summary>Capture details</summary>
          <p>
            {conversation.completeness.transcriptCaptureComplete
              ? "Transcript capture complete."
              : "Partial transcript."}{" "}
            Capture completeness is separate from grading.
          </p>
          {conversation.publication && (
            <p>
              Credentials, personal identifiers, local paths, or private account content are marked
              [redacted:…]. Message order is preserved.
            </p>
          )}
          <p>
            {conversation.rowId} · Source: {conversation.visibleEvidenceSource}
          </p>
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
    </div>
  );
}

type LoadState = { readonly status: "loading" | "error" } | ConversationResponse;

function LoadedConversation({
  reference,
  model,
}: {
  reference: ConversationReference;
  model?: CanonicalModel;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const url = conversationUrl(reference);
  useEffect(() => {
    const controller = new AbortController();
    void loadPublicConversation(reference, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [url, retry, reference]);
  if (state.status === "loading")
    return (
      <p role="status" className="conversation-loading">
        Loading conversation…
      </p>
    );
  if (state.status === "available")
    return (
      <ConversationView conversation={state.conversation} sha256={state.sha256} model={model} />
    );
  return (
    <div>
      <p role="status">
        {state.status === "unavailable"
          ? unavailableText[state.reason]
          : "Could not load or verify this public transcript. Check your connection, then retry."}
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

export function ConversationPanel({
  reference,
  model,
  inline = false,
}: {
  reference?: ConversationReference;
  model: CanonicalModel | undefined;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!reference)
    return (
      <p className="conversation-label">A retained conversation is not linked to this attempt.</p>
    );
  if (inline)
    return (
      <LoadedConversation key={conversationUrl(reference)} reference={reference} model={model} />
    );
  return (
    <details
      className="results-accordion conversation-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Conversation</summary>
      <div>
        {open && (
          <LoadedConversation
            key={conversationUrl(reference)}
            reference={reference}
            model={model}
          />
        )}
      </div>
    </details>
  );
}

function RecoveryConversation({
  attempt,
  model,
}: {
  attempt: CanonicalAttempt;
  model: CanonicalModel | undefined;
}) {
  const id = useId();
  const [execution, setExecution] = useState("selected");
  const history = attempt.recovery?.history ?? [];
  const selected = history.find((entry) => entry.terminalSha256 === execution);
  const reference = selected?.conversation ?? attempt.conversation;
  return (
    <>
      {attempt.recovery && (
        <div className="task-model-picker">
          <label htmlFor={`${id}-execution`}>Execution history</label>
          <select
            id={`${id}-execution`}
            value={execution}
            onChange={(event) => setExecution(event.target.value)}
          >
            <option value="selected">
              Selected result · {attempt.recovery.timeoutMs / 1000}s ·{" "}
              {attempt.verdict === "not_graded"
                ? "Ungraded"
                : attempt.verdict === "pass"
                  ? "Passed"
                  : "Failed"}
            </option>
            {history.map((entry, index) => (
              <option key={entry.terminalSha256} value={entry.terminalSha256}>
                Execution {index + 1} · {entry.timeoutMs / 1000}s ·{" "}
                {entry.outcome === "completed" ? "Graded" : "Execution failure"}
                {entry.selected ? " · selected" : ""}
              </option>
            ))}
          </select>
          <p className="conversation-label">
            {attempt.recovery.budgetCohort.replaceAll("-", " ")}. First completed grade retained;
            failed executions remain available here. Hidden reasoning is excluded.
          </p>
        </div>
      )}
      <ConversationPanel reference={reference} model={model} inline />
    </>
  );
}

export function AttemptConversationPanel({
  attempt,
  model,
}: {
  attempt: CanonicalAttempt | undefined;
  model: CanonicalModel | undefined;
}) {
  if (!attempt) return <ConversationPanel model={model} inline />;
  return (
    <RecoveryConversation
      key={
        attempt.conversation
          ? conversationUrl(attempt.conversation)
          : `${attempt.caseId}-${attempt.repetition}`
      }
      attempt={attempt}
      model={model}
    />
  );
}
