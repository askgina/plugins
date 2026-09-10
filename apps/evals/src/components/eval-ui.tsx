import { type CSSProperties, type ReactNode } from "react";
import { House, X } from "lucide-react";
import askGinaLogoUrl from "../../../../docs/logo/light.svg";
import { dataset, families, type EvalModel, type FamilyFilter, type PageId } from "../data";
import { Button } from "./ui/button";
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

type ShellPageId = PageId | "handoff";

const navigation: readonly { id: ShellPageId; label: string; href: string }[] = [
  { id: "leaderboard", label: "Leaderboard", href: "#/leaderboard" },
  { id: "models", label: "Models", href: "#/models" },
  { id: "tasks", label: "Tasks", href: "#/tasks" },
  { id: "methodology", label: "Methodology", href: "#/methodology" },
  { id: "handoff", label: "Public results", href: "#/handoff" },
];

export function PageShell({ active, children }: { active: ShellPageId; children: ReactNode }) {
  return (
    <div className="eval-app">
      <a className="eval-skip-link" href="#eval-main">
        Skip to content
      </a>
      <header className="eval-header">
        <a className="eval-wordmark" href="https://www.askgina.ai" aria-label="Ask Gina home">
          <img src={askGinaLogoUrl} alt="Ask Gina" />
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
          <a className="eval-home-link" href="https://www.askgina.ai">
            <House size={17} fill="currentColor" aria-hidden="true" />
            <span>Home</span>
          </a>
        </div>
      </header>
      <main id="eval-main" className="eval-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="eval-footer">
        <span>
          {active === "handoff" ? (
            "Public exports measure conformance, not answer accuracy or financial outcomes. Other pages use illustrative fixtures."
          ) : active === "leaderboard" || active === "models" ? (
            "Verified synthetic publication. Public v1 results are unranked and measure conformance only."
          ) : (
            <>
              {dataset.disclaimer} <a href="#/methodology">See methodology.</a>
            </>
          )}
        </span>
        <span>Open tools. Transparent results.</span>
      </footer>
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
