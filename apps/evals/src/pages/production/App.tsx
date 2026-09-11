import { useEffect, useState } from "react";
import type { PublicComparisonCatalog } from "../../lib/public-comparison";
import { usePublicComparisonCatalog } from "../../lib/use-public-comparison";
import { AttemptExplorerPage } from "./attempts";
import { ProductionMethodologyPage } from "./methodology";
import { ResultsPage } from "./results";
import { RunPage } from "./run";
import { ProductionHero, ProductionNotice, ProductionShell } from "./shared";

type ProductionRoute =
  | { page: "results" | "methodology" }
  | { page: "run" | "attempts"; publicationId?: string }
  | { page: "not-found" };

function parseProductionRoute(path: string): ProductionRoute {
  if (path === "/" || path === "/results") return { page: "results" };
  if (path === "/methodology") return { page: "methodology" };
  const match = /^\/(runs|attempts)(?:\/([^/]+))?$/.exec(path);
  if (match === null) return { page: "not-found" };
  try {
    return {
      page: match[1] === "runs" ? "run" : "attempts",
      publicationId: match[2] === undefined ? undefined : decodeURIComponent(match[2]),
    };
  } catch {
    return { page: "not-found" };
  }
}

export function ProductionApp({ catalog }: { catalog?: PublicComparisonCatalog }) {
  const state = usePublicComparisonCatalog(catalog);
  const [path, setPath] = useState(() => window.location.hash.slice(1) || "/results");
  const route = parseProductionRoute(path);

  useEffect(() => {
    const handleRoute = () => {
      const next = window.location.hash.slice(1) || "/results";
      setPath(next);
      if (route.page !== "attempts" || parseProductionRoute(next).page !== "attempts") {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    };
    window.addEventListener("hashchange", handleRoute);
    return () => window.removeEventListener("hashchange", handleRoute);
  }, [route.page]);

  const section =
    route.page === "run"
      ? "Run detail"
      : route.page === "attempts"
        ? "Attempt explorer"
        : route.page === "methodology"
          ? "Methodology"
          : route.page === "not-found"
            ? "Page not found"
            : "Evaluation results";
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${section} · Ask Gina Evals`;
    return () => {
      document.title = previousTitle;
    };
  }, [section]);

  if (route.page === "results") return <ResultsPage key={path} state={state} />;
  if (route.page === "run")
    return <RunPage key={path} state={state} publicationId={route.publicationId} />;
  if (route.page === "attempts")
    return <AttemptExplorerPage state={state} publicationId={route.publicationId} />;
  if (route.page === "methodology") {
    return (
      <ProductionMethodologyPage catalog={state.status === "ready" ? state.catalog : undefined} />
    );
  }
  return (
    <ProductionShell
      active="results"
      catalog={state.status === "ready" ? state.catalog : undefined}
    >
      <div className="eval-container">
        <ProductionHero
          eyebrow="Public evaluation results"
          title="Page not found"
          description="This address does not identify an evaluation page."
        />
        <ProductionNotice
          title="Return to the public results"
          description="Choose a current publication to inspect its run and retained attempt evidence."
        >
          <a className="prod-inline-link" href="#/results">
            View results
          </a>
        </ProductionNotice>
      </div>
    </ProductionShell>
  );
}
