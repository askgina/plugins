import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  EXECUTE_SCOPE,
  EXECUTION_HANDOFF_ORIGIN,
  EXECUTION_HANDOFF_PATHNAME,
  GINA_READ_TOOL_CATALOG,
  GinaReadToolCatalogJsonSchema,
  PRODUCTION_MCP_URL,
  READ_SCOPE,
  RELEASE_VERSION,
  SOURCE_COMMIT,
  buildExecutionHandoffUrl,
  catalogSha,
  getGinaReadToolAnnotations,
  getGinaReadToolFamily,
  isGinaMcpAppBoundReadTool,
  isGinaReadToolName,
  listCatalogToolNames,
} from "@askgina/contracts";

const EXPECTED_TOOL_NAMES = [
  "gina.getCrosschainPortfolio",
  "gina.getAccountAddresses",
  "gina.listScheduledPrompts",
  "spot.getTokenMetadata",
  "spot.getTokenChart",
  "spot.getSimplePrice",
  "spot.fetchSwapHistory",
  "perps.getHyperliquidAccount",
  "perps.getHyperliquidPositions",
  "perps.getHyperliquidOpenOrders",
  "perps.getHyperliquidPortfolio",
  "perps.getHyperliquidMarkets",
  "perps.getHyperliquidPrice",
  "perps.getHyperliquidPrices",
  "perps.getHyperliquidAssetData",
  "perps.getHyperliquidPerpDexes",
  "perps.fetchHyperliquidTrades",
  "perps.fetchHyperliquidCandles",
  "perps.fetchHyperliquidOrderBook",
  "perps.createHyperliquidTable",
  "perps.executeSqlQuery",
  "predictions.searchPredictionMarkets",
  "predictions.getExpiringMarkets",
  "predictions.getPredictionOrderbook",
  "predictions.getSeriesMarket",
  "predictions.fetchPolymarketData",
  "predictions.fetchPolymarketHistory",
  "predictions.getPolymarketPositions",
  "predictions.getPolymarketOrderHistory",
] as const;

const EXPECTED_CLOSED_WORLD_TOOLS: readonly string[] = [
  "gina.getAccountAddresses",
  "gina.listScheduledPrompts",
  "spot.fetchSwapHistory",
  "perps.executeSqlQuery",
];

const EXPECTED_MCP_APP_BOUND_TOOLS: readonly string[] = [
  "spot.getTokenChart",
  "perps.getHyperliquidPositions",
  "perps.fetchHyperliquidCandles",
  "predictions.getPolymarketPositions",
];

const familyFromName = (name: (typeof EXPECTED_TOOL_NAMES)[number]) =>
  name.startsWith("gina.") ? "portfolio" : name.split(".", 1)[0];

describe("@askgina/contracts", () => {
  it.effect("publishes the exact 29-name catalog projection", () =>
    Effect.sync(() => {
      assert.strictEqual(GINA_READ_TOOL_CATALOG.length, 29);
      assert.deepStrictEqual(listCatalogToolNames(), EXPECTED_TOOL_NAMES);
      assert.deepStrictEqual(
        GINA_READ_TOOL_CATALOG.map((tool) => Object.keys(tool)),
        Array.from({ length: 29 }, () => [
          "name",
          "family",
          "readOnlyHint",
          "destructiveHint",
          "openWorldHint",
          "mcpAppBound",
        ]),
      );
      assert.isTrue(EXPECTED_TOOL_NAMES.every((name) => isGinaReadToolName(name)));
      assert.isFalse(isGinaReadToolName("perps.placeOrder"));
      assert.isFalse(isGinaReadToolName(undefined));
    }),
  );

  it.effect("classifies every family and annotation", () =>
    Effect.sync(() => {
      for (const tool of GINA_READ_TOOL_CATALOG) {
        assert.isTrue(tool.readOnlyHint);
        assert.isFalse(tool.destructiveHint);
        assert.strictEqual(tool.family, familyFromName(tool.name));
        assert.strictEqual(getGinaReadToolFamily(tool.name), familyFromName(tool.name));
        assert.deepStrictEqual(getGinaReadToolAnnotations(tool.name), {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: !EXPECTED_CLOSED_WORLD_TOOLS.includes(tool.name),
        });
        assert.strictEqual(tool.mcpAppBound, EXPECTED_MCP_APP_BOUND_TOOLS.includes(tool.name));
        assert.strictEqual(isGinaMcpAppBoundReadTool(tool.name), tool.mcpAppBound);
      }

      assert.deepStrictEqual(
        GINA_READ_TOOL_CATALOG.filter((tool) => !tool.openWorldHint).map((tool) => tool.name),
        EXPECTED_CLOSED_WORLD_TOOLS,
      );
      assert.deepStrictEqual(
        GINA_READ_TOOL_CATALOG.filter((tool) => tool.mcpAppBound).map((tool) => tool.name),
        EXPECTED_MCP_APP_BOUND_TOOLS,
      );
    }),
  );

  it.effect("publishes the exact skill ownership and handoff definitions", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        ASK_GINA_SKILL_DEFINITIONS.map(({ name, handoffAgent, handoffExamplePrompt }) => ({
          name,
          handoffAgent,
          handoffExamplePrompt,
        })),
        [
          {
            name: "review-gina-account",
            handoffAgent: "gina",
            handoffExamplePrompt: "Create a daily 9 AM portfolio summary.",
          },
          {
            name: "research-spot-tokens",
            handoffAgent: "gina",
            handoffExamplePrompt: "Swap 0.5 ETH for USDC.",
          },
          {
            name: "research-hyperliquid",
            handoffAgent: "perps",
            handoffExamplePrompt: "Place a 1 ETH long with a 2500 USDC stop.",
          },
          {
            name: "research-prediction-markets",
            handoffAgent: "predictions",
            handoffExamplePrompt: "Buy 25 USDC of Yes on market 123.",
          },
        ],
      );

      for (const skill of ASK_GINA_SKILL_DEFINITIONS) {
        const family =
          skill.name === "review-gina-account"
            ? "portfolio"
            : skill.name === "research-spot-tokens"
              ? "spot"
              : skill.name === "research-hyperliquid"
                ? "perps"
                : "predictions";
        assert.deepStrictEqual(
          skill.tools,
          GINA_READ_TOOL_CATALOG.filter((tool) => tool.family === family).map((tool) => tool.name),
        );
      }
    }),
  );

  it.effect("pins endpoints, scopes, handoff encoding, and source compatibility", () =>
    Effect.gen(function* () {
      assert.strictEqual(PRODUCTION_MCP_URL, "https://askgina.ai/ai/gina/mcp");
      assert.strictEqual(EXECUTION_HANDOFF_ORIGIN, "https://askgina.ai");
      assert.strictEqual(EXECUTION_HANDOFF_PATHNAME, "/new");
      assert.strictEqual(READ_SCOPE, "tools:read");
      assert.strictEqual(EXECUTE_SCOPE, "tools:execute");
      assert.strictEqual(RELEASE_VERSION, "0.1.0");
      assert.strictEqual(SOURCE_COMMIT, "908af9015f1e87cf1ba4893226d149905e74df4a");

      const handoffUrl = buildExecutionHandoffUrl("perps", "long ETH + set stop? 50%");
      assert.strictEqual(
        handoffUrl,
        "https://askgina.ai/new?agent=perps&prompt=long%20ETH%20%2B%20set%20stop%3F%2050%25",
      );
      const parsedHandoffUrl = new URL(handoffUrl);
      assert.deepStrictEqual([...parsedHandoffUrl.searchParams.keys()], ["agent", "prompt"]);
      assert.strictEqual(parsedHandoffUrl.searchParams.get("agent"), "perps");
      assert.strictEqual(parsedHandoffUrl.searchParams.get("prompt"), "long ETH + set stop? 50%");

      const computedCatalogSha = createHash("sha256")
        .update(yield* Schema.encodeEffect(GinaReadToolCatalogJsonSchema)(GINA_READ_TOOL_CATALOG))
        .digest("hex");
      assert.match(catalogSha, /^[a-f0-9]{64}$/);
      assert.strictEqual(catalogSha, computedCatalogSha);
    }),
  );
});
