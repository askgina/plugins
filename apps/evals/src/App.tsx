import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { PageShell, Panel } from "./components/eval-ui";
import { LeaderboardPage } from "./pages/leaderboard";
import { ModelProfilePage } from "./pages/model-profile";
import { TaskExplorerPage } from "./pages/task-explorer";
import { HandoffPage } from "./pages/handoff";

export function MethodologyPage() {
  return (
    <PageShell active="methodology">
      <div className="eval-container eval-methodology">
        <section className="eval-hero">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <p className="eval-eyebrow">Methodology / Design preview</p>
          <h1 className="eval-title">
            Open to inspection<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            A useful score needs a task, a rubric, and evidence you can read. Here is what this
            preview shows, and what it does not.
          </p>
        </section>
        <div className="eval-method-grid">
          <Panel title="First, a note on the data">
            <div className="eval-method-body">
              <p>
                The comparison and model pages consume a verified synthetic publication through the
                public v1 result contract. The task explorer remains an invented design fixture.
              </p>
              <p>
                Synthetic values demonstrate the consumer boundary. They should not inform model
                selection or financial decisions.
              </p>
            </div>
          </Panel>
          <Panel title="What a task measures">
            <div className="eval-method-body">
              <p>
                The public result measures conformance across routing, arguments, safety,
                completion, and skill activation. Each dimension retains passed, failed, and
                not-applicable counts.
              </p>
              <ul>
                <li>Choose the right tools for the question.</li>
                <li>Use valid arguments and the requested scope.</li>
                <li>Ground the answer in the returned evidence.</li>
                <li>Respect read-only safety and report missing data.</li>
              </ul>
            </div>
          </Panel>
          <Panel title="Reading the scores">
            <div className="eval-method-body">
              <p>
                Pass rate is the proportion of observed attempts that pass with complete coverage.
                Attempt counts, unique cases, retained evidence, and coverage remain separate.
              </p>
              <p>
                Answer accuracy, USD cost, uncertainty, task-family groupings, score distributions,
                and ordinal rankings are unavailable until a separately versioned method declares
                them.
              </p>
            </div>
          </Panel>
          <Panel title="Latency, cost, and reproducibility">
            <div className="eval-method-body">
              <p>
                Latency uses exported p50, p95, and maximum attempt durations. Token totals report
                only retained observations. Missing samples never mean a free or zero-cost run.
              </p>
              <p>
                Comparisons require matching suite, fixture, catalog, target, account class,
                clean-chat setting, and repetitions. Model labels alone are not sufficient.
              </p>
              <a
                className="eval-text-link"
                href="https://github.com/askgina/plugins/tree/main/packages/evals"
                target="_blank"
                rel="noreferrer"
              >
                Explore the eval runner <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
          </Panel>
        </div>
        <p className="eval-method-note">
          No evaluations, wallet connections, trades, or tool requests run from this site. Downloads
          contain only the illustrative fixtures displayed here.
        </p>
      </div>
    </PageShell>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/leaderboard");
  useEffect(() => {
    const handleRoute = () => {
      const nextRoute = window.location.hash.slice(1);
      if (nextRoute === "eval-main") return;
      setRoute(nextRoute || "/leaderboard");
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("hashchange", handleRoute);
    return () => window.removeEventListener("hashchange", handleRoute);
  }, []);
  useEffect(() => {
    const section = route.startsWith("/models")
      ? "Models"
      : route === "/tasks"
        ? "Tasks"
        : route === "/methodology"
          ? "Methodology"
          : route === "/handoff"
            ? "Public results"
            : "Leaderboard";
    document.title = `${section} · Ask Gina`;
  }, [route]);
  if (route === "/models" || route.startsWith("/models/"))
    return <ModelProfilePage key={route} modelId={route.split("/")[2]} />;
  if (route === "/tasks") return <TaskExplorerPage />;
  if (route === "/methodology") return <MethodologyPage />;
  if (route === "/handoff") return <HandoffPage />;
  if (route === "/leaderboard" || route === "/") return <LeaderboardPage />;
  return (
    <PageShell active="leaderboard">
      <div className="eval-container eval-hero">
        <h1 className="eval-title">
          Page not found<span className="eval-dot">.</span>
        </h1>
        <a className="eval-text-link" href="#/leaderboard">
          Back to the leaderboard
        </a>
      </div>
    </PageShell>
  );
}
