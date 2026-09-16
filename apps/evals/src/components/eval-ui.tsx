import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, FlaskConical, X } from "lucide-react";
import { reasoningSweepPublication } from "../results";
import { Button } from "./ui/button";
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

export type PageId = "leaderboard" | "models" | "tasks" | "methodology";
export type ShellPageId = PageId | "handoff" | "compare";

const navigation: readonly { id: ShellPageId; label: string; href: string }[] = [
  { id: "leaderboard", label: "Leaderboard", href: "#/leaderboard" },
  { id: "models", label: "Models", href: "#/models" },
  { id: "tasks", label: "Tasks", href: "#/tasks" },
  { id: "methodology", label: "Methodology", href: "#/methodology" },
  { id: "compare", label: "Compare", href: "#/compare" },
  { id: "handoff", label: "Exports", href: "#/handoff" },
];

const DATA_ORIGIN_NOTE =
  "Measured tool-use conformance exported from run artifacts — not answer accuracy or financial outcomes. Synthetic previews live in Storybook only.";

export function PageShell({
  active,
  children,
  footerNote,
}: {
  active: ShellPageId;
  children: ReactNode;
  footerNote?: string;
}) {
  const [runOpen, setRunOpen] = useState(false);
  return (
    <div className="eval-app">
      <a className="eval-skip-link" href="#eval-main">
        Skip to content
      </a>
      <header className="eval-header">
        <a className="eval-wordmark" href="#/leaderboard" aria-label="Ask Gina Evals home">
          <strong>
            Ask Gina<span className="eval-brand-dot">·</span>
          </strong>
          <span>Evals</span>
        </a>
        <nav className="eval-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={item.href}
              aria-current={active === item.id ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="eval-header-actions">
          <Button className="eval-run-button" onClick={() => setRunOpen(true)}>
            Run an evaluation <ArrowUpRight size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main id="eval-main" className="eval-main" tabIndex={-1}>
        {(reasoningSweepPublication.publishedRows < reasoningSweepPublication.plannedRows ||
          reasoningSweepPublication.publishedSlots < reasoningSweepPublication.plannedSlots) && (
          <p className="eval-container eval-muted" role="status">
            <strong>Partial sweep.</strong> {reasoningSweepPublication.publishedRows}/
            {reasoningSweepPublication.plannedRows} reasoning rows and{" "}
            {reasoningSweepPublication.publishedSlots}/{reasoningSweepPublication.plannedSlots}{" "}
            planned slots published. Remaining rows are not included yet; runtime failures may
            remain unscored.
          </p>
        )}
        {children}
      </main>
      <footer className="eval-footer">
        <span>
          {footerNote ?? DATA_ORIGIN_NOTE} <a href="#/methodology">See methodology.</a>
        </span>
        <span>Open tools. Transparent results.</span>
      </footer>
      <Modal
        title="Run an evaluation"
        description="How to reproduce these results with the open-source runner."
        open={runOpen}
        onClose={() => setRunOpen(false)}
      >
        <div className="eval-run-intro">
          <FlaskConical size={25} aria-hidden="true" />
          <p>
            This site only reads exported artifacts — it never starts evaluations or connects to a
            wallet. The runner lives in <code>packages/evals</code> (Bun 1.4.x, run from the
            repository root).
          </p>
        </div>
        <p>
          Hermetic replay grades the bundled suite against recorded observations — no credentials
          and no live calls:
        </p>
        <pre className="eval-code" role="region" aria-label="Replay instructions" tabIndex={0}>
          <code>
            bun install --frozen-lockfile{"\n"}
            bun run eval:replay -- \{"\n"}
            {"  "}--suite packages/evals/src/fixtures/model-smoke.yaml \{"\n"}
            {"  "}--observations packages/evals/src/fixtures/synthetic-observations.yaml \{"\n"}
            {"  "}--output /tmp/plugin-eval-report.json
          </code>
        </pre>
        <p>
          Live trials use the same suite and grader against a real backend. Every runner needs{" "}
          <code>ASK_GINA_ACCESS_TOKEN</code> plus its own credential (for example{" "}
          <code>OPENROUTER_API_KEY</code>), a clean Git worktree, and three to five repetitions:
        </p>
        <pre className="eval-code" role="region" aria-label="Live run instructions" tabIndex={0}>
          <code>
            bun run eval:openrouter -- \{"\n"}
            {"  "}--suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \{"\n"}
            {"  "}--run-id local-openrouter-example --candidate main \{"\n"}
            {"  "}--model openai/gpt-5.1 --reasoning medium \{"\n"}
            {"  "}--repetitions 3 --account-class eval --timeout-ms 120000 \{"\n"}
            {"  "}--max-steps 8 --openrouter-endpoint openai \{"\n"}
            {"  "}--expected-provider OpenAI --max-cost-usd 25
          </code>
        </pre>
        <p className="eval-muted">
          Responses, Codex, Claude, and OMP runners follow the same shape — see the package README
          for each runner's flags and credentials.
        </p>
        <a
          className="eval-text-link"
          href="https://github.com/askgina/plugins/tree/main/packages/evals"
          target="_blank"
          rel="noreferrer"
        >
          Read eval runner instructions <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </Modal>
    </div>
  );
}

export function ModelAvatar({
  model,
  size = "sm",
}: {
  model: { name: string; mark: string; color: string; id?: string };
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={`eval-avatar eval-avatar-${size} ${model.id ? `eval-avatar-${model.id}` : ""}`}
      style={{ "--model-color": model.color } as CSSProperties}
      aria-hidden="true"
    >
      {model.mark}
    </span>
  );
}

export function ScoreBadge({ value, uncertainty }: { value: number; uncertainty?: number }) {
  return (
    <span className={`eval-score ${value >= 65 ? "eval-score-positive" : "eval-score-negative"}`}>
      <strong>{value}%</strong>
      {uncertainty !== undefined && <span>±{uncertainty}%</span>}
    </span>
  );
}

export function Panel({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`eval-panel ${className}`}>
      <div className="eval-panel-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function FamilyTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
}) {
  return (
    <div className="eval-family-tabs" role="group" aria-label="Task family">
      {options.map((family) => (
        <button
          type="button"
          key={family}
          aria-pressed={value === family}
          onClick={() => onChange(family)}
        >
          {family}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  open,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="eval-modal">
        <div className="eval-modal-heading">
          <DialogTitle>{title}</DialogTitle>
          <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        {description !== undefined && (
          <DialogDescription className="eval-modal-description">{description}</DialogDescription>
        )}
        <div className="eval-modal-body">{children}</div>
      </DialogContent>
    </DialogRoot>
  );
}
