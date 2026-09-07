import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, FlaskConical, X } from "lucide-react";
import { dataset, families, type EvalModel, type FamilyFilter, type PageId } from "../data";
import { Button } from "./ui/button";
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

type ShellPageId = PageId | "handoff";

const navigation: readonly { id: ShellPageId; label: string; href: string }[] = [
  { id: "leaderboard", label: "Leaderboard", href: "#/leaderboard" },
  { id: "models", label: "Models", href: "#/models/kimi-k3" },
  { id: "tasks", label: "Tasks", href: "#/tasks" },
  { id: "methodology", label: "Methodology", href: "#/methodology" },
  { id: "handoff", label: "Public results", href: "#/handoff" },
];

export function PageShell({ active, children }: { active: ShellPageId; children: ReactNode }) {
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
          <span className="eval-demo-label">
            {active === "handoff" ? "Public JSON handoff" : "Design concept · Illustrative data"}
          </span>
          {active !== "handoff" && (
            <Button className="eval-run-button" onClick={() => setRunOpen(true)}>
              Run an evaluation <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>
      <main id="eval-main" className="eval-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="eval-footer">
        <span>
          {active === "handoff" ? (
            "Public exports measure conformance, not answer accuracy or financial outcomes. Other pages use illustrative fixtures."
          ) : (
            <>{dataset.disclaimer} <a href="#/methodology">See methodology.</a></>
          )}
        </span>
        <span>Open tools. Transparent results.</span>
      </footer>
      <Modal title="Run an evaluation" open={runOpen} onClose={() => setRunOpen(false)}>
        <div className="eval-run-intro">
          <FlaskConical size={25} aria-hidden="true" />
          <p>
            This page is a design preview. It does not start live evaluations or connect to a
            wallet.
          </p>
        </div>
        <p>
          The open-source eval runner lives in this repository. Replay its fixtures locally, or
          follow the runner instructions to configure a live evaluation.
        </p>
        <pre className="eval-code" role="region" aria-label="Run instructions" tabIndex={0}>
          <code>bun install --frozen-lockfile{"\n"}bun run eval:replay</code>
        </pre>
        <p className="eval-muted">
          The replay command checks the repository's own fixtures. It does not produce the
          illustrative model scores shown here.
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

export function ModelAvatar({ model, size = "sm" }: { model: EvalModel; size?: "sm" | "lg" }) {
  return (
    <span
      className={`eval-avatar eval-avatar-${size} eval-avatar-${model.id}`}
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

export function FamilyTabs({
  value,
  onChange,
  includeAll = true,
}: {
  value: FamilyFilter;
  onChange: (value: FamilyFilter) => void;
  includeAll?: boolean;
}) {
  const options: readonly FamilyFilter[] = includeAll ? ["All tasks", ...families] : families;
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
  children,
  open,
  onClose,
}: {
  title: string;
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
        <DialogDescription className="eval-modal-description">
          Illustrative preview. All examples are synthetic, not measured results.
        </DialogDescription>
        <div className="eval-modal-body">{children}</div>
      </DialogContent>
    </DialogRoot>
  );
}
