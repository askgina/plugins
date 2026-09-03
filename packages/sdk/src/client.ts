import {
  GINA_CONNECTED_TOOL_NAMES,
  GINA_READ_TOOL_CATALOG,
  isGinaConnectedToolName,
  PRODUCTION_MCP_URL,
  type GinaConnectedToolName,
  type GinaReadToolName,
} from "@askgina/contracts";
import { Effect } from "effect";

import type { AskGinaError } from "./errors";
import { AskGinaAuthError, AskGinaToolError } from "./errors";
import type { AskGinaListedTool, AskGinaTransport } from "./transport";
import { createProductionTransport } from "./transport";

export type AskGinaClientOptions = {
  readonly accessToken: string;
  readonly transport?: AskGinaTransport;
};

export type AskGinaClient = {
  readonly url: string;
  readonly listTools: () => Effect.Effect<readonly AskGinaListedTool[], AskGinaError>;
  readonly callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Effect.Effect<unknown, AskGinaError>;
};

const requireAccessToken = (accessToken: string): Effect.Effect<string, AskGinaAuthError> => {
  const trimmed = accessToken.trim();
  if (trimmed.length === 0) {
    return new AskGinaAuthError({
      message:
        "Missing OAuth access token. Pass createClient({ accessToken }) or set ASK_GINA_ACCESS_TOKEN. That value is a bearer from your app or an app-signed JWT.",
    });
  }
  return Effect.succeed(trimmed);
};

export const createClient = (options: AskGinaClientOptions): AskGinaClient => {
  if ("url" in options) {
    throw new TypeError("Ask Gina SDK URL overrides are not supported");
  }

  const url = PRODUCTION_MCP_URL;
  const transport = options.transport ?? createProductionTransport(options.accessToken.trim());

  return {
    url,
    listTools: () =>
      Effect.gen(function* () {
        yield* requireAccessToken(options.accessToken);
        const tools = yield* transport.listTools();
        const observedNames = new Set<string>();
        for (const tool of tools) {
          if (observedNames.has(tool.name)) {
            return yield* new AskGinaToolError({
              message: "Production Ask Gina tool catalog does not match the canonical tool catalog",
            });
          }
          observedNames.add(tool.name);
        }

        const matchesConnected =
          observedNames.size === GINA_CONNECTED_TOOL_NAMES.length &&
          GINA_CONNECTED_TOOL_NAMES.every((name: string) => observedNames.has(name));

        const matchesReadCatalog =
          observedNames.size === GINA_READ_TOOL_CATALOG.length &&
          GINA_READ_TOOL_CATALOG.every((tool: { name: string }) => observedNames.has(tool.name));

        if (!matchesConnected && !matchesReadCatalog) {
          return yield* new AskGinaToolError({
            message: "Production Ask Gina tool catalog does not match the canonical tool catalog",
          });
        }
        return tools;
      }),
    callTool: (name, args = {}) =>
      Effect.gen(function* () {
        yield* requireAccessToken(options.accessToken);
        if (!isGinaConnectedToolName(name)) {
          return yield* new AskGinaToolError({
            message: `Unknown Ask Gina tool: ${name}`,
            tool: name,
          });
        }
        return yield* transport.callTool(name, args);
      }),
  };
};

export const listCatalogToolNames = (): readonly GinaReadToolName[] =>
  GINA_READ_TOOL_CATALOG.map((tool) => tool.name);

export const listConnectedToolNames = (): readonly GinaConnectedToolName[] =>
  GINA_CONNECTED_TOOL_NAMES;
