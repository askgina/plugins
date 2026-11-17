import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cell, table } from "./skills-catalog.mjs";

// Renders one native-tools page per write venue from tools/docs/venue-tools.json. The catalog is
// the only place that lists a venue's native tools and their annotation classes, so removing or
// reclassifying a tool is a one-line edit followed by `node tools/docs/venue-tools.mjs`.
// `node tools/docs/check.mjs` fails when a page drifts from the catalog.
export const CATALOG_FILE = "tools/docs/venue-tools.json";
export const VENUE_PAGES = {
  perps: "docs/perps-mcp/tools.mdx",
  predictions: "docs/predictions-mcp/tools.mdx",
};
const REGENERATE = "run `node tools/docs/venue-tools.mjs`";
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const SANDBOX_CLASS = "sandbox";
const EXECUTE_CLASS = "execute";

const flag = (hints, key) => (key in hints ? String(hints[key]) : "not set");

function validCatalog(catalog) {
  const errors = [];
  if (catalog?.version !== 1 || typeof catalog.classes !== "object" || !catalog.venues)
    return [`${CATALOG_FILE} must be version 1 with classes and venues.`];
  for (const [id, entry] of Object.entries(catalog.classes)) {
    const hints = entry?.hints;
    if (typeof entry?.title !== "string" || typeof entry.meaning !== "string")
      errors.push(`Class ${id} needs a title and a meaning.`);
    if (
      typeof hints !== "object" ||
      Object.keys(hints).some((key) => !HINTS.includes(key) || typeof hints[key] !== "boolean") ||
      !("readOnlyHint" in hints) ||
      !("destructiveHint" in hints) ||
      !("openWorldHint" in hints)
    )
      errors.push(`Class ${id} must set readOnlyHint, destructiveHint and openWorldHint.`);
  }
  for (const [venue, entry] of Object.entries(catalog.venues)) {
    const names = new Set();
    const bashOnly = new Set();
    if (!VENUE_PAGES[venue]) errors.push(`Venue ${venue} has no page in VENUE_PAGES.`);
    if (!/^[a-z0-9-]+$/.test(entry.package ?? "") || !/^https:\/\//.test(entry.endpoint ?? ""))
      errors.push(`Venue ${venue} needs a package and an https endpoint.`);
    for (const tool of entry.tools ?? []) {
      if (names.has(tool?.name)) errors.push(`Venue ${venue} lists ${tool.name} twice.`);
      names.add(tool?.name);
      if (typeof tool?.name !== "string" || !catalog.classes[tool.class])
        errors.push(`Venue ${venue} has a tool without a name or a known class: ${tool?.name}`);
      if (typeof tool?.purpose !== "string" || tool.purpose.trim() === "")
        errors.push(`Venue ${venue} tool ${tool?.name} needs a purpose.`);
      if (
        tool?.bashBlocked !== undefined &&
        (tool.bashBlocked !== true || tool.class !== EXECUTE_CLASS)
      )
        errors.push(
          `Venue ${venue} tool ${tool.name} can set bashBlocked only to true in the ${EXECUTE_CLASS} class.`,
        );
      if (
        tool?.next !== undefined &&
        (typeof tool.next?.tool !== "string" ||
          tool.next.tool.trim() === "" ||
          typeof tool.next.when !== "string" ||
          tool.next.when.trim() === "")
      )
        errors.push(`Venue ${venue} tool ${tool.name} needs a next tool and a when.`);
    }
    for (const tool of entry.bashOnly ?? []) {
      if (bashOnly.has(tool?.name) || names.has(tool?.name))
        errors.push(`Venue ${venue} lists ${tool?.name} as native and bash-only or twice.`);
      bashOnly.add(tool?.name);
      if (typeof tool?.reason !== "string" || tool.reason.trim() === "")
        errors.push(`Venue ${venue} bash-only tool ${tool?.name} needs a reason.`);
    }
    const sandbox = (entry.tools ?? []).filter((tool) => tool.class === SANDBOX_CLASS);
    if (sandbox.length !== 1 || sandbox[0].name !== "bash")
      errors.push(`Venue ${venue} must list bash once, in the ${SANDBOX_CLASS} class.`);
    const verify = (entry.tools ?? []).find((tool) => tool.name === entry.verify?.tool);
    if (!verify || !catalog.classes[verify.class]?.hints.readOnlyHint)
      errors.push(`Venue ${venue} verify tool must be a listed read-only tool.`);
    if (typeof entry.verify?.prompt !== "string" || entry.verify.prompt.trim() === "")
      errors.push(`Venue ${venue} verify needs a prompt.`);
  }
  return errors;
}

/** Render the native-tools page of one venue from the parsed catalog. */
export function renderVenuePage(catalog, venue) {
  const errors = validCatalog(catalog);
  if (errors.length) throw new Error(errors.join("\n"));
  const entry = catalog.venues[venue];
  if (!entry) throw new Error(`${CATALOG_FILE} has no venue ${venue}.`);
  const used = Object.keys(catalog.classes).filter((id) =>
    entry.tools.some((tool) => tool.class === id),
  );
  const classRows = used.map((id) => {
    const { title, hints } = catalog.classes[id];
    return [cell(title), ...HINTS.map((key) => flag(hints, key))];
  });
  const sections = used.map((id) => {
    const { title, meaning } = catalog.classes[id];
    const rows = entry.tools
      .filter((tool) => tool.class === id)
      .map((tool) => ["`" + tool.name + "`", cell(tool.purpose)]);
    return `## ${title}\n\n${meaning}\n\n${table(["Tool", "Use it for"], rows)}\n`;
  });
  const bashRows = entry.bashOnly.map((tool) => ["`" + tool.name + "`", cell(tool.reason)]);
  const blocked = entry.tools.filter((tool) => tool.bashBlocked);
  const nextRows = entry.tools
    .filter((tool) => tool.next)
    .map((tool) => ["`" + tool.name + "`", "`" + tool.next.tool + "`", cell(tool.next.when)]);
  const endpoint = "`" + entry.endpoint + "`";
  return [
    `---
title: "${entry.title} native tools"
description: "Every ${entry.title} MCP native tool, grouped by annotation class, with what each class can change."
pageType: reference
---

{/* Generated from ${CATALOG_FILE} by tools/docs/venue-tools.mjs. Edit the catalog, then run \`node tools/docs/venue-tools.mjs\`. */}

${entry.title} MCP at ${endpoint} publishes each tool below as a native MCP tool beside \`bash\`. They use the same authenticated account, and your client can show and gate each action by its own annotations. Call native tools directly. Credential-bearing destination calls must not be wrapped in \`bash\`.

Annotations are the server's own declaration. A client can use them to decide when to ask you before a call. They are hints, not enforcement, so keep approving every money-moving action yourself. Run \`tools/list\` on your connection to see what your deployment advertises.
`,
    `## Annotation classes\n\n${table(["Class", ...HINTS.map((key) => "`" + key + "`")], classRows)}\n`,
    ...sections,
    bashRows.length
      ? `## Host tools that are not native\n\nThese host tools are not native tools. Sandbox-only tools run inside \`bash\` with \`host-tools\`.\n\n${table(["Tool", "Why"], bashRows)}\n`
      : "",
    nextRows.length
      ? `## Typed next steps\n\nThese tools return a typed \`next\` list beside their result. Each entry names a tool and arguments your client can offer as a button. Your client still shows the call and waits for your approval before it runs.\n\n${table(["Tool", "Suggests", "When"], nextRows)}\n`
      : "",
    blocked.length
      ? `## Native only, blocked in bash\n\n${blocked.map((tool) => "`" + tool.name + "`").join(", ")} ${blocked.length === 1 ? "is a native tool" : "are native tools"} only. Inside \`bash\`, both \`host-tools\` and \`ts-exec\` refuse the call with \`HOST_TOOL_LIVE_CONFIRMATION_REQUIRED\`, so your MCP client can show the call and ask you first.\n`
      : "",
    `## Check that it works

1. Open your client's tool list for ${endpoint}.
2. Confirm \`bash\` and the tools above appear, and that every tool in the ${catalog.classes[EXECUTE_CLASS].title} class is marked destructive.
3. Ask “${entry.verify.prompt}” and check that the assistant calls \`${entry.verify.tool}\`. Do not approve an ${catalog.classes[EXECUTE_CLASS].title} call you did not ask for.
`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Errors when a venue page is missing or differs from the catalog, or the catalog contradicts a package. */
export function validateVenueTools(repo) {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(path.join(repo, CATALOG_FILE), "utf8"));
  } catch (error) {
    return [`Cannot read ${CATALOG_FILE}: ${error.message}`];
  }
  const errors = validCatalog(catalog);
  if (errors.length) return errors;
  for (const [venue, entry] of Object.entries(catalog.venues)) {
    const mcpFile = path.join(repo, "plugins", entry.package, ".mcp.json");
    let url;
    try {
      url = JSON.parse(fs.readFileSync(mcpFile, "utf8")).mcpServers?.[entry.package]?.url;
    } catch {
      errors.push(`Cannot read plugins/${entry.package}/.mcp.json for the ${venue} catalog.`);
      continue;
    }
    if (url !== entry.endpoint)
      errors.push(`${CATALOG_FILE} endpoint for ${venue} differs from plugins/${entry.package}.`);
    const page = path.join(repo, VENUE_PAGES[venue]);
    if (!fs.existsSync(page)) errors.push(`Missing ${VENUE_PAGES[venue]}; ${REGENERATE}.`);
    else if (fs.readFileSync(page, "utf8") !== renderVenuePage(catalog, venue))
      errors.push(`${VENUE_PAGES[venue]} differs from ${CATALOG_FILE}; ${REGENERATE}.`);
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  if (process.argv.includes("--check")) {
    const errors = validateVenueTools(repo);
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else console.log(`Venue tool pages match ${CATALOG_FILE}.`);
  } else {
    const catalog = JSON.parse(fs.readFileSync(path.join(repo, CATALOG_FILE), "utf8"));
    for (const [venue, page] of Object.entries(VENUE_PAGES)) {
      fs.writeFileSync(path.join(repo, page), renderVenuePage(catalog, venue));
      console.log(`Wrote ${page} from ${CATALOG_FILE}.`);
    }
  }
}
