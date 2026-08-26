import { listCatalogToolNames, PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import type { PluginEvalCase } from "../src/contracts";
import {
  PluginEvalResponsesDecodeError,
  PluginEvalResponsesHttpError,
  PluginEvalResponsesRequestError,
  PluginEvalResponsesTimeoutError,
  RESPONSES_API_MAX_BODY_BYTES,
  type ResponsesApiTrialOptions,
  runResponsesApiPluginEvalTrial,
} from "../src/responses-api";

const evalCase: PluginEvalCase = {
  id: "direct-price",
  category: "direct",
  tags: ["spot"],
  manual_priority: "required",
  turns: [{ role: "user", content: "Show Ethereum in USD" }],
  expected: {
    routing: { kind: "exact", tool: "spot.getSimplePrice" },
  },
};

const allowedTools = listCatalogToolNames();

const options = {
  apiKey: "synthetic-fixture",
  mcpAuthorization: "gina-read-secret",
  model: "chat-latest",
  reasoning: "medium",
  runId: "run-1",
  repetition: 1,
  serverUrl: PRODUCTION_MCP_URL,
  allowedTools,
} as const;

const responseFor = (request: HttpClientRequest.HttpClientRequest, status: number, body: unknown) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const textResponseFor = (
  request: HttpClientRequest.HttpClientRequest,
  status: number,
  body: string,
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const readRequestBody = (request: HttpClientRequest.HttpClientRequest): Record<string, unknown> => {
  assert.strictEqual(request.body._tag, "Uint8Array");
  if (request.body._tag !== "Uint8Array") throw new Error("expected JSON request body");
  return JSON.parse(new TextDecoder().decode(request.body.body)) as Record<string, unknown>;
};

const serialized = (value: unknown): string => JSON.stringify(value);

const runWith = (client: HttpClient.HttpClient, trialOptions: ResponsesApiTrialOptions = options) =>
  runResponsesApiPluginEvalTrial(evalCase, trialOptions).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
  );

describe("Responses API trial adapter", () => {
  it.effect("sends the fixed request with the complete allowed-tool catalog", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const toolOutput = '{"ethereum":{"usd":3200},"label":"ETH €"}';
      const client = HttpClient.make((request) => {
        requests.push(request);
        return Effect.succeed(
          responseFor(request, 200, {
            status: "completed",
            output: [
              {
                id: "mcpl_1",
                type: "mcp_list_tools",
                server_label: "ask_gina",
                tools: allowedTools.map((name) => ({ name })),
              },
              {
                id: "mcp_1",
                type: "mcp_call",
                name: "spot.getSimplePrice",
                arguments: '{"ids":"ethereum","vs_currencies":"usd"}',
                output: toolOutput,
                error: null,
                server_label: "ask_gina",
              },
              {
                id: "mcp_2",
                type: "mcp_call",
                name: "gina.getCrosschainPortfolio",
                arguments: "{invalid-provider-arguments",
                output: null,
                error: "provider-call-message-must-not-be-copied",
                server_label: "ask_gina",
              },
              {
                id: "msg_1",
                type: "message",
                content: [{ type: "output_text", text: "ETH is $3,200." }],
              },
            ],
            usage: { input_tokens: 110, output_tokens: 20, total_tokens: 130 },
          }),
        );
      });

      const observation = yield* runWith(client);

      assert.strictEqual(requests.length, 1);
      const request = requests[0];
      if (request === undefined) return yield* Effect.die("missing request");
      assert.strictEqual(request.method, "POST");
      assert.strictEqual(request.url, "https://api.openai.com/v1/responses");
      assert.strictEqual(request.headers.authorization, "Bearer synthetic-fixture");
      assert.strictEqual(request.headers.accept, "application/json");
      assert.strictEqual(allowedTools.length, 29);

      const body = readRequestBody(request);
      assert.strictEqual(body.model, "chat-latest");
      assert.deepStrictEqual(body.reasoning, { effort: "medium" });
      assert.strictEqual(body.store, false);
      assert.deepStrictEqual(body.input, [{ role: "user", content: "Show Ethereum in USD" }]);
      assert.deepStrictEqual(body.tools, [
        {
          type: "mcp",
          server_label: "ask_gina",
          server_description: "Ask Gina read-only market, portfolio, account, and research tools.",
          server_url: PRODUCTION_MCP_URL,
          authorization: "gina-read-secret",
          require_approval: "never",
          allowed_tools: [...allowedTools],
        },
      ]);
      assert.notInclude(serialized(body), options.apiKey);
      assert.notInclude(serialized(request.headers), options.mcpAuthorization);

      assert.strictEqual(observation.status, "completed");
      assert.deepStrictEqual(observation.available_tools, allowedTools);
      assert.isAtLeast(observation.duration_ms, 0);
      assert.strictEqual(observation.final_answer, "ETH is $3,200.");
      assert.deepStrictEqual(observation.token_usage, {
        input_tokens: 110,
        output_tokens: 20,
        total_tokens: 130,
      });
      assert.deepStrictEqual(observation.tool_calls[0], {
        sequence: 0,
        name: "spot.getSimplePrice",
        arguments: { ids: "ethereum", vs_currencies: "usd" },
        result_bytes: new TextEncoder().encode(toolOutput).byteLength,
      });
      assert.deepStrictEqual(observation.tool_calls[1], {
        sequence: 1,
        name: "gina.getCrosschainPortfolio",
        arguments: {},
        error: {
          code: "invalid_arguments",
          message: "OpenAI returned invalid JSON MCP arguments",
        },
      });
      assert.notInclude(serialized(observation.tool_calls[1]), "provider-call-message");
    }),
  );

  it.effect("rejects non-canonical MCP configuration before calling the client", () =>
    Effect.gen(function* () {
      let calls = 0;
      const client = HttpClient.make((request) => {
        calls += 1;
        return Effect.succeed(responseFor(request, 200, { output: [] }));
      });
      const result = yield* Effect.result(
        runWith(client, { ...options, serverUrl: "https://example.invalid/mcp" }),
      );

      assert.strictEqual(calls, 0);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalResponsesRequestError);
        assert.strictEqual(result.failure.reason, "Responses trial options are invalid");
        assert.notInclude(serialized(result.failure), "example.invalid");
      }
      const subsetResult = yield* Effect.result(
        runWith(client, { ...options, allowedTools: allowedTools.slice(0, -1) }),
      );
      assert.strictEqual(subsetResult._tag, "Failure");
      if (subsetResult._tag === "Failure") {
        assert.instanceOf(subsetResult.failure, PluginEvalResponsesRequestError);
        assert.strictEqual(subsetResult.failure.reason, "Responses trial options are invalid");
      }
      assert.strictEqual(calls, 0);
    }),
  );

  it.effect("rejects a discovered catalog that differs from allowed_tools", () =>
    Effect.gen(function* () {
      const providerCatalogValue = "provider-catalog-value-must-not-be-copied";
      const client = HttpClient.make((request) =>
        Effect.succeed(
          responseFor(request, 200, {
            status: "completed",
            output: [
              {
                type: "mcp_list_tools",
                tools: [{ name: providerCatalogValue }],
              },
            ],
          }),
        ),
      );
      const result = yield* Effect.result(runWith(client));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalResponsesDecodeError);
        assert.strictEqual(
          result.failure.reason,
          "The imported MCP tool catalog did not match allowed_tools",
        );
        assert.notInclude(serialized(result.failure), providerCatalogValue);
      }
    }),
  );

  it.effect("rejects malformed MCP result fields without copying their values", () =>
    Effect.gen(function* () {
      const providerFieldValue = "provider-field-value-must-not-be-copied";
      const client = HttpClient.make((request) =>
        Effect.succeed(
          responseFor(request, 200, {
            status: "completed",
            output: [
              {
                type: "mcp_list_tools",
                tools: allowedTools.map((name) => ({ name })),
              },
              {
                type: "mcp_call",
                name: "spot.getSimplePrice",
                arguments: "{}",
                output: { payload: providerFieldValue },
                error: null,
              },
            ],
          }),
        ),
      );
      const result = yield* Effect.result(runWith(client));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalResponsesDecodeError);
        assert.strictEqual(result.failure.reason, "OpenAI returned an invalid MCP call result");
        assert.notInclude(serialized(result.failure), providerFieldValue);
      }
    }),
  );

  it.effect("maps HTTP and decode failures without serializing provider body values", () =>
    Effect.gen(function* () {
      const providerHttpValue = "provider-http-message-must-not-be-copied";
      const httpClient = HttpClient.make((request) =>
        Effect.succeed(
          responseFor(request, 401, {
            error: { message: providerHttpValue, echoedAuthorization: options.mcpAuthorization },
          }),
        ),
      );
      const httpResult = yield* Effect.result(runWith(httpClient));
      assert.strictEqual(httpResult._tag, "Failure");
      if (httpResult._tag === "Failure") {
        assert.instanceOf(httpResult.failure, PluginEvalResponsesHttpError);
        assert.strictEqual(httpResult.failure.statusCode, 401);
        assert.strictEqual(httpResult.failure.reason, "OpenAI rejected the trial request");
        const errorJson = serialized(httpResult.failure);
        assert.notInclude(errorJson, providerHttpValue);
        assert.notInclude(errorJson, options.apiKey);
        assert.notInclude(errorJson, options.mcpAuthorization);
      }

      const providerDecodeValue = "provider-decode-value-must-not-be-copied";
      const decodeClient = HttpClient.make((request) =>
        Effect.succeed(textResponseFor(request, 200, `{not-json:${providerDecodeValue}}`)),
      );
      const decodeResult = yield* Effect.result(runWith(decodeClient));
      assert.strictEqual(decodeResult._tag, "Failure");
      if (decodeResult._tag === "Failure") {
        assert.instanceOf(decodeResult.failure, PluginEvalResponsesDecodeError);
        assert.strictEqual(decodeResult.failure.reason, "OpenAI returned a non-JSON response");
        assert.notInclude(serialized(decodeResult.failure), providerDecodeValue);
      }

      const providerCompletionValue = "provider-completion-value-must-not-be-copied";
      const incompleteClient = HttpClient.make((request) =>
        Effect.succeed(
          responseFor(request, 200, {
            status: "incomplete",
            output: [],
            incomplete_details: { reason: providerCompletionValue },
          }),
        ),
      );
      const incompleteResult = yield* Effect.result(runWith(incompleteClient));
      assert.strictEqual(incompleteResult._tag, "Failure");
      if (incompleteResult._tag === "Failure") {
        assert.instanceOf(incompleteResult.failure, PluginEvalResponsesDecodeError);
        assert.strictEqual(
          incompleteResult.failure.reason,
          "OpenAI did not complete the Responses trial",
        );
        assert.notInclude(serialized(incompleteResult.failure), providerCompletionValue);
      }
    }),
  );

  it.effect("rejects an oversized Responses body without retaining it", () =>
    Effect.gen(function* () {
      const oversizedValue = "x".repeat(RESPONSES_API_MAX_BODY_BYTES + 1);
      const client = HttpClient.make((request) =>
        Effect.succeed(textResponseFor(request, 200, oversizedValue)),
      );
      const result = yield* Effect.result(runWith(client));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalResponsesDecodeError);
        assert.strictEqual(
          result.failure.reason,
          "OpenAI Responses payload exceeded the byte limit",
        );
        assert.notInclude(serialized(result.failure), oversizedValue.slice(0, 64));
      }
    }),
  );

  it.effect("maps transport failures without retaining their causes", () =>
    Effect.gen(function* () {
      const transportValue = "transport-cause-must-not-be-copied";
      const client = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: transportValue,
            }),
          }),
        ),
      );
      const result = yield* Effect.result(runWith(client));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalResponsesRequestError);
        assert.strictEqual(result.failure.reason, "Failed to reach the OpenAI Responses API");
        const errorJson = serialized(result.failure);
        assert.notInclude(errorJson, transportValue);
        assert.notInclude(errorJson, options.apiKey);
        assert.notInclude(errorJson, options.mcpAuthorization);
      }
    }),
  );

  it.live("interrupts the injected client and returns the typed timeout", () =>
    Effect.gen(function* () {
      let interrupted = false;
      const client = HttpClient.make(() =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      );
      const result = yield* Effect.result(runWith(client, { ...options, timeoutMs: 1 }));

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalResponsesTimeoutError);
        assert.isTrue(interrupted);
        assert.deepStrictEqual(
          { caseId: result.failure.caseId, timeoutMs: result.failure.timeoutMs },
          { caseId: evalCase.id, timeoutMs: 1 },
        );
        const errorJson = serialized(result.failure);
        assert.notInclude(errorJson, options.apiKey);
        assert.notInclude(errorJson, options.mcpAuthorization);
      }
    }),
  );
});
