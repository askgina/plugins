import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareSweeps, formatTable, rubricHash } from "./compare.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const verdict = (choice, drift = 0.1, description = 0.8) => ({
  onboarding: { choice },
  drift_risk: { bool: drift },
  description_ok: { bool: description },
});
const sweep = (verdicts, extra = {}) => ({ hash: "h", errors: {}, verdicts, ...extra });
const baseline = sweep(
  {
    "docs/a.mdx": verdict("self_serve"),
    "docs/b.mdx": verdict("partial"),
    "docs/c.mdx": verdict("partial", 0.8),
  },
  { partialLackingHeading: 2 },
);
const lacking = () => false;

test("the committed rubric keeps its frozen hash and the baseline uses it", () => {
  const rubric = JSON.parse(fs.readFileSync(path.join(HERE, "rubric.json"), "utf8"));
  assert.equal(rubricHash(rubric.questions), rubric.hash);
  const committed = JSON.parse(
    fs.readFileSync(path.join(HERE, "baseline-2026-10-20.json"), "utf8"),
  );
  assert.equal(committed.hash, rubric.hash);
  assert.equal(committed.ref, "0805b519820874c392474bb445610437cded284c");
  assert.equal(Object.keys(committed.verdicts).length, 68);
});

test("an identical sweep passes", () => {
  const result = compareSweeps(baseline, baseline, lacking);
  assert.deepEqual(result.failures, []);
  const table = formatTable(result.rows).split("\n");
  assert.match(table[2], /^self_serve pages \(more is better\)\s+1\s+1\s+ok$/);
});

test("fewer self_serve pages is a regression", () => {
  const next = sweep({ ...baseline.verdicts, "docs/a.mdx": verdict("partial") });
  assert.ok(compareSweeps(next, baseline, lacking).failures.some((f) => f.includes("self_serve")));
});

test("more partial pages without the heading is a regression, and adding it clears", () => {
  const next = sweep({ ...baseline.verdicts, "docs/d.mdx": verdict("partial") });
  assert.ok(
    compareSweeps(next, baseline, lacking).failures.some((f) => f.includes("Check that it works")),
  );
  const fixed = (page) => page !== "docs/d.mdx";
  assert.deepEqual(compareSweeps(next, baseline, fixed).failures, []);
});

test("a page newly at drift_risk 0.7 or more fails, a known drift page does not", () => {
  const known = sweep({ ...baseline.verdicts });
  assert.deepEqual(compareSweeps(known, baseline, lacking).failures, []);
  const next = sweep({ ...baseline.verdicts, "docs/b.mdx": verdict("partial", 0.7) });
  const result = compareSweeps(next, baseline, lacking);
  assert.deepEqual(result.detail.newDrift, ["docs/b.mdx"]);
  assert.ok(result.failures.length);
});

test("a description_ok below 0.3 fails", () => {
  const next = sweep({ ...baseline.verdicts, "docs/b.mdx": verdict("partial", 0.1, 0.29) });
  assert.deepEqual(compareSweeps(next, baseline, lacking).detail.badDescription, ["docs/b.mdx"]);
});

test("a changed rubric or judge errors fail", () => {
  assert.ok(
    compareSweeps({ ...baseline, hash: "x" }, baseline, lacking).failures[0].includes("Rubric"),
  );
  const errored = { ...baseline, errors: { "docs/a.mdx": "timeout" } };
  assert.ok(compareSweeps(errored, baseline, lacking).failures[0].includes("docs/a.mdx"));
});

test("the CLI exits 1 on a regression and 0 on the baseline itself", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gina-sweep-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const committed = path.join(HERE, "baseline-2026-10-20.json");
  const root = path.resolve(HERE, "../../..");
  const run = (file) =>
    spawnSync(process.execPath, [path.join(HERE, "compare.mjs"), file], {
      cwd: root,
      encoding: "utf8",
    });
  // The committed baseline compared with itself would fail only if docs gained the heading, which
  // can only reduce the partial count, so it must pass.
  assert.equal(run(committed).status, 0);
  const regressed = JSON.parse(fs.readFileSync(committed, "utf8"));
  const [page] = Object.entries(regressed.verdicts).find(
    ([, v]) => v.onboarding.choice === "self_serve",
  );
  regressed.verdicts[page].onboarding.choice = "partial";
  const file = path.join(dir, "results.json");
  fs.writeFileSync(file, JSON.stringify(regressed));
  const result = run(file);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /REGRESSION/);
});
