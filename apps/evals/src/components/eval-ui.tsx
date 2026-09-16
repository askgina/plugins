import { type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
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
  "Tool-use results from measured runs. Missing data is shown as unavailable.";

export function PageShell({
  active,
  children,
  footerNote,
}: {
  active: ShellPageId;
  children: ReactNode;
  footerNote?: string;
}) {
  return (
    <div className="eval-app">
      <a className="eval-skip-link" href="#eval-main">
        Skip to content
      </a>
      <header className="eval-header">
        <a className="eval-wordmark" href="#/leaderboard" aria-label="Ask Gina home">
          <img src="/favicon.svg" width={40} height={40} alt="" />
          <strong>Ask Gina</strong>
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
      </header>
      <main id="eval-main" className="eval-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="eval-footer">
        <span>
          {footerNote ?? DATA_ORIGIN_NOTE} <a href="#/methodology">See methodology.</a>
        </span>
      </footer>
    </div>
  );
}

const providerLogos: Readonly<Record<string, string>> = {
  openai: "/images/model-logos/openai.svg",
  anthropic: "/images/model-logos/claude.svg",
  muse: "/images/model-logos/meta.svg",
  meta: "/images/model-logos/meta.svg",
};

export function ModelAvatar({
  model,
  size = "sm",
}: {
  model: { name: string; mark: string; color: string; id?: string; provider?: string };
  size?: "sm" | "lg";
}) {
  const logo = providerLogos[model.provider?.toLowerCase() ?? ""];
  return (
    <span
      className={`eval-avatar eval-avatar-${size} ${logo ? "eval-avatar-logo" : ""} ${model.id ? `eval-avatar-${model.id}` : ""}`}
      style={{ "--model-color": model.color } as CSSProperties}
      aria-hidden="true"
    >
      {logo ? (
        <img src={logo} alt="" width={size === "lg" ? 38 : 24} height={size === "lg" ? 38 : 24} />
      ) : (
        model.mark
      )}
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
