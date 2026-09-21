import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TaskExplorerPage } from "../src/pages/task-explorer";
import { configurationLeaderboardRows, unifiedLeaderboardRows } from "../src/canonical/selectors";
import { taskRoute, taskRunOptions } from "../src/lib/task-workspace";
import { parseRoute } from "../src/router";

const configurations = configurationLeaderboardRows();
const astra = configurations.find((row) => row.runs.Spot?.runId === "astra-high-spot-1")!;

test("an attempt link retains the exact task, model, setting, and evidence view", () => {
  const parsed = parseRoute(
    taskRoute({
      family: "Spot",
      modelId: "astra",
      caseId: "spot-token-chart",
      runId: "astra-high-spot-1",
      attempt: 2,
      view: "checks",
    }),
  );
  expect(parsed.path).toBe("/tasks");
  expect(Object.fromEntries(parsed.query)).toEqual({
    category: "Spot",
    model: "astra",
    task: "spot-token-chart",
    run: "astra-high-spot-1",
    attempt: "2",
    view: "checks",
  });
  for (const attempt of [-1, 0, 1.5, NaN])
    expect(parseRoute(taskRoute({ family: "Spot", attempt })).query.has("attempt")).toBe(false);
});

test("setting choices retain history and cannot cross model or category boundaries", () => {
  const runs = taskRunOptions(astra, "Spot", configurations);
  expect(runs.some((run) => run.runId === "astra-max-spot-1")).toBe(true);
  expect(runs.some((run) => run.runId === "astra-high-spot-1")).toBe(true);
  expect(runs.every((run) => run.modelId === "astra" && run.family === "Spot")).toBe(true);
  expect(new Set(runs.map((run) => run.runId)).size).toBe(runs.length);
  expect(taskRunOptions(astra, "Portfolio", configurations)).toEqual([]);
});

test("a leaderboard run link opens that setting and selects an attempt immediately", () => {
  const html = renderToStaticMarkup(
    createElement(TaskExplorerPage, {
      initialModelId: "astra",
      initialRunId: "astra-high-spot-1",
      initialCaseId: "spot-token-metadata",
      initialView: "run",
    }),
  );
  expect(html).toContain("<code>astra-high-spot-1</code>");
  expect(html).toMatch(/aria-pressed="true"><span>Attempt 1<\/span>/u);
  expect(html).toContain('id="task-tab-run"');
  expect(html).not.toContain('class="tasks-table"');
  expect(html.match(/aria-label="View [^"]+ results"/gu)).toHaveLength(
    unifiedLeaderboardRows().length,
  );
});

test("links to a different model's run fall back to the selected model's evidence", () => {
  const html = renderToStaticMarkup(
    createElement(TaskExplorerPage, {
      initialModelId: "astra",
      initialRunId: "sol-spot-1",
      initialCaseId: "spot-token-metadata",
      initialView: "run",
    }),
  );
  expect(html).not.toContain("<code>sol-spot-1</code>");
  expect(html).toContain("<code>recovery-astra-max-spot-1</code>");
});

test("a missing attempt link never silently displays another attempt's transcript", () => {
  const run = astra.runs.Spot!;
  if (run.attempts.availability !== "available") throw new Error("Expected fixture attempts");
  const rows = [
    {
      ...astra,
      runs: {
        ...astra.runs,
        Spot: {
          ...run,
          attempts: {
            availability: "available" as const,
            value: run.attempts.value.filter((attempt) => attempt.repetition !== 2),
          },
        },
      },
    },
  ];
  const html = renderToStaticMarkup(
    createElement(TaskExplorerPage, {
      rows,
      initialModelId: "astra",
      initialCaseId: "spot-token-metadata",
      initialAttempt: 2,
      initialView: "conversation",
    }),
  );
  expect(html).toContain("Attempt 2 was not recorded.");
  expect(html).not.toContain("Loading conversation");
  expect(html).toContain("Incomplete results");
});

test("execution errors remain distinct from graded failures in the model list", () => {
  const incomplete = configurations.find((row) => row.runs.Perps?.runId === "astra-max-perps-1")!;
  const html = renderToStaticMarkup(
    createElement(TaskExplorerPage, {
      rows: [incomplete],
      initialModelId: "astra",
      initialFamily: "Perps",
      initialCaseId: "perps-account",
      initialAttempt: 3,
      initialView: "checks",
    }),
  );
  expect(html).toContain("2 passed · 0 failed");
  expect(html).toContain("1 run error");
  expect(html).toContain("Run error");
  expect(html).not.toContain("2/3 passed");
});

test("task search and unevaluated categories have explicit empty states", () => {
  const empty = renderToStaticMarkup(
    createElement(TaskExplorerPage, { initialSearch: "no-such-task-xyz" }),
  );
  expect(empty).toContain("No tasks match");
  expect(empty).toContain("Clear task search");
  expect(empty).not.toContain("Loading conversation");
  const portfolio = renderToStaticMarkup(
    createElement(TaskExplorerPage, { initialFamily: "Portfolio" }),
  );
  expect(portfolio).toContain("Not evaluated");
  expect(portfolio).toContain("Individual attempts are not available");
  expect(portfolio).not.toContain("Loading conversation");
});
