import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkExternal,
  isTaskPage,
  linksIn,
  resolveRoute,
  validateCorpusBody,
  validateDocs,
  validateReleaseGate,
  validateSkillCoverage,
} from "./check.mjs";

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gina-docs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "mint.json"),
    JSON.stringify({
      topbarCtaButton: { name: "Open Gina" },
      navigation: [{ group: "Start", pages: ["index"] }],
      ...options,
    }),
  );
  fs.writeFileSync(path.join(root, "index.mdx"), '---\ntitle: "Home"\ndescription: "Start"\n---\n');
  return root;
}
test("checks component links across lines and ignores fenced examples", () => {
  assert.deepEqual(
    linksIn('<Card\n href="/missing" />\n```mdx\n<Card href="/example" />\n```').map((x) => x.href),
    ["/missing"],
  );
});
test("detects broken card and image links, and missing alt text", (t) => {
  const root = fixture(t);
  fs.appendFileSync(
    path.join(root, "index.mdx"),
    '<Card href="/missing" /><img src="/missing.png" />\n[Add in Claude](claude://claude.ai/add-connector?name=Gina)\n',
  );
  const errors = validateDocs(root).errors;
  // The Claude app link is an app deep link, not a docs route; only the two real misses count.
  assert.equal(errors.filter((x) => x.startsWith("Broken link")).length, 2);
  assert.ok(errors.some((x) => x.startsWith("Image needs alt")));
});
test("requires an index for directories and rejects path traversal", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "empty"));
  assert.equal(resolveRoute(root, "/empty"), undefined);
  assert.equal(resolveRoute(root, "/../outside.mdx"), undefined);
});
test("catches duplicate nested navigation and published redirect sources", (t) => {
  const root = fixture(t, {
    navigation: [{ group: "A", pages: ["index", { group: "B", pages: ["index"] }] }],
    redirects: [{ source: "/index", destination: "/absent" }],
  });
  const errors = validateDocs(root).errors;
  assert.ok(errors.some((x) => x.startsWith("Duplicate navigation")));
  assert.ok(errors.some((x) => x.startsWith("Redirect source still")));
  assert.ok(errors.some((x) => x.startsWith("Missing redirect destination")));
});
test("rejects redirect cycles and orphan content that agents could retrieve", (t) => {
  const root = fixture(t, {
    redirects: [
      { source: "/old", destination: "/older" },
      { source: "/older", destination: "/old" },
    ],
  });
  fs.writeFileSync(path.join(root, "orphan.mdx"), "---\ntitle: Orphan\ndescription: Old\n---");
  const errors = validateDocs(root).errors;
  assert.ok(errors.some((x) => x.startsWith("Redirect chain or cycle")));
  assert.ok(errors.some((x) => x.startsWith("Page is not in navigation")));
});
test("checks first-party absolute URLs locally before deployment", (t) => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "index.mdx"), "[New page](https://docs.askgina.ai/new-page)");
  assert.ok(validateDocs(root).errors.some((x) => x.includes("/new-page")));
});

test("checks links into this repository against the checkout, not live main", async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gina-repo-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, "plugins/new-plugin/skills"), { recursive: true });
  const base = "https://github.com/askgina/plugins";
  const errors = await checkExternal(
    [
      `${base}/tree/main/plugins/new-plugin/skills`,
      `${base}/tree/main/plugins/missing`,
      `${base}/blob/main/%2E%2E/outside`,
    ],
    repo,
  );
  assert.deepEqual(errors, [
    `Repository link points to a missing path: ${base}/tree/main/plugins/missing`,
    `Repository link points to a missing path: ${base}/blob/main/%2E%2E/outside`,
  ]);
});

test("corpus rejects rich MDX but accepts Markdown images and matching H1", () => {
  const front =
    '---\ntitle: "Guide"\ndescription: "Guide"\nowner: "Team"\nkind: "guide"\nlastReviewed: "2026-09-06"\nincludeInDocsAgent: true\nrelatedSlugs:\n  - overview\n---\n\n# Guide\n\n';
  assert.deepEqual(validateCorpusBody(front + "![Description](/image.png)", "guide"), []);
  assert.ok(
    validateCorpusBody(front + "<Frame>Image</Frame>", "guide").some((x) =>
      x.includes("plain Markdown"),
    ),
  );
  assert.ok(
    validateCorpusBody(front.replace("# Guide", "# Wrong"), "guide").some((x) => x.includes("H1")),
  );
});

test("LP examples reject duplicate identities", async () => {
  const { lpExamples } = await import("./lp-contract.mjs");
  const example = "{/* lp-example: sample */}\n```json\n{}\n```";
  assert.throws(() => lpExamples(example + "\n" + example), /Duplicate/);
});

function page(root, name, description, body = "") {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntitle: "T"\ndescription: ${description}\n---\n${body}`);
}
const WORKS = "\n## Check that it works\n\nAsk for a price. Expect a quote.\n";

test("release gate requires the verification heading on task pages", (t) => {
  const root = fixture(t);
  page(root, "start/first.mdx", '"Run a first request."');
  const errors = validateReleaseGate(root);
  assert.deepEqual(errors, ['Task page needs a "## Check that it works" section: start/first.mdx']);
  page(root, "start/first.mdx", '"Run a first request."', WORKS);
  assert.deepEqual(validateReleaseGate(root), []);
});

test("release gate exempts top-level and reference pages", (t) => {
  const root = fixture(t);
  page(root, "start/ref.mdx", '"List the tools."\npageType: reference');
  page(root, "product-guide/policy.mdx", '"Explain limits."\nkind: policy');
  assert.equal(isTaskPage("index.mdx", ""), false);
  assert.deepEqual(validateReleaseGate(root), []);
});

test("release gate baseline lets known pages pass and forces it to shrink", (t) => {
  const root = fixture(t);
  page(root, "start/old.mdx", '"Run an old request."');
  assert.deepEqual(validateReleaseGate(root, { missingHeading: ["start/old.mdx"] }), []);
  page(root, "start/old.mdx", '"Run an old request."', WORKS);
  assert.deepEqual(validateReleaseGate(root, { missingHeading: ["start/old.mdx"] }), [
    'Remove start/old.mdx from gate-baseline.json: it has "## Check that it works".',
  ]);
  assert.ok(
    validateReleaseGate(root, { missingHeading: ["start/gone.mdx", "start/old.mdx"] }).some((e) =>
      e.includes("does not exist"),
    ),
  );
  assert.ok(
    validateReleaseGate(root, { missingHeading: ["start/old.mdx", "start/gone.mdx"] }).some((e) =>
      e.includes("sorted"),
    ),
  );
});

test("release gate wants one-sentence descriptions", (t) => {
  const root = fixture(t);
  page(root, "start/two.mdx", '"Do one thing. Then do another."', WORKS);
  page(root, "start/block.mdx", ">", WORKS);
  page(root, "start/ok.mdx", '"Connect Gina, then run a first request."', WORKS);
  const errors = validateReleaseGate(root);
  assert.deepEqual(errors, [
    "Description must be one sentence on one line: start/block.mdx",
    "Description must be one sentence on one line: start/two.mdx",
  ]);
});

test("release gate rejects hardcoded skill counts outside the allowlist", (t) => {
  const root = fixture(t);
  page(
    root,
    "start/count.mdx",
    '"Add the skills."',
    WORKS + "\nThe plugin ships four research skills.\n",
  );
  page(
    root,
    "start/list.mdx",
    '"Add the skills."',
    WORKS + "\nUse one of the skills. Install 2 skills.\n",
  );
  page(root, "start/fence.mdx", '"Add the skills."', WORKS + "\n```\nfour skills\n```\n");
  const errors = validateReleaseGate(root);
  assert.equal(errors.length, 2);
  assert.ok(errors[0].includes("start/count.mdx") && errors[0].includes("four research skills"));
  assert.ok(errors[1].includes("start/list.mdx") && errors[1].includes("2 skills"));
  assert.deepEqual(
    validateReleaseGate(root, { skillCounts: ["start/count.mdx", "start/list.mdx"] }),
    [],
  );
  assert.ok(
    validateReleaseGate(root, {
      skillCounts: ["start/count.mdx", "start/fence.mdx", "start/list.mdx"],
    }).some((e) => e.includes("Remove start/fence.mdx")),
  );
});

test("LP contract gate detects inventory and validated-example drift", async (t) => {
  const { validateLpContract } = await import("./lp-contract.mjs");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gina-lp-contract-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const root = path.join(repo, "docs");
  const spot = path.join(root, "spot-mcp");
  fs.mkdirSync(spot, { recursive: true });
  fs.mkdirSync(path.join(repo, "tools/docs"), { recursive: true });
  for (const file of ["features.mdx", "liquidity-positions.mdx"])
    fs.copyFileSync(path.resolve("docs/spot-mcp", file), path.join(spot, file));
  fs.copyFileSync(
    path.resolve("tools/docs/lp-contract.snapshot.json"),
    path.join(repo, "tools/docs/lp-contract.snapshot.json"),
  );
  assert.deepEqual(validateLpContract(root), []);
  fs.appendFileSync(path.join(spot, "features.mdx"), "\n| `unknownTool` | Drift |\n");
  assert.ok(validateLpContract(root).some((error) => error.includes("inventory")));
  const guide = path.join(spot, "liquidity-positions.mdx");
  fs.writeFileSync(guide, fs.readFileSync(guide, "utf8").replace('"limit": 10', '"limit": 999'));
  assert.ok(validateLpContract(root).some((error) => error.includes("examples changed")));
});

function skillsFixture(t, { indexed, onDisk }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gina-skills-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "skills/index.json"),
    JSON.stringify({ version: 1, skills: indexed.map(([pkg, id]) => ({ id, package: pkg })) }),
  );
  for (const [pkg, id] of onDisk)
    fs.mkdirSync(path.join(repo, "plugins", pkg, "skills", id), { recursive: true });
  return repo;
}

test("skill coverage requires every indexed skill of every package in backticks", (t) => {
  const skills = [
    ["ask-gina", "research-spot-tokens"],
    ["ask-gina-spot", "lp-pool-scan"],
    ["ask-gina-spot", "lp-rebalancing-playbook"],
  ];
  const repo = skillsFixture(t, { indexed: skills, onDisk: skills });
  const page = "`research-spot-tokens` `lp-pool-scan` `lp-rebalancing-playbook`";
  assert.deepEqual(validateSkillCoverage(repo, page), []);
  assert.deepEqual(validateSkillCoverage(repo, "`research-spot-tokens` `lp-pool-scan`"), [
    "Undocumented skill: lp-rebalancing-playbook",
  ]);
  // A bare mention without backticks does not count.
  assert.deepEqual(
    validateSkillCoverage(repo, "`research-spot-tokens` lp-pool-scan `lp-rebalancing-playbook`"),
    ["Undocumented skill: lp-pool-scan"],
  );
});

test("skill coverage also catches skill directories missing from a stale index", (t) => {
  const repo = skillsFixture(t, {
    indexed: [["ask-gina", "research-spot-tokens"]],
    onDisk: [
      ["ask-gina", "research-spot-tokens"],
      ["ask-gina-spot", "lp-pool-scan"],
    ],
  });
  assert.deepEqual(validateSkillCoverage(repo, "`research-spot-tokens`"), [
    "Undocumented skill: lp-pool-scan",
  ]);
});

test("skill coverage fails closed on a missing or malformed index", (t) => {
  const repo = skillsFixture(t, { indexed: [], onDisk: [] });
  fs.writeFileSync(path.join(repo, "skills/index.json"), "{}");
  assert.match(validateSkillCoverage(repo, "")[0], /skills array/);
  fs.rmSync(path.join(repo, "skills/index.json"));
  assert.match(validateSkillCoverage(repo, "")[0], /Cannot read skills\/index\.json/);
});

test("the checked-in skills index is fully documented", () => {
  const repo = path.resolve(".");
  const page = ["plugins-and-skills", "skills-catalog"]
    .map((name) => fs.readFileSync(path.join(repo, `docs/agents/${name}.mdx`), "utf8"))
    .join("\n");
  assert.deepEqual(validateSkillCoverage(repo, page), []);
});
