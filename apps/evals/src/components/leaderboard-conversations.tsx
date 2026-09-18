import { useId, useState } from "react";
import type { CanonicalAttempt, CanonicalRun, PrototypeFamily } from "../canonical/canonical";
import {
  SCORED_FAMILIES,
  caseDefinitionsForFamily,
  summarizeTask,
  type LeaderboardModelRow,
} from "../canonical/selectors";
import { ConversationPanel } from "./conversation-panel";
import "../styles/leaderboard-conversations.css";

function attemptLabel(attempt: CanonicalAttempt | undefined): string {
  if (!attempt) return "Not recorded";
  if (attempt.verdict === "pass") return "Passed";
  if (attempt.verdict === "fail") return "Failed";
  if (attempt.execution === "completed") return "Not graded";
  return {
    timed_out: "Timed out",
    runtime_failure: "Run error",
    pending: "Pending",
    unstarted: "Not started",
    unknown: "Unknown",
  }[attempt.execution];
}

function RunConversationPicker({ run }: { run: CanonicalRun }) {
  const id = useId();
  const tasks = caseDefinitionsForFamily(run.family);
  const [caseId, setCaseId] = useState(tasks[0]?.caseId ?? "");
  const [repetition, setRepetition] = useState(1);
  const summary = summarizeTask(run, caseId);
  const attempt = summary.slots[repetition - 1];
  return (
    <>
      <div className="task-model-picker leaderboard-chat-task">
        <label htmlFor={`${id}-task`}>Task</label>
        <select
          id={`${id}-task`}
          value={caseId}
          onChange={(event) => {
            setCaseId(event.target.value);
            setRepetition(1);
          }}
        >
          {tasks.map((task) => (
            <option key={task.caseId} value={task.caseId}>
              {task.title}
            </option>
          ))}
        </select>
      </div>
      <div className="task-attempts" role="group" aria-label="Conversation attempts">
        {summary.slots.map((entry, index) => (
          <button
            key={index}
            type="button"
            className="task-attempt"
            aria-pressed={repetition === index + 1}
            disabled={!entry}
            onClick={() => setRepetition(index + 1)}
          >
            <span>Attempt {index + 1}</span>
            <strong>{attemptLabel(entry)}</strong>
          </button>
        ))}
      </div>
      {summary.slots.length === 0 ? (
        <p role="status">Individual attempts were not retained for this run.</p>
      ) : (
        <ConversationPanel reference={attempt?.conversation} inline />
      )}
    </>
  );
}

export function LeaderboardConversations({
  row,
  open,
  onOpenChange,
}: {
  row: LeaderboardModelRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const families = SCORED_FAMILIES.filter((family) => row.runs[family]);
  const [family, setFamily] = useState<PrototypeFamily>(families[0] ?? "Spot");
  const run = row.runs[family];
  return (
    <details
      id={`leaderboard-chat-${row.model.id}`}
      className="results-accordion leaderboard-conversations"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>Chat transcripts</summary>
      {open && (
        <div>
          <div className="task-model-picker">
            <label htmlFor={`${id}-category`}>Category</label>
            <select
              id={`${id}-category`}
              value={family}
              onChange={(event) => setFamily(event.target.value as PrototypeFamily)}
            >
              {families.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
          {run ? (
            <RunConversationPicker key={run.runId} run={run} />
          ) : (
            <p>No recorded run in this category.</p>
          )}
        </div>
      )}
    </details>
  );
}
