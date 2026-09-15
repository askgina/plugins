import { Fragment, useEffect, type ReactNode } from "react";
import { PageShell } from "./components/eval-ui";
import { LeaderboardPage } from "./pages/leaderboard";
import { ModelIndexPage } from "./pages/model-index";
import { ModelProfilePage } from "./pages/model-profile";
import { TaskExplorerPage } from "./pages/task-explorer";
import { MethodologyPage } from "./pages/methodology";
import { HandoffPage } from "./pages/handoff";
import { ComparePage } from "./canonical/pages/compare";
import { matchPath, parseRoute, useHashRoute } from "./router";

interface RouteEntry {
  readonly pattern: string;
  readonly title: string;
  readonly render: (params: Readonly<Record<string, string>>, query: URLSearchParams) => ReactNode;
}

const ROUTES: readonly RouteEntry[] = [
  { pattern: "/", title: "Leaderboard", render: () => <LeaderboardPage /> },
  { pattern: "/leaderboard", title: "Leaderboard", render: () => <LeaderboardPage /> },
  { pattern: "/models", title: "Models", render: () => <ModelIndexPage /> },
  {
    pattern: "/models/:id",
    title: "Models",
    render: (params) => <ModelProfilePage modelId={params.id ?? ""} />,
  },
  { pattern: "/tasks", title: "Tasks", render: () => <TaskExplorerPage /> },
  {
    pattern: "/compare",
    title: "Compare",
    render: (_params, query) => (
      <ComparePage left={query.get("left") ?? undefined} right={query.get("right") ?? undefined} />
    ),
  },
  { pattern: "/methodology", title: "Methodology", render: () => <MethodologyPage /> },
  { pattern: "/handoff", title: "Exports", render: () => <HandoffPage /> },
];

export default function App() {
  const route = useHashRoute();
  const parsed = parseRoute(route);
  const [matched] = ROUTES.flatMap((entry) => {
    const params = matchPath(entry.pattern, parsed.path);
    return params === null ? [] : [{ entry, params }];
  });
  useEffect(() => {
    document.title = `${matched?.entry.title ?? "Not found"} · Ask Gina Evals`;
  }, [matched]);
  return (
    <Fragment key={route}>
      {matched ? (
        matched.entry.render(matched.params, parsed.query)
      ) : (
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
      )}
    </Fragment>
  );
}
