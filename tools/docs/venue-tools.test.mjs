import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOG_FILE, VENUE_PAGES, renderVenuePage, validateVenueTools } from "./venue-tools.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const realCatalog = () => JSON.parse(fs.readFileSync(path.join(repo, CATALOG_FILE), "utf8"));

const readHints = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const catalog = (overrides = {}) => ({
  version: 1,
  classes: {
    "read-external": { title: "Read", hints: readHints, meaning: "Reads data." },
    execute: {
      title: "Execute",
      hints: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      meaning: "Moves funds.",
    },
    sandbox: {
      title: "Sandbox",
      hints: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      meaning: "Runs commands.",
    },
  },
  venues: {
    perps: {
      title: "Perps",
      package: "ask-gina-perps",
      endpoint: "https://askgina.ai/ai/perps/mcp",
      verify: { tool: "getPrice", prompt: "Show a price." },
      tools: [
        { name: "getPrice", class: "read-external", purpose: "One price" },
        { name: "placeOrder", class: "execute", purpose: "Place an order" },
        { name: "bash", class: "sandbox", purpose: "Scripts" },
      ],
      bashOnly: [{ name: "scratch", reason: "Needs sandbox state." }],
      ...overrides,
    },
  },
});

test("renders classes, tools by class, bash-only tools and a verification step", () => {
  const page = renderVenuePage(catalog(), "perps");
  assert.match(page, /^---\ntitle: "Perps native tools"\n/);
  assert.match(page, /\npageType: reference\n/);
  assert.match(page, /\| Execute\s+\| false\s+\| true\s+\| not set\s+\| true\s+\|/);
  assert.match(page, /## Execute\n\nMoves funds\.\n\n\| Tool\s+\| Use it for\s+\|/);
  assert.match(page, /`placeOrder`\s+\| Place an order\s+\|/);
  assert.match(page, /`scratch`\s+\| Needs sandbox state\.\s+\|/);
  assert.match(page, /\n## Check that it works\n/);
  assert.match(page, /calls `getPrice`/);
});

test("lists an unset annotation as not set", () => {
  const value = catalog();
  value.classes["read-external"].hints = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  };
  assert.match(
    renderVenuePage(value, "perps"),
    /\| Read\s+\| true\s+\| false\s+\| not set\s+\| true\s+\|/,
  );
});

test("rejects a catalog that breaks its own rules", () => {
  const cases = [
    [
      { tools: [{ name: "a", class: "unknown", purpose: "x" }, ...catalog().venues.perps.tools] },
      /known class/,
    ],
    [
      {
        tools: [
          ...catalog().venues.perps.tools,
          { name: "getPrice", class: "read-external", purpose: "x" },
        ],
      },
      /twice/,
    ],
    [{ tools: catalog().venues.perps.tools.filter((tool) => tool.name !== "bash") }, /bash once/],
    [{ bashOnly: [{ name: "getPrice", reason: "x" }] }, /native and bash-only/],
    [{ verify: { tool: "placeOrder", prompt: "Place it." } }, /read-only tool/],
    [
      {
        tools: [{ name: "bash", class: "sandbox", purpose: " " }, catalog().venues.perps.tools[0]],
      },
      /needs a purpose/,
    ],
  ];
  for (const [override, pattern] of cases)
    assert.throws(() => renderVenuePage(catalog(override), "perps"), pattern);
});

test("the committed catalog lists bash and every execute tool as destructive", () => {
  const value = realCatalog();
  assert.ok(value.classes.execute.hints.destructiveHint);
  assert.ok(value.classes.sandbox.hints.destructiveHint);
  for (const entry of Object.values(value.venues))
    for (const tool of entry.tools)
      if (
        /^(place|cancel|modify|adjust|deposit|trade|manage|redeem|split|topUp|withdraw|hyperliquidWithdraw)/.test(
          tool.name,
        )
      )
        assert.equal(tool.class, "execute", `${tool.name} must be in the execute class`);
});

test("validateVenueTools passes for the repository and flags a stale page", (t) => {
  assert.deepEqual(validateVenueTools(repo), []);

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "venue-tools-"));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  fs.mkdirSync(path.join(copy, "tools/docs"), { recursive: true });
  fs.copyFileSync(path.join(repo, CATALOG_FILE), path.join(copy, CATALOG_FILE));
  for (const entry of Object.values(realCatalog().venues)) {
    const dir = path.join(copy, "plugins", entry.package);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(repo, "plugins", entry.package, ".mcp.json"),
      path.join(dir, ".mcp.json"),
    );
  }
  for (const page of Object.values(VENUE_PAGES)) {
    fs.mkdirSync(path.dirname(path.join(copy, page)), { recursive: true });
    fs.copyFileSync(path.join(repo, page), path.join(copy, page));
  }
  assert.deepEqual(validateVenueTools(copy), []);

  fs.appendFileSync(path.join(copy, VENUE_PAGES.perps), "\nstale\n");
  assert.match(validateVenueTools(copy)[0], /docs\/perps-mcp\/tools\.mdx differs from/);

  fs.rmSync(path.join(copy, VENUE_PAGES.predictions));
  assert.ok(
    validateVenueTools(copy).some((error) =>
      /Missing docs\/predictions-mcp\/tools\.mdx/.test(error),
    ),
  );
});
