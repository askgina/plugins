import type { ReactNode } from "react";
import { DateTime } from "effect";
import { ArrowUpRight, BookOpen, LoaderCircle, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "../../components/ui/dialog";
import type {
  PublicComparisonCatalog,
  PublicComparisonCohort,
  PublicComparisonRow,
} from "../../lib/public-comparison";
import type { PublicComparisonState } from "../../lib/use-public-comparison";
import "./shared.css";

const DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const navigation = [
  { id: "results", label: "Results", href: "#/results" },
  { id: "attempts", label: "Attempts", href: "#/attempts" },
  { id: "methodology", label: "Methodology", href: "#/methodology" },
] as const;

export function runHref(publicationId: string): string {
  return `#/runs/${encodeURIComponent(publicationId)}`;
}

export function attemptsHref(publicationId?: string): string {
  return publicationId === undefined
    ? "#/attempts"
    : `#/attempts/${encodeURIComponent(publicationId)}`;
}

export function formatProductionDate(timestamp: string): string {
  return DATE.format(DateTime.toEpochMillis(DateTime.makeUnsafe(timestamp)));
}

export function findProductionRun(
  catalog: PublicComparisonCatalog,
  publicationId?: string,
): { cohort: PublicComparisonCohort; row: PublicComparisonRow } | undefined {
  for (const cohort of catalog.cohorts) {
    for (const row of cohort.rows) {
      if (publicationId === undefined || row.publicationId === publicationId)
        return { cohort, row };
    }
  }
  return undefined;
}

export function ProductionShell({
  active,
  catalog,
  children,
}: {
  active: "results" | "run" | "attempts" | "methodology";
  catalog?: PublicComparisonCatalog;
  children: ReactNode;
}) {
  return (
    <div className="eval-app production-evals">
      <a
        className="eval-skip-link"
        href="#prod-main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("prod-main");
          if (main !== null) {
            main.focus({ preventScroll: true });
            main.scrollIntoView({ block: "start" });
          }
        }}
      >
        Skip to content
      </a>
      <header className="prod-header">
        <a className="prod-wordmark" href="#/results" aria-label="Ask Gina Evals home">
          <strong>
            Ask Gina<span aria-hidden="true">·</span>
          </strong>
          <span>Evals</span>
        </a>
        <nav className="prod-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={item.href}
              aria-current={
                active === item.id || (active === "run" && item.id === "results")
                  ? "page"
                  : undefined
              }
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="prod-header-actions">
          {catalog && (
            <span
              className={`prod-badge ${catalog.dataOrigin === "synthetic" ? "prod-badge--warning" : "prod-badge--neutral"}`}
            >
              {catalog.dataOrigin === "synthetic" ? "Synthetic preview" : "Measured results"}
            </span>
          )}
          <a
            className="prod-runner-link"
            href="https://github.com/askgina/plugins/tree/main/packages/evals"
            target="_blank"
            rel="noreferrer"
          >
            Eval runner <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>
      <main className="prod-main" id="prod-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="prod-footer">
        <div>
          {catalog?.dataOrigin === "synthetic" && (
            <strong>Synthetic preview. No measured model claims. </strong>
          )}
          Public results measure conformance, not answer accuracy or financial outcomes.
        </div>
        <a href="#/methodology">
          How to read these results <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}

export function ProductionHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="eval-hero prod-hero">
      <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
      <p className="eval-eyebrow">{eyebrow}</p>
      <h1 className="eval-title">
        {title}
        <span className="eval-dot">.</span>
      </h1>
      <p className="eval-description">{description}</p>
      {children}
    </header>
  );
}

export function ProductionNotice({
  title,
  description,
  tone = "neutral",
  role,
  children,
}: {
  title: string;
  description: string;
  tone?: "neutral" | "warning" | "error";
  role?: "status" | "alert";
  children?: ReactNode;
}) {
  return (
    <section className={`prod-notice prod-notice--${tone}`} role={role}>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="prod-notice-actions">{children}</div>}
    </section>
  );
}

export function ProductionLoadState({
  state,
}: {
  state: Exclude<PublicComparisonState, { status: "ready" }>;
}) {
  if (state.status === "loading") {
    return (
      <div className="prod-loading" role="status" aria-live="polite">
        <LoaderCircle className="prod-loading-icon" size={24} aria-hidden="true" />
        <div>
          <strong>Loading public results</strong>
          <p>Checking the index and current publication snapshots.</p>
        </div>
      </div>
    );
  }
  return (
    <ProductionNotice
      title="Results could not be verified"
      description="The public index or its current snapshots could not be loaded and verified. No partial results are shown."
      tone="error"
      role="alert"
    >
      <Button className="prod-button" onClick={() => window.location.reload()}>
        Reload results
      </Button>
      <a className="prod-inline-link" href="#/methodology">
        <BookOpen size={15} aria-hidden="true" /> Read the publication rules
      </a>
    </ProductionNotice>
  );
}

export function CandidateIdentity({
  row,
  linked = true,
}: {
  row: PublicComparisonRow;
  linked?: boolean;
}) {
  return (
    <div className="prod-candidate">
      <span className="prod-candidate-mark" aria-hidden="true">
        {row.model.charAt(0).toUpperCase()}
      </span>
      <div className="prod-candidate-copy">
        {linked ? (
          <a href={runHref(row.publicationId)}>{row.model}</a>
        ) : (
          <strong>{row.model}</strong>
        )}
        <span>{row.candidate}</span>
        {row.reasoning !== null && <small>Reasoning: {row.reasoning}</small>}
      </div>
    </div>
  );
}

export function CoverageBadge({ row }: { row: PublicComparisonRow }) {
  const complete = row.coverage.status === "complete";
  return (
    <span
      className={`prod-badge ${complete ? "prod-badge--success" : "prod-badge--warning"}`}
      title={`${row.counts.attempts.total} of ${row.coverage.plannedAttempts} planned attempts observed`}
    >
      {complete ? "Complete" : "Incomplete"}
    </span>
  );
}

export function ProductionDialog({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="eval-modal prod-dialog">
        <div className="eval-modal-heading">
          <DialogTitle>{title}</DialogTitle>
          <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        <DialogDescription className="eval-modal-description">{description}</DialogDescription>
        <div className="eval-modal-body">{children}</div>
      </DialogContent>
    </DialogRoot>
  );
}
