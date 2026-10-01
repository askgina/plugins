import type { TaskView } from "../lib/task-workspace";

export const TASK_VIEWS = [
  { id: "conversation", label: "Conversation" },
  { id: "checks", label: "Checks" },
  { id: "run", label: "Run details" },
] as const satisfies readonly { id: TaskView; label: string }[];

/** Conversation / Checks / Run details tabs for an attempt; controls `#task-evidence-panel`. */
export function TaskEvidenceTabs({
  view,
  onSelect,
}: {
  readonly view: TaskView;
  readonly onSelect: (view: TaskView) => void;
}) {
  return (
    <div className="task-workspace-tabs" role="tablist" aria-label="Attempt evidence">
      {TASK_VIEWS.map((entry, index) => (
        <button
          key={entry.id}
          id={`task-tab-${entry.id}`}
          role="tab"
          type="button"
          aria-selected={view === entry.id}
          aria-controls="task-evidence-panel"
          tabIndex={view === entry.id ? 0 : -1}
          onClick={() => onSelect(entry.id)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % TASK_VIEWS.length
                : event.key === "ArrowLeft"
                  ? (index + TASK_VIEWS.length - 1) % TASK_VIEWS.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? TASK_VIEWS.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onSelect(TASK_VIEWS[next]!.id);
            document.getElementById(`task-tab-${TASK_VIEWS[next]!.id}`)?.focus();
          }}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
