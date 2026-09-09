import { createMCPClient } from "@ai-sdk/mcp";
import { listCatalogToolNames, PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { generateText } from "ai";
import { Cause, Clock, Effect, Exit, Fiber } from "effect";
import { beforeEach, vi } from "vitest";

import type { PluginEvalCase } from "../src/contracts";
import {
  PluginEvalOpenRouterGenerationError,
  PluginEvalOpenRouterMcpError,
  PluginEvalOpenRouterRequestError,
  PluginEvalOpenRouterTimeoutError,
  type OpenRouterTrialOptions,
  runOpenRouterPluginEvalTrial,
} from "../src/openrouter";

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => (modelId: string) => ({ modelId })),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  isStepCount: (count: number) => count,
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
const generateTextMock = vi.mocked(generateText);

const options = {
  apiKey: "synthetic-openrouter-key",
  mcpAuthorization: "gina-read-secret",
  model: "openai/gpt-4o",
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
});
