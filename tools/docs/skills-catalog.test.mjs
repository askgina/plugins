import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CATALOG_PAGE, renderSkillsCatalog, validateSkillsCatalog } from "./skills-catalog.mjs";

const skill = (overrides = {}) => ({
  id: "research-spot-tokens",
  package: "ask-gina",
  path: "plugins/ask-gina/skills/research-spot-tokens",
  description: "Research live spot prices.",
  mcpEndpoint: "gina",
  mcpUrl: "https://askgina.ai/ai/gina/mcp",
  mcpServed: true,
  files: [],
  ...overrides,
});

const index = (...skills) => ({ version: 1, skills });

function repoWith(t, value) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "skills-catalog-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, "skills"), { recursive: true });
  fs.mkdirSync(path.join(repo, path.dirname(CATALOG_PAGE)), { recursive: true });
  fs.writeFileSync(path.join(repo, "skills/index.json"), JSON.stringify(value));
  return repo;
}

test("renders one row per skill with package, MCP server and served flag", () => {
  const page = renderSkillsCatalog(
    index(
      skill(),
      skill({
        id: "lp-pool-scan",
        package: "ask-gina-spot",
        path: "plugins/ask-gina-spot/skills/lp-pool-scan",
        mcpUrl: "https://askgina.ai/ai/spot/mcp",
        mcpServed: false,
      }),
    ),
  );
  const rows = page.split("\n").filter((line) => line.startsWith("| [`"));
  assert.equal(rows.length, 2);
  const [spot, read] = [rows[1], rows[0]].map((row) => row.split("|").map((c) => c.trim()));
  // Rows sort by package, so the read-only plugin comes first.
  assert.match(
    read[1],
    /^\[`research-spot-tokens`\]\(https:\/\/github\.com\/askgina\/plugins\/tree\/main\/plugins\/ask-gina\/skills\/research-spot-tokens\)$/,
  );
  assert.equal(read[2], "`ask-gina`");
  assert.equal(read[3], "`https://askgina.ai/ai/gina/mcp`");
  assert.equal(read[4], "Yes");
  assert.equal(spot[2], "`ask-gina-spot`");
  assert.equal(spot[3], "`https://askgina.ai/ai/spot/mcp`");
  assert.equal(spot[4], "No");
});

test("output does not depend on the order of the index", () => {
  const a = skill({ id: "a-skill" });
  const b = skill({ id: "b-skill", path: "plugins/ask-gina/skills/b-skill" });
  assert.equal(renderSkillsCatalog(index(a, b)), renderSkillsCatalog(index(b, a)));
});

test("escapes characters that break MDX tables", () => {
  const page = renderSkillsCatalog(
    index(skill({ description: "Compare a|b\nand <tag> {value} with a path\\x." })),
  );
  const row = page.split("\n").find((line) => line.startsWith("| [`"));
  assert.ok(row.includes("a\\|b and \\<tag\\> \\{value\\} with a path\\\\x."));
  assert.equal(row.split(/(?<!\\)\|/).length, 7);
});

test("rejects an index that is not version 1 or has an invalid skill", () => {
  assert.throws(() => renderSkillsCatalog({ version: 2, skills: [] }), /version 1/);
  assert.throws(() => renderSkillsCatalog({ version: 1 }), /skills array/);
  assert.throws(() => renderSkillsCatalog(index(skill({ id: "Bad Id" }))), /invalid skill/);
  assert.throws(() => renderSkillsCatalog(index(skill({ path: "../etc" }))), /invalid skill/);
  assert.throws(() => renderSkillsCatalog(index(skill({ mcpServed: "yes" }))), /invalid skill/);
});

test("validation passes when the page matches the index", (t) => {
  const value = index(skill());
  const repo = repoWith(t, value);
  fs.writeFileSync(path.join(repo, CATALOG_PAGE), renderSkillsCatalog(value));
  assert.deepEqual(validateSkillsCatalog(repo), []);
});

test("validation fails when the page is missing or stale", (t) => {
  const repo = repoWith(t, index(skill()));
  assert.match(validateSkillsCatalog(repo)[0], /Missing docs\/agents\/skills-catalog\.mdx/);
  fs.writeFileSync(path.join(repo, CATALOG_PAGE), renderSkillsCatalog(index()));
  assert.match(validateSkillsCatalog(repo)[0], /differs from skills\/index\.json/);
  // A new skill in the index without regenerating the page is drift.
  const added = index(
    skill(),
    skill({ id: "new-skill", path: "plugins/ask-gina/skills/new-skill" }),
  );
  fs.writeFileSync(path.join(repo, "skills/index.json"), JSON.stringify(added));
  fs.writeFileSync(path.join(repo, CATALOG_PAGE), renderSkillsCatalog(index(skill())));
  assert.match(validateSkillsCatalog(repo)[0], /bun run docs:catalog/);
});

test("validation fails closed on an unreadable index", (t) => {
  const repo = repoWith(t, index());
  fs.writeFileSync(path.join(repo, "skills/index.json"), "not json");
  assert.match(validateSkillsCatalog(repo)[0], /Cannot render the skills catalog/);
});

test("the checked-in catalog page matches the checked-in index", () => {
  assert.deepEqual(validateSkillsCatalog(path.resolve(".")), []);
});
