import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  EXECUTE_SCOPE,
  GINA_PREDICTION_RENDER_TOOL_NAMES,
  GINA_READ_TOOL_CATALOG,
  GinaReadToolCatalogJsonSchema,
  PRODUCTION_MCP_URL,
  READ_SCOPE,
  RELEASE_VERSION,
  SOURCE_COMMIT,
  catalogSha,
  getGinaReadToolAnnotations,
  getGinaReadToolFamily,
  isGinaMcpAppBoundReadTool,
  isGinaPredictionRenderToolName,
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
  "predictions.getPredictionMarketDetails",
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

const EXPECTED_PREDICTION_SKILL_TOOLS = [
  "predictions.searchPredictionMarkets",
  "predictions.getPredictionOrderbook",
  "predictions.fetchPolymarketData",
  "predictions.fetchPolymarketHistory",
  "predictions.getPolymarketPositions",
  "predictions.getPolymarketOrderHistory",
  "predictions.renderPredictionPodium",
  "predictions.renderPredictionBinaryMarket",
  "predictions.renderPredictionCollection",
] as const;

const familyFromName = (name: (typeof EXPECTED_TOOL_NAMES)[number]) =>
  name.startsWith("gina.") ? "portfolio" : name.split(".", 1)[0];

describe("@askgina/contracts", () => {
  it.effect("publishes the exact 30-name catalog projection", () =>
    Effect.sync(() => {
      assert.strictEqual(GINA_READ_TOOL_CATALOG.length, 30);
      assert.deepStrictEqual(listCatalogToolNames(), EXPECTED_TOOL_NAMES);
      assert.deepStrictEqual(
        GINA_READ_TOOL_CATALOG.map((tool) => Object.keys(tool)),
        Array.from({ length: 30 }, () => [
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
      assert.isFalse(isGinaReadToolName("predictions.renderPredictionPodium"));
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

  it.effect("publishes prediction renderer names and the public prediction skill tools", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(GINA_PREDICTION_RENDER_TOOL_NAMES, [
        "predictions.renderPredictionPodium",
        "predictions.renderPredictionBinaryMarket",
        "predictions.renderPredictionCollection",
      ]);
      assert.isTrue(
        GINA_PREDICTION_RENDER_TOOL_NAMES.every((name) => isGinaPredictionRenderToolName(name)),
      );
      assert.isFalse(isGinaPredictionRenderToolName("predictions.searchPredictionMarkets"));
      assert.isFalse(isGinaPredictionRenderToolName(undefined));
    }),
  );

  it.effect("publishes the exact skill ownership definitions", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        ASK_GINA_SKILL_DEFINITIONS.map(({ name }) => name),
        [
          "review-gina-account",
          "research-spot-tokens",
          "research-hyperliquid",
          "research-prediction-markets",
        ],
      );

      for (const skill of ASK_GINA_SKILL_DEFINITIONS) {
        if (skill.name === "research-prediction-markets") {
          assert.deepStrictEqual(skill.tools, EXPECTED_PREDICTION_SKILL_TOOLS);
          continue;
        }

        const family =
          skill.name === "review-gina-account"
            ? "portfolio"
            : skill.name === "research-spot-tokens"
              ? "spot"
              : "perps";
        assert.deepStrictEqual(
          skill.tools,
          GINA_READ_TOOL_CATALOG.filter((tool) => tool.family === family).map((tool) => tool.name),
        );
      }
    }),
  );

  it.effect("pins endpoints, scopes, and source compatibility", () =>
    Effect.gen(function* () {
      assert.strictEqual(PRODUCTION_MCP_URL, "https://askgina.ai/ai/gina/mcp");
      assert.strictEqual(READ_SCOPE, "tools:read");
      assert.strictEqual(EXECUTE_SCOPE, "tools:execute");
      assert.strictEqual(RELEASE_VERSION, "0.1.0");
      assert.strictEqual(SOURCE_COMMIT, "908af9015f1e87cf1ba4893226d149905e74df4a");

      const computedCatalogSha = createHash("sha256")
        .update(yield* Schema.encodeEffect(GinaReadToolCatalogJsonSchema)(GINA_READ_TOOL_CATALOG))
        .digest("hex");
      assert.match(catalogSha, /^[a-f0-9]{64}$/);
      assert.strictEqual(catalogSha, computedCatalogSha);
    }),
  );
});
