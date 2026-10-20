import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Renders docs/agents/skills-catalog.mdx from skills/index.json. Docs link to this page instead of
// repeating skill names or counts, and `node tools/docs/check.mjs` fails when the page drifts.
export const CATALOG_PAGE = "docs/agents/skills-catalog.mdx";
const INDEX_FILE = "skills/index.json";
const SOURCE_BASE = "https://github.com/askgina/plugins/tree/main/";
const REGENERATE = "run `bun run docs:catalog`";

const HEADER = `---
title: "Skills catalog"
description: "Every Ask Gina agent skill, the plugin that ships it and the MCP server it works with."
pageType: reference
---

{/* Generated from skills/index.json by tools/docs/skills-catalog.mjs. Edit the index, then run \`bun run docs:catalog\`. */}

Each skill ships in one plugin package. To install a package, follow [install for your host](/agents/plugins-and-skills#install-for-your-host).

A skill marked as served over MCP is also returned by its MCP server, so a client connected only to that server can read it without installing the plugin. Other skills need the plugin or a copy of the skill directory.
`;

// Markdown table cells cannot hold newlines or bare pipes, and MDX treats braces and angle
// brackets as JSX.
function cell(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\|{}<>]/g, (char) => "\\" + char);
}

function table(header, rows) {
  const widths = header.map((title, column) =>
    Math.max(3, title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) =>
    "| " + cells.map((value, column) => value.padEnd(widths[column])).join(" | ") + " |";
  return [
    line(header),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(row)),
  ].join("\n");
}

function validSkill(skill) {
  return (
    typeof skill?.id === "string" &&
    /^[a-z0-9-]+$/.test(skill.id) &&
    typeof skill.package === "string" &&
    /^[a-z0-9-]+$/.test(skill.package) &&
    typeof skill.path === "string" &&
    /^plugins\/[a-z0-9-]+\/skills\/[a-z0-9-]+$/.test(skill.path) &&
    typeof skill.description === "string" &&
    skill.description.trim().length > 0 &&
    typeof skill.mcpUrl === "string" &&
    /^https:\/\//.test(skill.mcpUrl) &&
    typeof skill.mcpServed === "boolean"
  );
}

/** Render the catalog page for a parsed `skills/index.json`. Rows sort by package, then skill id. */
export function renderSkillsCatalog(index) {
  if (index?.version !== 1 || !Array.isArray(index.skills))
    throw new Error(`${INDEX_FILE} must be version 1 with a skills array.`);
  for (const skill of index.skills)
    if (!validSkill(skill))
      throw new Error(`${INDEX_FILE} has an invalid skill entry: ${JSON.stringify(skill?.id)}`);
  const skills = [...index.skills].sort(
    (a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id),
  );
  const rows = skills.map((skill) => [
    "[`" + skill.id + "`](" + SOURCE_BASE + skill.path + ")",
    "`" + skill.package + "`",
    "`" + skill.mcpUrl + "`",
    skill.mcpServed ? "Yes" : "No",
    cell(skill.description),
  ]);
  return (
    HEADER +
    "\n" +
    table(["Skill", "Plugin", "MCP server", "Served over MCP", "Use it for"], rows) +
    "\n"
  );
}

/** Errors when the committed catalog page is missing or differs from the rendered index. */
export function validateSkillsCatalog(repo) {
  let expected;
  try {
    expected = renderSkillsCatalog(
      JSON.parse(fs.readFileSync(path.join(repo, INDEX_FILE), "utf8")),
    );
  } catch (error) {
    return [`Cannot render the skills catalog: ${error.message}`];
  }
  const file = path.join(repo, CATALOG_PAGE);
  if (!fs.existsSync(file)) return [`Missing ${CATALOG_PAGE}; ${REGENERATE}.`];
  if (fs.readFileSync(file, "utf8") !== expected)
    return [`${CATALOG_PAGE} differs from ${INDEX_FILE}; ${REGENERATE}.`];
  return [];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  if (process.argv.includes("--check")) {
    const errors = validateSkillsCatalog(repo);
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else console.log(`${CATALOG_PAGE} matches ${INDEX_FILE}.`);
  } else {
    const index = JSON.parse(fs.readFileSync(path.join(repo, INDEX_FILE), "utf8"));
    fs.writeFileSync(path.join(repo, CATALOG_PAGE), renderSkillsCatalog(index));
    console.log(`Wrote ${CATALOG_PAGE} from ${INDEX_FILE}.`);
  }
}
