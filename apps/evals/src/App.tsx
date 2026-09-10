import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { dataset } from "./data";
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
                Every model score, timing, price, tool trace, and distribution on these pages is a
                synthetic design fixture. Model names identify the intended comparison layout, not
                an evaluation that has taken place.
              </p>
              <p>
                The dataset and run labels are illustrative too. These results should not inform
                model selection or financial decisions.
              </p>
            </div>
          </Panel>
          <Panel title="What a task measures">
            <div className="eval-method-body">
              <p>
                Tasks cover portfolio analysis, spot markets, perpetuals, and prediction markets.
                Each asks the agent to answer a financial question using read-only tools.
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
                Pass rate is the proportion of tasks that meet the rubric. Tool selection accuracy
                measures whether the agent chose the expected tools. Task scores summarize the
                individual rubric checks.
              </p>
              <p>
                The preview uses {dataset.tasks.toLocaleString("en-US")} tasks split equally across
                four families. Displayed uncertainty ranges and histogram counts demonstrate the
                proposed visual treatment. They are not computed confidence intervals.
              </p>
            </div>
          </Panel>
          <Panel title="Latency, cost, and reproducibility">
            <div className="eval-method-body">
              <p>
                Median latency is elapsed time per task. Cost is the estimated model cost per task
                in USD. A published benchmark would need pinned model versions, tool definitions,
                dataset, repetitions, and pricing assumptions.
              </p>
              <p>
                The open-source runner is separate from this preview. The task explorer contains
                sanitized synthetic examples, not exported production conversations.
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
    return <ModelProfilePage key={route} modelId={route.split("/")[2] || "kimi-k3"} />;
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
