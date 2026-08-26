import { PRODUCTION_MCP_URL } from "@askgina/contracts";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Function } from "effect";

import type { AskGinaError } from "./errors";
import { AskGinaToolError, AskGinaTransportError } from "./errors";

export type AskGinaListedTool = {
  readonly name: string;
};

export type AskGinaTransport = {
  readonly listTools: () => Effect.Effect<readonly AskGinaListedTool[], AskGinaError>;
  readonly callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, AskGinaError>;
};

type McpTextContent = {
  readonly type: "text";
  readonly text: string;
};

const isMcpTextContent = (value: unknown): value is McpTextContent =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "text" &&
  "text" in value &&
  typeof value.text === "string";

type McpToolErrorResult = {
  readonly isError: true;
  readonly content?: readonly unknown[];
};

const isMcpToolErrorResult = (value: unknown): value is McpToolErrorResult =>
  typeof value === "object" && value !== null && "isError" in value && value.isError === true;

const redactSecret = (value: string, secret: string): string =>
  secret.length === 0 ? value : value.replaceAll(secret, "[REDACTED]");

export const rejectIfMcpToolError = Function.dual<
  (tool: string) => (result: unknown) => Effect.Effect<unknown, AskGinaToolError>,
  (result: unknown, tool: string) => Effect.Effect<unknown, AskGinaToolError>
>(2, (result, tool) => {
  if (!isMcpToolErrorResult(result)) {
    return Effect.succeed(result);
  }

  const errorMessage = Array.isArray(result.content)
    ? result.content.find(isMcpTextContent)?.text.trim()
    : undefined;

  return Effect.fail(
    new AskGinaToolError({
      message:
        errorMessage !== undefined && errorMessage.length > 0
          ? errorMessage
          : `Ask Gina tool ${tool} reported an error`,
      tool,
    }),
  );
});

const canonicalMcpUrl = (): URL => {
  const url = new URL(PRODUCTION_MCP_URL);
  if (
    url.protocol !== "https:" ||
    url.host !== "askgina.ai" ||
    url.pathname !== "/ai/gina/mcp" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Invalid canonical Ask Gina MCP URL");
  }
  return url;
};

const useMcpClient = <A>(
  accessToken: string,
  failureMessage: string,
  use: (client: McpClient) => Effect.Effect<A, AskGinaTransportError>,
): Effect.Effect<A, AskGinaTransportError> => {
  const mapFailure = () =>
    new AskGinaTransportError({
      message: failureMessage,
    });

  return Effect.scoped(
    Effect.gen(function* () {
      const { client, transport } = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const transport = new StreamableHTTPClientTransport(canonicalMcpUrl(), {
              requestInit: {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
                redirect: "error",
              },
            });
            const client = new McpClient({ name: "ask-gina", version: "0.1.0" });
            return { client, transport };
          },
          catch: mapFailure,
        }),
        ({ client }) =>
          Effect.tryPromise({
            try: () => client.close(),
            catch: mapFailure,
          }).pipe(Effect.ignore),
      );

      yield* Effect.tryPromise({
        try: (signal) => client.connect(transport, { signal }),
        catch: mapFailure,
      });
      return yield* use(client);
    }),
  );
};

export const createProductionTransport = (accessToken: string): AskGinaTransport => ({
  listTools: () =>
    useMcpClient(accessToken, "Failed to list Ask Gina tools over Streamable HTTP MCP", (client) =>
      Effect.tryPromise({
        try: (signal) => client.listTools(undefined, { signal }),
        catch: () =>
          new AskGinaTransportError({
            message: "Failed to list Ask Gina tools over Streamable HTTP MCP",
          }),
      }).pipe(Effect.map(({ tools }) => tools.map(({ name }) => ({ name })))),
    ),
  callTool: (name, args) =>
    useMcpClient(accessToken, `Failed to call Ask Gina tool ${name}`, (client) =>
      Effect.tryPromise({
        try: (signal) => client.callTool({ name, arguments: args }, undefined, { signal }),
        catch: () =>
          new AskGinaTransportError({
            message: `Failed to call Ask Gina tool ${name}`,
          }),
      }),
    ).pipe(
      Effect.flatMap((result) => rejectIfMcpToolError(result, name)),
      Effect.mapError((error) =>
        error instanceof AskGinaToolError
          ? new AskGinaToolError({
              message: redactSecret(error.message, accessToken),
              tool: error.tool,
            })
          : error,
      ),
    ),
});
