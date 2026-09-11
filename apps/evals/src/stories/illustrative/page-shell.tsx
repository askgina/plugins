// Original origin/main preview shell, kept separate from the published-results UI.
import { useState, type ReactNode } from "react";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { dataset, type PageId } from "../../data";
import { Modal } from "../../components/eval-ui";
import { Button } from "../../components/ui/button";
import "./page-shell.css";

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
    <div className="eval-app illustrative-evals">
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
            <>
              {dataset.disclaimer} <a href="#/methodology">See methodology.</a>
            </>
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
