import { Schema } from "effect";

export const PRODUCTION_MCP_URL = "https://askgina.ai/ai/gina/mcp";

export const READ_SCOPE = "tools:read";
export const EXECUTE_SCOPE = "tools:execute";

export const GINA_MCP_APP_FAMILY_VALUES = ["spot", "perps", "predictions", "portfolio"] as const;
export type GinaMcpAppFamily = (typeof GINA_MCP_APP_FAMILY_VALUES)[number];

export type GinaReadToolAnnotations = Readonly<{
  readOnlyHint: true;
  destructiveHint: false;
  openWorldHint: boolean;
}>;

export type GinaReadToolCatalogEntry = GinaReadToolAnnotations &
  Readonly<{
    name: string;
    family: GinaMcpAppFamily;
    mcpAppBound: boolean;
  }>;

export const GINA_READ_TOOL_CATALOG = [
  {
    name: "gina.getCrosschainPortfolio",
    family: "portfolio",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "gina.getAccountAddresses",
    family: "portfolio",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    mcpAppBound: false,
  },
  {
    name: "gina.listScheduledPrompts",
    family: "portfolio",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    mcpAppBound: false,
  },
  {
    name: "spot.getTokenMetadata",
    family: "spot",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "spot.getTokenChart",
    family: "spot",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: true,
  },
  {
    name: "spot.getSimplePrice",
    family: "spot",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "spot.fetchSwapHistory",
    family: "spot",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidAccount",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidPositions",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: true,
  },
  {
    name: "perps.getHyperliquidOpenOrders",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidPortfolio",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidMarkets",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidPrice",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidPrices",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidAssetData",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.getHyperliquidPerpDexes",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.fetchHyperliquidTrades",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.fetchHyperliquidCandles",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: true,
  },
  {
    name: "perps.fetchHyperliquidOrderBook",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.createHyperliquidTable",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "perps.executeSqlQuery",
    family: "perps",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    mcpAppBound: false,
  },
  {
    name: "predictions.searchPredictionMarkets",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.getExpiringMarkets",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.getPredictionOrderbook",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.getSeriesMarket",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.getPredictionMarketDetails",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.fetchPolymarketData",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.fetchPolymarketHistory",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
  {
    name: "predictions.getPolymarketPositions",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: true,
  },
  {
    name: "predictions.getPolymarketOrderHistory",
    family: "predictions",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    mcpAppBound: false,
  },
] as const satisfies readonly GinaReadToolCatalogEntry[];

export type GinaReadToolName = (typeof GINA_READ_TOOL_CATALOG)[number]["name"];

export const GINA_PREDICTION_RENDER_TOOL_NAMES = [
  "predictions.renderPredictionPodium",
  "predictions.renderPredictionBinaryMarket",
  "predictions.renderPredictionCollection",
] as const;

export type GinaPredictionRenderToolName = (typeof GINA_PREDICTION_RENDER_TOOL_NAMES)[number];

export const isGinaPredictionRenderToolName = (
  name: unknown,
): name is GinaPredictionRenderToolName =>
  name === "predictions.renderPredictionPodium" ||
  name === "predictions.renderPredictionBinaryMarket" ||
  name === "predictions.renderPredictionCollection";

export type AskGinaSkillToolName = GinaReadToolName | GinaPredictionRenderToolName;

export const GINA_CLOSED_WORLD_READ_TOOL_NAMES = [
  "gina.getAccountAddresses",
  "gina.listScheduledPrompts",
  "spot.fetchSwapHistory",
  "perps.executeSqlQuery",
] as const satisfies readonly GinaReadToolName[];

export const GINA_MCP_APP_BOUND_READ_TOOL_NAMES = [
  "spot.getTokenChart",
  "perps.getHyperliquidPositions",
  "perps.fetchHyperliquidCandles",
  "predictions.getPolymarketPositions",
] as const satisfies readonly GinaReadToolName[];

const catalogToolNames: readonly GinaReadToolName[] = GINA_READ_TOOL_CATALOG.map(
  (tool) => tool.name,
);

export const GinaReadToolCatalogEntrySchema = Schema.Struct({
  name: Schema.String,
  family: Schema.Literals(GINA_MCP_APP_FAMILY_VALUES),
  readOnlyHint: Schema.Boolean,
  destructiveHint: Schema.Boolean,
  openWorldHint: Schema.Boolean,
  mcpAppBound: Schema.Boolean,
});

export const GinaReadToolCatalogSchema = Schema.Array(GinaReadToolCatalogEntrySchema).check(
  Schema.isLengthBetween(30, 30),
);

export const GinaReadToolCatalogJsonSchema = Schema.fromJsonString(GinaReadToolCatalogSchema);

export const listCatalogToolNames = (): readonly GinaReadToolName[] => catalogToolNames;

export const isGinaReadToolName = (name: unknown): name is GinaReadToolName =>
  typeof name === "string" && catalogToolNames.includes(name as GinaReadToolName);

export const getGinaReadToolFamily = (name: GinaReadToolName): GinaMcpAppFamily =>
  name.startsWith("gina.") ? "portfolio" : (name.split(".", 1)[0] as GinaMcpAppFamily);

export const getGinaReadToolAnnotations = (name: GinaReadToolName): GinaReadToolAnnotations => ({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: !GINA_CLOSED_WORLD_READ_TOOL_NAMES.includes(
    name as (typeof GINA_CLOSED_WORLD_READ_TOOL_NAMES)[number],
  ),
});

export const isGinaMcpAppBoundReadTool = (name: GinaReadToolName): boolean =>
  GINA_MCP_APP_BOUND_READ_TOOL_NAMES.includes(
    name as (typeof GINA_MCP_APP_BOUND_READ_TOOL_NAMES)[number],
  );

const sharedReadTools = GINA_READ_TOOL_CATALOG.filter((tool) => tool.family === "portfolio").map(
  (tool) => tool.name,
);

const familyTools = (family: Exclude<GinaMcpAppFamily, "portfolio">): readonly GinaReadToolName[] =>
  GINA_READ_TOOL_CATALOG.filter((tool) => tool.family === family).map((tool) => tool.name);

export const SKILL_NAMES = [
  "review-gina-account",
  "research-spot-tokens",
  "research-hyperliquid",
  "research-prediction-markets",
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export type AskGinaSkillDefinition = Readonly<{
  name: SkillName;
  tools: readonly AskGinaSkillToolName[];
}>;

const PREDICTION_SKILL_TOOLS = [
  "predictions.searchPredictionMarkets",
  "predictions.getPredictionOrderbook",
  "predictions.fetchPolymarketData",
  "predictions.fetchPolymarketHistory",
  "predictions.getPolymarketPositions",
  "predictions.getPolymarketOrderHistory",
  "predictions.renderPredictionPodium",
  "predictions.renderPredictionBinaryMarket",
  "predictions.renderPredictionCollection",
] as const satisfies readonly AskGinaSkillToolName[];

export const ASK_GINA_SKILL_DEFINITIONS = [
  {
    name: "review-gina-account",
    tools: sharedReadTools,
  },
  {
    name: "research-spot-tokens",
    tools: familyTools("spot"),
  },
  {
    name: "research-hyperliquid",
    tools: familyTools("perps"),
  },
  {
    name: "research-prediction-markets",
    tools: PREDICTION_SKILL_TOOLS,
  },
] as const satisfies readonly AskGinaSkillDefinition[];

export const SOURCE_COMMIT = "908af9015f1e87cf1ba4893226d149905e74df4a";
export const RELEASE_VERSION = "0.1.0";
export const catalogSha = "92fb5788ef462b85710f03c4fa6b8b67b8beaf3e20a478e6128daf839fb1bbee";
