import { PRODUCTION_MCP_URL } from "@askgina/contracts";

export const ALPHA_GINA_READ_SERVER_URL = "https://alpha.askgina.ai/ai/gina/mcp";

export const isAllowedGinaReadServerUrl = (value: string): boolean =>
  value === PRODUCTION_MCP_URL || value === ALPHA_GINA_READ_SERVER_URL;
