import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEADING = /^## Check that it works\s*$/m;
const HIGH = 0.7;
const LOW = 0.3;

// Same bytes as Python `json.dumps(value, sort_keys=True)`, which is how the frozen hash was made.
function pythonJson(value) {
  if (Array.isArray(value)) return "[" + value.map(pythonJson).join(", ") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ": " + pythonJson(value[key]))
        .join(", ") +
      "}"
    );
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
export function rubricHash(questions) {
  return crypto.createHash("sha256").update(pythonJson(questions)).digest("hex").slice(0, 12);
}

const onboarding = (verdict) => verdict.onboarding?.choice;
const bool = (verdict, key) => verdict[key]?.bool;

// Compare a new sweep with the committed baseline. `hasHeading(page)` reports whether a page
// currently has the verification heading; it returns undefined when the page no longer exists.
export function compareSweeps(results, baseline, hasHeading) {
  const failures = [];
  if (results.hash !== baseline.hash)
    failures.push(
      `Rubric changed (${results.hash} vs ${baseline.hash}); rerun with the frozen questions.`,
    );
  const errored = Object.keys(results.errors ?? {});
  if (errored.length)
    failures.push(`Judge errors, rerun these pages: ${errored.sort().join(", ")}`);

  const pages = Object.keys(results.verdicts).sort();
  const count = (sweep, pick) => Object.values(sweep.verdicts).filter(pick).length;
  const selfServe = (sweep) => count(sweep, (v) => onboarding(v) === "self_serve");
  const partialLacking = pages.filter(
    (page) => onboarding(results.verdicts[page]) === "partial" && hasHeading(page) === false,
  );
  const newDrift = pages.filter(
    (page) =>
      bool(results.verdicts[page], "drift_risk") >= HIGH &&
      !(bool(baseline.verdicts[page] ?? {}, "drift_risk") >= HIGH),
  );
  const badDescription = pages.filter(
    (page) => bool(results.verdicts[page], "description_ok") < LOW,
  );

  const rows = [
    {
      metric: "self_serve pages (more is better)",
      baseline: selfServe(baseline),
      current: selfServe(results),
      ok: selfServe(results) >= selfServe(baseline),
    },
    {
      metric: `partial pages without "## Check that it works"`,
      baseline: baseline.partialLackingHeading,
      current: partialLacking.length,
      ok: partialLacking.length <= baseline.partialLackingHeading,
    },
    {
      metric: `pages newly at drift_risk >= ${HIGH}`,
      baseline: 0,
      current: newDrift.length,
      ok: newDrift.length === 0,
    },
    {
      metric: `pages with description_ok < ${LOW}`,
      baseline: 0,
      current: badDescription.length,
      ok: badDescription.length === 0,
    },
  ];
  for (const row of rows) if (!row.ok) failures.push(`Regression: ${row.metric}`);
  const detail = { newDrift, badDescription };
  return { rows, failures, detail };
}

export function formatTable(rows) {
  const lines = rows.map((row) => [
    row.metric,
    String(row.baseline),
    String(row.current),
    row.ok ? "ok" : "REGRESSION",
  ]);
  const head = ["Metric", "Baseline", "Current", "Status"];
  const widths = head.map((title, i) =>
    Math.max(title.length, ...lines.map((line) => line[i].length)),
  );
  const render = (line) =>
    line
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [
    render(head),
    render(widths.map((width) => "-".repeat(width))),
    ...lines.map(render),
  ].join("\n");
}

function main(argv) {
  const [resultsPath, baselinePath = path.join(HERE, "baseline-2026-10-20.json")] = argv;
  if (!resultsPath) {
    console.error("Usage: node tools/docs/sweep/compare.mjs <results.json> [baseline.json]");
    return 2;
  }
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  // Page keys are repo-relative paths such as docs/connect/claude.mdx, so run from the repo root.
  const hasHeading = (page) =>
    fs.existsSync(page) ? HEADING.test(fs.readFileSync(page, "utf8")) : undefined;
  const { rows, failures, detail } = compareSweeps(
    read(resultsPath),
    read(baselinePath),
    hasHeading,
  );
  console.log(formatTable(rows));
  for (const [label, pages] of Object.entries(detail))
    if (pages.length) console.log(`\n${label}:\n${pages.map((page) => "  " + page).join("\n")}`);
  if (failures.length) {
    console.error("\n" + failures.join("\n"));
    return 1;
  }
  console.log("\nNo regression against the baseline.");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  process.exitCode = main(process.argv.slice(2));
