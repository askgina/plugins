import { createMCPClient } from "@ai-sdk/mcp";
import { listCatalogToolNames, PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type * as OpenRouterModule from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount } from "ai";
import type * as AiModule from "ai";
import { Cause, Clock, Effect, Exit, Fiber } from "effect";
import { beforeEach, vi } from "vitest";

import type { PluginEvalCase } from "../src/contracts";
import {
  DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
  PluginEvalOpenRouterGenerationError,
  PluginEvalOpenRouterMcpError,
  PluginEvalOpenRouterRequestError,
  PluginEvalOpenRouterTimeoutError,
  type OpenRouterGenerationEvidence,
  type OpenRouterTrialOptions,
  runOpenRouterPluginEvalTrial,
} from "../src/openrouter";
import { ALPHA_GINA_READ_SERVER_URL } from "../src/server-url";

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => (modelId: string, settings?: unknown) => ({ modelId, settings })),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  isStepCount: vi.fn((count: number) => count),
  wrapLanguageModel: ({
    model,
    middleware,
  }: {
    model: {
      readonly provider?: string;
      readonly modelId?: string;
      readonly supportedUrls?: unknown;
      doGenerate: (params: unknown) => PromiseLike<unknown>;
      doStream: (params: unknown) => PromiseLike<unknown>;
    };
    middleware: {
      wrapGenerate?: (options: {
        doGenerate: () => PromiseLike<unknown>;
        doStream: () => PromiseLike<unknown>;
        params: unknown;
        model: unknown;
      }) => PromiseLike<unknown>;
    };
  }) => ({
    specificationVersion: "v4",
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: (params: unknown) =>
      middleware.wrapGenerate === undefined
        ? model.doGenerate(params)
        : middleware.wrapGenerate({
            doGenerate: () => model.doGenerate(params),
            doStream: () => model.doStream(params),
            params,
            model,
          }),
    doStream: (params: unknown) => model.doStream(params),
  }),
}));

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
const createMCPClientMock = vi.mocked(createMCPClient);
const createOpenRouterMock = vi.mocked(createOpenRouter);
const generateTextMock = vi.mocked(generateText);
const isStepCountMock = vi.mocked(isStepCount);

const options = {
  apiKey: "synthetic-openrouter-key",
  mcpAuthorization: "gina-read-secret",
  model: "openai/gpt-4o",
  endpoint: "openai",
  reasoning: "medium",
  runId: "run-1",
  repetition: 1,
  serverUrl: PRODUCTION_MCP_URL,
  allowedTools,
} as const satisfies OpenRouterTrialOptions;

const serialized = (value: unknown): string => JSON.stringify(value);

const catalogTools = (names: readonly string[], nextCursor?: string) => ({
  tools: names.map((name) => ({ name, inputSchema: { type: "object" } })),
  ...(nextCursor === undefined ? {} : { nextCursor }),
});

const mockClient = (overrides?: {
  readonly tools?: readonly string[];
  readonly close?: () => Promise<void>;
}) => ({
  listTools: vi.fn(() => Promise.resolve(catalogTools(overrides?.tools ?? allowedTools))),
  toolsFromDefinitions: vi.fn((definitions: { tools: readonly { name: string }[] }) =>
    Object.fromEntries(definitions.tools.map((tool) => [tool.name, tool])),
  ),
  close: vi.fn(overrides?.close ?? (() => Promise.resolve())),
});

describe("OpenRouter trial adapter", () => {
  beforeEach(() => {
    createMCPClientMock.mockReset();
    generateTextMock.mockReset();
    createOpenRouterMock.mockReset();
    createOpenRouterMock.mockImplementation((() => (modelId: string, settings?: unknown) => ({
      modelId,
      settings,
    })) as typeof createOpenRouter);
    isStepCountMock.mockReset();
    isStepCountMock.mockImplementation(((count: number) => count) as unknown as typeof isStepCount);
  });

  it.effect("rejects non-canonical options and unknown reasoning before connecting", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, {
          ...options,
          serverUrl: "https://example.invalid/mcp",
        }),
      );

      assert.strictEqual(createMCPClientMock.mock.calls.length, 0);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterRequestError);
        assert.strictEqual(result.failure.reason, "invalid-options");
        assert.notInclude(serialized(result.failure), "example.invalid");
        assert.notInclude(serialized(result.failure), options.apiKey);
      }

      const reasoningResult = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, reasoning: "turbo" }),
      );
      assert.strictEqual(createMCPClientMock.mock.calls.length, 0);
      assert.strictEqual(reasoningResult._tag, "Failure");
      if (reasoningResult._tag === "Failure") {
        assert.instanceOf(reasoningResult.failure, PluginEvalOpenRouterRequestError);
        assert.strictEqual(reasoningResult.failure.reason, "unsupported-reasoning");
        assert.notInclude(serialized(reasoningResult.failure), "turbo");
      }

      const emptyReasoning = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, reasoning: "" }),
      );
      assert.strictEqual(emptyReasoning._tag, "Failure");
      if (emptyReasoning._tag === "Failure") {
        assert.instanceOf(emptyReasoning.failure, PluginEvalOpenRouterRequestError);
        assert.strictEqual(emptyReasoning.failure.reason, "unsupported-reasoning");
      }

      const maxStepsResult = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, maxSteps: 33 }),
      );
      assert.strictEqual(maxStepsResult._tag, "Failure");
      if (maxStepsResult._tag === "Failure") {
        assert.instanceOf(maxStepsResult.failure, PluginEvalOpenRouterRequestError);
        assert.strictEqual(maxStepsResult.failure.reason, "invalid-options");
      }

      const invalidToolCallBudgets = [0, 33, -1, 1.5, Number.NaN];
      for (const maxToolCalls of invalidToolCallBudgets) {
        const maxToolCallsResult = yield* Effect.result(
          runOpenRouterPluginEvalTrial(evalCase, { ...options, maxToolCalls }),
        );
        assert.strictEqual(createMCPClientMock.mock.calls.length, 0);
        assert.strictEqual(generateTextMock.mock.calls.length, 0);
        assert.strictEqual(maxToolCallsResult._tag, "Failure");
        if (maxToolCallsResult._tag === "Failure") {
          assert.instanceOf(maxToolCallsResult.failure, PluginEvalOpenRouterRequestError);
          assert.strictEqual(maxToolCallsResult.failure.reason, "invalid-options");
        }
      }

      const subsetResult = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, {
          ...options,
          allowedTools: allowedTools.slice(0, -1),
        }),
      );
      assert.strictEqual(createMCPClientMock.mock.calls.length, 0);
      assert.strictEqual(subsetResult._tag, "Failure");
      if (subsetResult._tag === "Failure") {
        assert.instanceOf(subsetResult.failure, PluginEvalOpenRouterRequestError);
        assert.strictEqual(subsetResult.failure.reason, "invalid-options");
      }

      const missingEndpointOptions = { ...options };
      Reflect.deleteProperty(missingEndpointOptions, "endpoint");
      const missingEndpointResult = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, missingEndpointOptions),
      );
      assert.strictEqual(missingEndpointResult._tag, "Failure");
      if (missingEndpointResult._tag === "Failure") {
        assert.instanceOf(missingEndpointResult.failure, PluginEvalOpenRouterRequestError);
        assert.strictEqual(missingEndpointResult.failure.reason, "invalid-options");
      }
      assert.strictEqual(createMCPClientMock.mock.calls.length, 0);
      assert.strictEqual(generateTextMock.mock.calls.length, 0);

      const invalidEndpoints = ["", "openai/gpt-4o", "gpt-4o", "OpenAI", "openai,anthropic", "*"];
      for (const endpoint of invalidEndpoints) {
        const endpointResult = yield* Effect.result(
          runOpenRouterPluginEvalTrial(evalCase, { ...options, endpoint }),
        );
        assert.strictEqual(createMCPClientMock.mock.calls.length, 0);
        assert.strictEqual(generateTextMock.mock.calls.length, 0);
        assert.strictEqual(endpointResult._tag, "Failure");
        if (endpointResult._tag === "Failure") {
          assert.instanceOf(endpointResult.failure, PluginEvalOpenRouterRequestError);
          assert.strictEqual(endpointResult.failure.reason, "invalid-options");
        }
      }
    }),
  );

  it.effect("rejects a discovered catalog that differs from allowed_tools and closes MCP", () =>
    Effect.gen(function* () {
      const providerCatalogValue = "provider-catalog-value-must-not-be-copied";
      const client = mockClient({ tools: [providerCatalogValue] });
      createMCPClientMock.mockResolvedValue(client as never);

      const result = yield* Effect.result(runOpenRouterPluginEvalTrial(evalCase, options));

      assert.strictEqual(generateTextMock.mock.calls.length, 0);
      assert.strictEqual(client.toolsFromDefinitions.mock.calls.length, 0);
      assert.strictEqual(client.close.mock.calls.length, 1);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterMcpError);
        assert.strictEqual(result.failure.reason, "catalog-mismatch");
        assert.notInclude(serialized(result.failure), providerCatalogValue);
        assert.notInclude(serialized(result.failure), options.apiKey);
        assert.notInclude(serialized(result.failure), options.mcpAuthorization);
      }
    }),
  );

  it.effect("records ordered tool calls and omits incomplete usage and secret values", () =>
    Effect.gen(function* () {
      const toolOutput = '{"ethereum":{"usd":3200}}';
      const providerToolError = "provider-call-message-must-not-be-copied";
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockResolvedValue({
        text: "ETH is $3,200.",
        finishReason: "stop",
        usage: {
          inputTokens: 110,
          outputTokens: 20,
          totalTokens: 130,
        },
        steps: [
          {
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
            toolCalls: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "spot_getSimplePrice",
                input: { ids: "ethereum", vs_currencies: "usd" },
              },
              {
                type: "tool-call",
                toolCallId: "call_2",
                toolName: "gina_getCrosschainPortfolio",
                input: "{invalid-provider-arguments",
              },
              {
                type: "tool-call",
                toolCallId: "call_3",
                toolName: "spot_getSimplePrice",
                input: { ids: "bitcoin" },
              },
            ],
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                toolName: "spot_getSimplePrice",
                output: toolOutput,
              },
              {
                type: "tool-result",
                toolCallId: "call_3",
                toolName: "spot_getSimplePrice",
                output: {
                  content: [{ type: "text", text: providerToolError }],
                  isError: true,
                },
              },
            ],
            performance: { toolExecutionMs: { call_1: 7, call_3: 4 } },
          },
        ],
      } as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, options);

      assert.strictEqual(observation.status, "completed");
      assert.strictEqual(observation.error, undefined);
      assert.strictEqual(observation.target, "openrouter_api");
      assert.strictEqual(observation.final_answer, "ETH is $3,200.");
      assert.deepStrictEqual(observation.available_tools, allowedTools);
      assert.deepStrictEqual(observation.token_usage, {
        input_tokens: 110,
        output_tokens: 20,
        total_tokens: 130,
      });
      assert.strictEqual(observation.activated_skills, undefined);
      assert.deepStrictEqual(observation.tool_calls[0], {
        sequence: 0,
        name: "spot.getSimplePrice",
        arguments: { ids: "ethereum", vs_currencies: "usd" },
        duration_ms: 7,
        result_bytes: new TextEncoder().encode(toolOutput).byteLength,
      });
      assert.deepStrictEqual(observation.tool_calls[1], {
        sequence: 1,
        name: "gina.getCrosschainPortfolio",
        arguments: {},
        error: {
          code: "invalid_arguments",
          message: "OpenRouter returned invalid MCP arguments",
        },
      });
      assert.strictEqual(observation.tool_calls[2]?.sequence, 2);
      assert.strictEqual(observation.tool_calls[2]?.name, "spot.getSimplePrice");
      assert.deepStrictEqual(observation.tool_calls[2]?.arguments, { ids: "bitcoin" });
      assert.strictEqual(observation.tool_calls[2]?.duration_ms, 4);
      assert.isAtLeast(observation.tool_calls[2]?.result_bytes ?? 0, 1);
      assert.deepStrictEqual(observation.tool_calls[2]?.error, { message: "MCP tool call failed" });
      assert.notInclude(serialized(observation), providerToolError);
      assert.notInclude(serialized(observation), options.apiKey);
      assert.notInclude(serialized(observation), options.mcpAuthorization);
      assert.strictEqual(client.close.mock.calls.length, 1);
      const mcpConfig = createMCPClientMock.mock.calls[0]?.[0] as { maxRetries?: number };
      const generateConfig = generateTextMock.mock.calls[0]?.[0] as {
        maxRetries?: number;
        stopWhen?: unknown;
      };
      assert.strictEqual(mcpConfig.maxRetries, 0);
      assert.strictEqual(generateConfig.maxRetries, 0);
      assert.strictEqual(generateConfig.stopWhen, 8);
    }),
  );

  it.effect("serializes exact endpoint routing on the intercepted OpenRouter body", () =>
    Effect.gen(function* () {
      const actualAi = (yield* Effect.promise(() => vi.importActual("ai"))) as typeof AiModule;
      const actualOpenRouter = (yield* Effect.promise(() =>
        vi.importActual("@openrouter/ai-sdk-provider"),
      )) as typeof OpenRouterModule;
      const bodies: unknown[] = [];
      generateTextMock.mockImplementation(actualAi.generateText);
      isStepCountMock.mockImplementation(actualAi.isStepCount);
      createOpenRouterMock.mockImplementation((settings) =>
        actualOpenRouter.createOpenRouter({
          ...settings,
          fetch: ((_input, init) => {
            if (typeof init?.body === "string") {
              bodies.push(JSON.parse(init.body) as unknown);
            }
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "chatcmpl-eval",
                  object: "chat.completion",
                  created: 0,
                  model: "openai/gpt-4o",
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: "ETH is $3,200." },
                      finish_reason: "stop",
                    },
                  ],
                  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          }) as typeof fetch,
        }),
      );
      const client = mockClient();
      client.toolsFromDefinitions.mockImplementation(((definitions: {
        tools: readonly { name: string }[];
      }) =>
        Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            actualAi.tool({
              inputSchema: actualAi.jsonSchema({
                type: "object",
                additionalProperties: true,
              }),
              execute: () => Promise.resolve({}),
            }),
          ]),
        )) as unknown as typeof client.toolsFromDefinitions);
      createMCPClientMock.mockResolvedValue(client as never);

      const result = yield* Effect.result(runOpenRouterPluginEvalTrial(evalCase, options));
      assert.strictEqual(result._tag, "Success");
      if (result._tag !== "Success") {
        return;
      }
      assert.strictEqual(result.success.status, "completed");
      assert.strictEqual(result.success.error, undefined);
      assert.strictEqual(bodies.length, 1);
      const body = bodies[0] as {
        provider?: unknown;
        reasoning?: unknown;
        temperature?: unknown;
        top_p?: unknown;
        max_tokens?: unknown;
        service_tier?: unknown;
      };
      assert.deepStrictEqual(body.provider, {
        only: ["openai"],
        allow_fallbacks: false,
        require_parameters: true,
      });
      assert.deepStrictEqual(body.reasoning, { effort: "medium" });
      assert.strictEqual(body.temperature, undefined);
      assert.strictEqual(body.top_p, undefined);
      assert.strictEqual(body.max_tokens, undefined);
      assert.strictEqual(body.service_tier, undefined);
    }),
  );

  it.effect("keeps OpenRouter wire names legal without changing MCP dispatch or reports", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockClient();
      client.toolsFromDefinitions.mockImplementation(
        (definitions: { tools: readonly { name: string }[] }) =>
          Object.fromEntries(
            definitions.tools.map((tool) => [
              tool.name,
              {
                name: tool.name,
                execute: () => {
                  dispatched.push(tool.name);
                  return { ok: true };
                },
              },
            ]),
          ),
      );
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
      }) => {
        config.tools?.spot_getSimplePrice?.execute?.({ ids: "ethereum" });
        return Promise.resolve({
          text: "ETH is $3,200.",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          steps: [
            {
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              toolCalls: [
                {
                  type: "tool-call",
                  toolCallId: "call_1",
                  toolName: "spot_getSimplePrice",
                  input: { ids: "ethereum" },
                },
                {
                  type: "tool-call",
                  toolCallId: "call_unknown",
                  toolName: "not_a_gina_tool",
                  input: {},
                },
              ],
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call_1",
                  toolName: "spot_getSimplePrice",
                  output: { ok: true },
                },
              ],
              performance: { toolExecutionMs: { call_1: 3 } },
            },
          ],
        });
      }) as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, options);
      const generateConfig = generateTextMock.mock.calls[0]?.[0] as {
        tools?: Record<string, unknown>;
        toolOrder?: readonly string[];
      };
      const wireNames = Object.keys(generateConfig.tools ?? {});
      const wireOrder = generateConfig.toolOrder ?? [];
      const illegalWireNames = [...wireNames, ...wireOrder].filter(
        (name) => !/^[A-Za-z0-9_-]{1,64}$/.test(name),
      );

      assert.deepStrictEqual(illegalWireNames, []);
      assert.notInclude(wireNames, "spot.getSimplePrice");
      assert.notInclude(wireOrder, "spot.getSimplePrice");
      assert.include(wireNames, "spot_getSimplePrice");
      assert.include(wireOrder, "spot_getSimplePrice");
      assert.deepStrictEqual(dispatched, ["spot.getSimplePrice"]);
      assert.deepStrictEqual(observation.available_tools, allowedTools);
      assert.strictEqual(observation.tool_calls[0]?.name, "spot.getSimplePrice");
      assert.deepStrictEqual(observation.tool_calls[0]?.arguments, { ids: "ethereum" });
      assert.deepStrictEqual(observation.tool_calls[1], {
        sequence: 1,
        name: "not_a_gina_tool",
        arguments: {},
        error: {
          code: "invalid_tool",
          message: "OpenRouter requested an unavailable MCP tool",
        },
      });
      assert.notInclude(serialized(observation.tool_calls[0]), "spot_getSimplePrice");
    }),
  );

  it.effect("does not mark step-budget exhaustion as completed", () =>
    Effect.gen(function* () {
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockResolvedValue({
        text: "partial answer after tool loop",
        finishReason: "tool-calls",
        usage: {
          inputTokens: 80,
          outputTokens: 30,
          totalTokens: 110,
        },
        steps: [],
      } as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, options);
      assert.strictEqual(observation.status, "failed");
      assert.strictEqual(
        observation.error,
        "OpenRouter generation did not complete with a final answer",
      );
      assert.strictEqual(observation.final_answer, "partial answer after tool loop");
      assert.deepStrictEqual(observation.token_usage, {
        input_tokens: 80,
        output_tokens: 30,
        total_tokens: 110,
      });
    }),
  );

  it.effect("omits token usage unless every required count is present", () =>
    Effect.gen(function* () {
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockResolvedValue({
        text: "",
        finishReason: "stop",
        usage: {
          inputTokens: 110,
          outputTokens: undefined,
          totalTokens: 110,
        },
        steps: [],
      } as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, options);
      assert.strictEqual(observation.status, "failed");
      assert.strictEqual(
        observation.error,
        "OpenRouter generation did not complete with a final answer",
      );
      assert.strictEqual(observation.token_usage, undefined);
      assert.strictEqual(observation.final_answer, undefined);
      assert.deepStrictEqual(observation.tool_calls, []);
    }),
  );

  it.effect("maps generation failures without copying provider messages", () =>
    Effect.gen(function* () {
      const providerValue = "openrouter-provider-message-must-not-be-copied";
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(() => {
        throw new Error(providerValue);
      });

      const result = yield* Effect.result(runOpenRouterPluginEvalTrial(evalCase, options));
      assert.strictEqual(client.close.mock.calls.length, 1);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "generation-failed");
        assert.notInclude(serialized(result.failure), providerValue);
        assert.notInclude(serialized(result.failure), options.apiKey);
        assert.notInclude(serialized(result.failure), options.mcpAuthorization);
      }
    }),
  );

  it.live("interrupts a hanging generation, closes MCP, and returns the typed timeout", () =>
    Effect.gen(function* () {
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => {
        const { promise, reject } = Promise.withResolvers<never>();
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        return promise;
      });

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, timeoutMs: 1 }),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterTimeoutError);
        assert.deepStrictEqual(
          { caseId: result.failure.caseId, timeoutMs: result.failure.timeoutMs },
          { caseId: evalCase.id, timeoutMs: 1 },
        );
        assert.notInclude(serialized(result.failure), options.apiKey);
        assert.notInclude(serialized(result.failure), options.mcpAuthorization);
      }
      assert.strictEqual(client.close.mock.calls.length, 1);
    }),
  );

  it.effect("treats a generation that settles after the deadline as timeout", () =>
    Effect.gen(function* () {
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      let now = 0;
      generateTextMock.mockImplementation((() => {
        now = 50;
        return Promise.resolve({
          text: "late success must not be recorded",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          steps: [],
        });
      }) as never);
      const testClock: Clock.Clock = {
        currentTimeMillisUnsafe: () => now,
        currentTimeMillis: Effect.sync(() => now),
        monotonicTimeNanosUnsafe: () => 0n,
        monotonicTimeNanos: Effect.succeed(0n),
        currentTimeNanosUnsafe: () => 0n,
        currentTimeNanos: Effect.succeed(0n),
        sleep: () => Effect.never,
      };

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, timeoutMs: 10 }).pipe(
          Effect.provideService(Clock.Clock, testClock),
        ),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterTimeoutError);
        assert.strictEqual(result.failure.timeoutMs, 10);
        assert.notInclude(serialized(result.failure), "late success must not be recorded");
      }
      assert.strictEqual(client.close.mock.calls.length, 1);
    }),
  );

  it.effect("treats a generation that rejects after the deadline as timeout", () =>
    Effect.gen(function* () {
      const providerValue = "late-provider-reject-must-not-leak";
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      let now = 0;
      generateTextMock.mockImplementation((() => {
        now = 50;
        return Promise.reject(new Error(providerValue));
      }) as never);
      const testClock: Clock.Clock = {
        currentTimeMillisUnsafe: () => now,
        currentTimeMillis: Effect.sync(() => now),
        monotonicTimeNanosUnsafe: () => 0n,
        monotonicTimeNanos: Effect.succeed(0n),
        currentTimeNanosUnsafe: () => 0n,
        currentTimeNanos: Effect.succeed(0n),
        sleep: () => Effect.never,
      };

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, timeoutMs: 10 }).pipe(
          Effect.provideService(Clock.Clock, testClock),
        ),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterTimeoutError);
        assert.strictEqual(result.failure.timeoutMs, 10);
        assert.notInclude(serialized(result.failure), providerValue);
      }
      assert.strictEqual(client.close.mock.calls.length, 1);
    }),
  );

  it.effect("preserves parent interruption instead of succeeding or mapping a typed failure", () =>
    Effect.gen(function* () {
      const client = mockClient();
      createMCPClientMock.mockImplementation(((config: {
        initializationOptions?: { signal?: AbortSignal };
      }) => {
        const { promise } = Promise.withResolvers<typeof client>();
        config.initializationOptions?.signal?.addEventListener("abort", () => undefined, {
          once: true,
        });
        return promise;
      }) as never);

      const fiber = yield* Effect.forkChild(runOpenRouterPluginEvalTrial(evalCase, options));
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);

      assert.strictEqual(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) {
        assert.strictEqual(Cause.hasInterrupts(exit.cause), true);
      }
      assert.strictEqual(generateTextMock.mock.calls.length, 0);
    }),
  );

  it.live("times out without waiting for a late MCP client, then closes it once", () =>
    Effect.gen(function* () {
      const client = mockClient();
      let aborted = false;
      const { promise, resolve } = Promise.withResolvers<typeof client>();
      createMCPClientMock.mockImplementation(((config: {
        initializationOptions?: { signal?: AbortSignal };
      }) => {
        config.initializationOptions?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        return promise;
      }) as never);

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, timeoutMs: 20 }),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterTimeoutError);
        assert.notInclude(serialized(result.failure), options.apiKey);
      }
      assert.strictEqual(aborted, true);
      assert.strictEqual(generateTextMock.mock.calls.length, 0);
      assert.strictEqual(client.close.mock.calls.length, 0);

      resolve(client);
      yield* Effect.sleep("30 millis");
      assert.strictEqual(client.close.mock.calls.length, 1);
    }),
  );

  it.live("returns timeout without waiting for a hanging MCP close", () =>
    Effect.gen(function* () {
      const client = mockClient({
        close: () => Promise.withResolvers<void>().promise,
      });
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => {
        const { promise, reject } = Promise.withResolvers<never>();
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        return promise;
      });

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, timeoutMs: 20 }),
      );

      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterTimeoutError);
      }
      assert.strictEqual(client.close.mock.calls.length, 1);
    }),
  );

  // Offline real-SDK smoke (no credentials, no network):
  // bun test packages/evals/__tests__/openrouter.test.ts -t "OpenRouter trial adapter"
  // The routing test importActuals generateText + createOpenRouter with intercepted fetch.
  // These cases call the wrapped execute functions generateText receives, including a
  // >8 parallel batch in one generation step — the SDK execute boundary, not maxSteps.
  const mockExecutableClient = (dispatched: string[]) => {
    const client = mockClient();
    client.toolsFromDefinitions.mockImplementation(
      (definitions: { tools: readonly { name: string }[] }) =>
        Object.fromEntries(
          definitions.tools.map((tool) => [
            tool.name,
            {
              name: tool.name,
              execute: () => {
                dispatched.push(tool.name);
                return { ok: true };
              },
            },
          ]),
        ),
    );
    return client;
  };

  const invokeWrappedExecutes = (
    config: { tools?: Record<string, { execute?: (input: unknown) => unknown }> },
    count: number,
  ): readonly unknown[] => {
    const execute = config.tools?.spot_getSimplePrice?.execute;
    const rejections: unknown[] = [];
    for (let index = 0; index < count; index += 1) {
      try {
        execute?.({ ids: "ethereum", n: index });
      } catch (error) {
        rejections.push(error);
      }
    }
    return rejections;
  };

  const completedGeneration = {
    text: "ETH is $3,200.",
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    steps: [],
  };

  it.effect("does not treat maxSteps as the MCP tool-call budget", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockExecutableClient(dispatched);
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
        stopWhen?: unknown;
      }) => {
        invokeWrappedExecutes(config, 9);
        return Promise.resolve(completedGeneration);
      }) as never);

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, maxSteps: 32 }),
      );
      const generateConfig = generateTextMock.mock.calls[0]?.[0] as { stopWhen?: unknown };

      assert.strictEqual(DEFAULT_OPENROUTER_MAX_TOOL_CALLS, 8);
      assert.strictEqual(generateTextMock.mock.calls.length, 1);
      assert.strictEqual(generateConfig.stopWhen, 32);
      assert.strictEqual(dispatched.length, 8);
      assert.strictEqual(
        dispatched.every((name) => name === "spot.getSimplePrice"),
        true,
      );
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "tool-budget-exhausted");
        assert.notInclude(serialized(result.failure), options.apiKey);
        assert.notInclude(serialized(result.failure), "MCP tool-call budget exhausted");
      }
      assert.strictEqual(client.close.mock.calls.length, 1);
    }),
  );

  it.effect("rejects a ninth MCP tool execution in one generation step", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockExecutableClient(dispatched);
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
      }) => {
        const rejections = invokeWrappedExecutes(config, 9);
        assert.strictEqual(rejections.length, 1);
        return Promise.resolve(completedGeneration);
      }) as never);

      const result = yield* Effect.result(runOpenRouterPluginEvalTrial(evalCase, options));

      assert.strictEqual(generateTextMock.mock.calls.length, 1);
      assert.strictEqual(dispatched.length, 8);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "tool-budget-exhausted");
      }
    }),
  );

  it.effect("remaps a generation throw after tool-budget exhaustion", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockExecutableClient(dispatched);
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
      }) => {
        invokeWrappedExecutes(config, 8);
        config.tools?.spot_getSimplePrice?.execute?.({ ids: "ethereum" });
        return Promise.resolve(completedGeneration);
      }) as never);

      const result = yield* Effect.result(runOpenRouterPluginEvalTrial(evalCase, options));

      assert.strictEqual(generateTextMock.mock.calls.length, 1);
      assert.strictEqual(dispatched.length, 8);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "tool-budget-exhausted");
        assert.notInclude(serialized(result.failure), "generation-failed");
      }
    }),
  );

  it.effect("shares one per-trial counter across concurrent MCP tool executes", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockExecutableClient(dispatched);
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
      }) => {
        const executePrice = config.tools?.spot_getSimplePrice?.execute;
        const executePortfolio = config.tools?.gina_getCrosschainPortfolio?.execute;
        const attempts = Array.from({ length: 9 }, (_, index) => {
          const execute = index % 2 === 0 ? executePrice : executePortfolio;
          try {
            return Promise.resolve(execute?.({ n: index }));
          } catch (error) {
            return Promise.reject(error);
          }
        });
        return Promise.allSettled(attempts).then(() => completedGeneration);
      }) as never);

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, maxSteps: 1 }),
      );

      assert.strictEqual(generateTextMock.mock.calls.length, 1);
      assert.strictEqual(dispatched.length, 8);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "tool-budget-exhausted");
      }
    }),
  );

  it.effect("allows exactly eight MCP tool executions and keeps captured names", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockExecutableClient(dispatched);
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
      }) => {
        invokeWrappedExecutes(config, 8);
        return Promise.resolve({
          text: "ETH is $3,200.",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          steps: [
            {
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              toolCalls: Array.from({ length: 8 }, (_, index) => ({
                type: "tool-call",
                toolCallId: `call_${index + 1}`,
                toolName: "spot_getSimplePrice",
                input: { ids: "ethereum", n: index },
              })),
              content: Array.from({ length: 8 }, (_, index) => ({
                type: "tool-result",
                toolCallId: `call_${index + 1}`,
                toolName: "spot_getSimplePrice",
                output: { ok: true },
              })),
              performance: {
                toolExecutionMs: Object.fromEntries(
                  Array.from({ length: 8 }, (_, index) => [`call_${index + 1}`, 1]),
                ),
              },
            },
          ],
        });
      }) as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, {
        ...options,
        maxToolCalls: DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
      });

      assert.strictEqual(generateTextMock.mock.calls.length, 1);
      assert.strictEqual(dispatched.length, 8);
      assert.strictEqual(observation.status, "completed");
      assert.strictEqual(observation.error, undefined);
      assert.strictEqual(observation.activated_skills, undefined);
      assert.strictEqual(observation.tool_calls.length, 8);
      assert.deepStrictEqual(
        observation.tool_calls.map((call) => call.name),
        Array.from({ length: 8 }, () => "spot.getSimplePrice"),
      );
      assert.deepStrictEqual(observation.tool_calls[0]?.arguments, { ids: "ethereum", n: 0 });
      assert.strictEqual(
        observation.tool_calls.every((call) => call.error === undefined),
        true,
      );
    }),
  );

  it.effect("honors a tighter maxToolCalls independently of maxSteps", () =>
    Effect.gen(function* () {
      const dispatched: string[] = [];
      const client = mockExecutableClient(dispatched);
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockImplementation(((config: {
        tools?: Record<string, { execute?: (input: unknown) => unknown }>;
      }) => {
        invokeWrappedExecutes(config, 2);
        return Promise.resolve(completedGeneration);
      }) as never);

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, { ...options, maxSteps: 8, maxToolCalls: 1 }),
      );
      const generateConfig = generateTextMock.mock.calls[0]?.[0] as { stopWhen?: unknown };

      assert.strictEqual(generateConfig.stopWhen, 8);
      assert.strictEqual(dispatched.length, 1);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "tool-budget-exhausted");
      }
    }),
  );

  it.effect("accepts the allowlisted alpha Gina read URL", () =>
    Effect.gen(function* () {
      const client = mockClient();
      createMCPClientMock.mockResolvedValue(client as never);
      generateTextMock.mockResolvedValue(completedGeneration as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, {
        ...options,
        serverUrl: ALPHA_GINA_READ_SERVER_URL,
      });
      const mcpConfig = createMCPClientMock.mock.calls[0]?.[0] as {
        transport?: { url?: string };
      };

      assert.strictEqual(observation.status, "completed");
      assert.strictEqual(mcpConfig.transport?.url, ALPHA_GINA_READ_SERVER_URL);
    }),
  );

  const toolCallCompletion = {
    id: "gen-eval-1",
    object: "chat.completion",
    created: 0,
    model: "openai/gpt-4o",
    provider: "OpenAI",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "spot_getSimplePrice",
                arguments: '{"ids":"ethereum"}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.001 },
  };

  const finalCompletion = {
    id: "gen-eval-2",
    object: "chat.completion",
    created: 0,
    model: "openai/gpt-4o",
    provider: "OpenAI",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ETH is $3,200." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7, cost: 0.002 },
  };

  it.effect("captures each generation before MCP tool execute on the adapter path", () =>
    Effect.gen(function* () {
      const actualAi = (yield* Effect.promise(() => vi.importActual("ai"))) as typeof AiModule;
      const actualOpenRouter = (yield* Effect.promise(() =>
        vi.importActual("@openrouter/ai-sdk-provider"),
      )) as typeof OpenRouterModule;
      const events: string[] = [];
      const records: OpenRouterGenerationEvidence[] = [];
      const completions = [toolCallCompletion, finalCompletion];
      let completionIndex = 0;
      generateTextMock.mockImplementation(actualAi.generateText);
      isStepCountMock.mockImplementation(actualAi.isStepCount);
      createOpenRouterMock.mockImplementation((settings) =>
        actualOpenRouter.createOpenRouter({
          ...settings,
          fetch: ((_input) => {
            const completion = completions[completionIndex] ?? finalCompletion;
            completionIndex += 1;
            return Promise.resolve(
              new Response(JSON.stringify(completion), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }) as typeof fetch,
        }),
      );
      const client = mockClient();
      client.toolsFromDefinitions.mockImplementation(((definitions: {
        tools: readonly { name: string }[];
      }) =>
        Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            actualAi.tool({
              inputSchema: actualAi.jsonSchema({
                type: "object",
                additionalProperties: true,
              }),
              execute: () => {
                events.push(`tool:${name}`);
                return Promise.resolve({ ok: true });
              },
            }),
          ]),
        )) as unknown as typeof client.toolsFromDefinitions);
      createMCPClientMock.mockResolvedValue(client as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, {
        ...options,
        maxSteps: 2,
        onGenerationEvidence: (record) => {
          events.push(`evidence:${record.step}`);
          records.push(record);
          return Promise.resolve();
        },
      });

      assert.strictEqual(observation.status, "completed");
      assert.deepStrictEqual(events, ["evidence:1", "tool:spot.getSimplePrice", "evidence:2"]);
      assert.deepStrictEqual(records, [
        {
          generationId: "gen-eval-1",
          responseModel: "openai/gpt-4o",
          provider: "OpenAI",
          step: 1,
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          cost: 0.001,
        },
        {
          generationId: "gen-eval-2",
          responseModel: "openai/gpt-4o",
          provider: "OpenAI",
          step: 2,
          inputTokens: 4,
          outputTokens: 3,
          totalTokens: 7,
          cost: 0.002,
        },
      ]);
      assert.notInclude(serialized(records), options.apiKey);
      assert.notInclude(serialized(records), options.mcpAuthorization);
      assert.notInclude(serialized(records), "reasoning");
      assert.notInclude(serialized(observation), options.apiKey);
    }),
  );

  it.effect("records unavailable generation metadata as null", () =>
    Effect.gen(function* () {
      const actualAi = (yield* Effect.promise(() => vi.importActual("ai"))) as typeof AiModule;
      const actualOpenRouter = (yield* Effect.promise(() =>
        vi.importActual("@openrouter/ai-sdk-provider"),
      )) as typeof OpenRouterModule;
      const records: OpenRouterGenerationEvidence[] = [];
      generateTextMock.mockImplementation(actualAi.generateText);
      isStepCountMock.mockImplementation(actualAi.isStepCount);
      createOpenRouterMock.mockImplementation((settings) =>
        actualOpenRouter.createOpenRouter({
          ...settings,
          fetch: ((_input) =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  object: "chat.completion",
                  created: 0,
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: "ETH is $3,200." },
                      finish_reason: "stop",
                    },
                  ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            )) as typeof fetch,
        }),
      );
      const client = mockClient();
      client.toolsFromDefinitions.mockImplementation(((definitions: {
        tools: readonly { name: string }[];
      }) =>
        Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            actualAi.tool({
              inputSchema: actualAi.jsonSchema({
                type: "object",
                additionalProperties: true,
              }),
              execute: () => Promise.resolve({}),
            }),
          ]),
        )) as unknown as typeof client.toolsFromDefinitions);
      createMCPClientMock.mockResolvedValue(client as never);

      const observation = yield* runOpenRouterPluginEvalTrial(evalCase, {
        ...options,
        onGenerationEvidence: (record) => {
          records.push(record);
          return Promise.resolve();
        },
      });

      assert.strictEqual(observation.status, "completed");
      assert.strictEqual(records.length, 1);
      assert.deepStrictEqual(records[0], {
        generationId: null,
        responseModel: null,
        provider: null,
        step: 1,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cost: null,
      });
    }),
  );

  it.effect("rejects a sink failure before MCP tool dispatch and cannot succeed", () =>
    Effect.gen(function* () {
      const actualAi = (yield* Effect.promise(() => vi.importActual("ai"))) as typeof AiModule;
      const actualOpenRouter = (yield* Effect.promise(() =>
        vi.importActual("@openrouter/ai-sdk-provider"),
      )) as typeof OpenRouterModule;
      const dispatched: string[] = [];
      generateTextMock.mockImplementation(actualAi.generateText);
      isStepCountMock.mockImplementation(actualAi.isStepCount);
      createOpenRouterMock.mockImplementation((settings) =>
        actualOpenRouter.createOpenRouter({
          ...settings,
          fetch: ((_input) =>
            Promise.resolve(
              new Response(JSON.stringify(toolCallCompletion), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            )) as typeof fetch,
        }),
      );
      const client = mockClient();
      client.toolsFromDefinitions.mockImplementation(((definitions: {
        tools: readonly { name: string }[];
      }) =>
        Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            actualAi.tool({
              inputSchema: actualAi.jsonSchema({
                type: "object",
                additionalProperties: true,
              }),
              execute: () => {
                dispatched.push(name);
                return Promise.resolve({ ok: true });
              },
            }),
          ]),
        )) as unknown as typeof client.toolsFromDefinitions);
      createMCPClientMock.mockResolvedValue(client as never);

      const result = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, {
          ...options,
          onGenerationEvidence: () => Promise.reject(new Error("journal-write-must-not-leak")),
        }),
      );

      assert.strictEqual(dispatched.length, 0);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(result.failure.reason, "evidence-write-failed");
        assert.notInclude(serialized(result.failure), "journal-write-must-not-leak");
        assert.notInclude(serialized(result.failure), options.apiKey);
      }
      assert.strictEqual(client.close.mock.calls.length, 1);

      dispatched.length = 0;
      const syncClient = mockClient();
      syncClient.toolsFromDefinitions.mockImplementation(((definitions: {
        tools: readonly { name: string }[];
      }) =>
        Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            actualAi.tool({
              inputSchema: actualAi.jsonSchema({
                type: "object",
                additionalProperties: true,
              }),
              execute: () => {
                dispatched.push(name);
                return Promise.resolve({ ok: true });
              },
            }),
          ]),
        )) as unknown as typeof syncClient.toolsFromDefinitions);
      createMCPClientMock.mockResolvedValue(syncClient as never);

      const syncResult = yield* Effect.result(
        runOpenRouterPluginEvalTrial(evalCase, {
          ...options,
          onGenerationEvidence: () => {
            throw new Error("journal-write-must-not-leak");
          },
        }),
      );

      assert.strictEqual(dispatched.length, 0);
      assert.strictEqual(syncResult._tag, "Failure");
      if (syncResult._tag === "Failure") {
        assert.instanceOf(syncResult.failure, PluginEvalOpenRouterGenerationError);
        assert.strictEqual(syncResult.failure.reason, "evidence-write-failed");
        assert.notInclude(serialized(syncResult.failure), "journal-write-must-not-leak");
        assert.notInclude(serialized(syncResult.failure), options.apiKey);
      }
      assert.strictEqual(syncClient.close.mock.calls.length, 1);
    }),
  );

  it.effect(
    "rejects missing or mismatched providers before tools without treating aliases as verified",
    () =>
      Effect.gen(function* () {
        const actualAi = (yield* Effect.promise(() => vi.importActual("ai"))) as typeof AiModule;
        const actualOpenRouter = (yield* Effect.promise(() =>
          vi.importActual("@openrouter/ai-sdk-provider"),
        )) as typeof OpenRouterModule;
        const dispatched: string[] = [];
        generateTextMock.mockImplementation(actualAi.generateText);
        isStepCountMock.mockImplementation(actualAi.isStepCount);

        const respondWith = (body: unknown) => {
          createOpenRouterMock.mockImplementation((settings) =>
            actualOpenRouter.createOpenRouter({
              ...settings,
              fetch: ((_input) =>
                Promise.resolve(
                  new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  }),
                )) as typeof fetch,
            }),
          );
        };
        const installTools = () => {
          const nextClient = mockClient();
          nextClient.toolsFromDefinitions.mockImplementation(((definitions: {
            tools: readonly { name: string }[];
          }) =>
            Object.fromEntries(
              definitions.tools.map(({ name }) => [
                name,
                actualAi.tool({
                  inputSchema: actualAi.jsonSchema({
                    type: "object",
                    additionalProperties: true,
                  }),
                  execute: () => {
                    dispatched.push(name);
                    return Promise.resolve({ ok: true });
                  },
                }),
              ]),
            )) as unknown as typeof nextClient.toolsFromDefinitions);
          createMCPClientMock.mockResolvedValue(nextClient as never);
        };

        installTools();
        respondWith({ ...finalCompletion, model: "openai/gpt-4o-2024-08-06" });
        const aliasRecords: OpenRouterGenerationEvidence[] = [];
        const aliased = yield* runOpenRouterPluginEvalTrial(evalCase, {
          ...options,
          expectedProvider: "OpenAI",
          onGenerationEvidence: (record) => {
            aliasRecords.push(record);
            return Promise.resolve();
          },
        });
        assert.strictEqual(aliased.status, "completed");
        assert.strictEqual(aliasRecords[0]?.responseModel, "openai/gpt-4o-2024-08-06");
        assert.strictEqual(aliasRecords[0]?.provider, "OpenAI");
        assert.strictEqual(dispatched.length, 0);

        installTools();
        respondWith({ ...toolCallCompletion, provider: undefined });
        const missingRecords: OpenRouterGenerationEvidence[] = [];
        const missingProvider = yield* Effect.result(
          runOpenRouterPluginEvalTrial(evalCase, {
            ...options,
            expectedProvider: "OpenAI",
            onGenerationEvidence: (record) => {
              missingRecords.push(record);
              return Promise.resolve();
            },
          }),
        );
        assert.strictEqual(dispatched.length, 0);
        assert.strictEqual(missingRecords[0]?.provider, null);
        assert.strictEqual(missingProvider._tag, "Failure");
        if (missingProvider._tag === "Failure") {
          assert.instanceOf(missingProvider.failure, PluginEvalOpenRouterGenerationError);
          assert.strictEqual(missingProvider.failure.reason, "evidence-missing");
        }

        installTools();
        respondWith({ ...toolCallCompletion, provider: "Anthropic" });
        const mismatch = yield* Effect.result(
          runOpenRouterPluginEvalTrial(evalCase, {
            ...options,
            expectedProvider: "OpenAI",
            onGenerationEvidence: () => Promise.resolve(),
          }),
        );
        assert.strictEqual(dispatched.length, 0);
        assert.strictEqual(mismatch._tag, "Failure");
        if (mismatch._tag === "Failure") {
          assert.instanceOf(mismatch.failure, PluginEvalOpenRouterGenerationError);
          assert.strictEqual(mismatch.failure.reason, "observed-mismatch");
        }
      }),
  );
});
