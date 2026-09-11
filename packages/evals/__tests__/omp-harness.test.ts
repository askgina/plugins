import type {
  HarnessAgentAdapter,
  HarnessAgentSession,
  HarnessAgentSettings,
} from "@ai-sdk/harness/agent";
import type { ListToolsResult } from "@ai-sdk/mcp";
import type { JSONSchema7 } from "@ai-sdk/provider";
import {
  GINA_CONNECTED_TOOL_NAMES,
  GINA_DYNAMIC_WIDGET_TOOL,
  listCatalogToolNames,
  SKILL_NAMES,
} from "@askgina/contracts";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { jsonSchema, type GenerateTextResult, type StepResult, type ToolSet } from "ai";
import {
  Cause,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Redacted,
} from "effect";
import { TestClock } from "effect/testing";
import { beforeEach, vi } from "vitest";

import { gradePluginEvalObservation } from "../src/grading";
import { loadPluginEvalSuite } from "../src/load-suite";
import {
  PluginEvalOmpHarnessProcessError,
  PluginEvalOmpHarnessTranscriptError,
  runOmpHarnessPluginEvalTrial,
  type OmpHarnessTrialOptions,
} from "../src/omp-harness";
import type { OmpTrialTranscript } from "../src/omp-transcript";

const fixture = vi.hoisted(() => ({
  failedRead: false,
  extraNativeCall: false,
  priceCallCount: 1,
  extraPriceMirror: false,
  mismatchedMirrorArguments: false,
  generateCalls: 0,
  streamCalls: 0,
  destroyCalls: 0,
  destroyFails: false,
  streamMode: "success" as "success" | "terminal-error" | "hang",
  streamSecretText: false,
  lastPrompt: undefined as string | undefined,
  onStreamWait: undefined as (() => void) | undefined,
}));
const PRICE_TOOL = "spot.getSimplePrice";
const PRICE_ARGUMENTS = { ids: "ethereum", vs_currencies: "usd" };
const PRICE_RESULT = {
  content: [{ type: "text", text: '{"ethereum":{"usd":3200}}' }],
};
const SKILL_CONTENT = "Use canonical read-only market tools.\n";
const PRICE_SCHEMA = {
  type: "object",
  properties: {
    ids: { type: "string" },
    vs_currencies: { type: "string" },
  },
  required: ["ids", "vs_currencies"],
  additionalProperties: false,
} satisfies JSONSchema7;

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(() =>
    Promise.resolve({
      listTools: (): Promise<ListToolsResult> =>
        Promise.resolve({
          tools: GINA_CONNECTED_TOOL_NAMES.map((name) => ({
            name,
            inputSchema: name === PRICE_TOOL ? PRICE_SCHEMA : { type: "object" },
          })),
        }),
      toolsFromDefinitions: (definitions: ListToolsResult): ToolSet => {
        assert.notInclude(
          definitions.tools.map(({ name }) => name),
          GINA_DYNAMIC_WIDGET_TOOL,
        );
        return Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            {
              inputSchema: jsonSchema(name === PRICE_TOOL ? PRICE_SCHEMA : { type: "object" }),
              execute: () =>
                name === PRICE_TOOL
                  ? Promise.resolve(PRICE_RESULT)
                  : Promise.reject(new Error(`Unexpected fixture tool: ${name}`)),
            },
          ]),
        );
      },
      close: () => Promise.resolve(),
    }),
  ),
}));

vi.mock("@ai-sdk/harness-acp", () => ({
  createACP: vi.fn(() => ({})),
}));

type AgentSettings = HarnessAgentSettings<HarnessAgentAdapter, ToolSet>;
type GenerationEvidence = Pick<
  GenerateTextResult<ToolSet, Record<string, unknown>, never>,
  "text" | "finishReason" | "usage" | "steps"
>;

// Use actual SDK field types without casting partial objects to StepResult.
const sdkStep = (
  stepNumber: number,
  content: StepResult<ToolSet>["content"],
): StepResult<ToolSet> => {
  const toolCalls = content.filter((part) => part.type === "tool-call");
  const toolResults = content.filter((part) => part.type === "tool-result");
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  return {
    callId: "fixture-generation",
    stepNumber,
    model: { provider: "fixture", modelId: "fixture-model" },
    toolsContext: {},
    runtimeContext: {},
    content,
    text,
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls,
    staticToolCalls: toolCalls.filter((call) => call.dynamic !== true),
    dynamicToolCalls: toolCalls.filter((call) => call.dynamic === true),
    toolResults,
    staticToolResults: toolResults.filter((result) => result.dynamic !== true),
    dynamicToolResults: toolResults.filter((result) => result.dynamic === true),
    finishReason: text.length === 0 ? "tool-calls" : "stop",
    rawFinishReason: undefined,
    usage: {
      inputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 0,
    },
    performance: {
      effectiveOutputTokensPerSecond: 0,
      outputTokensPerSecond: undefined,
      inputTokensPerSecond: undefined,
      effectiveTotalTokensPerSecond: 0,
      stepTimeMs: 0,
      responseTimeMs: 0,
      toolExecutionMs: {},
      timeToFirstOutputMs: undefined,
    },
    warnings: [],
    request: {},
    response: {
      messages: [],
      id: `fixture-response-${stepNumber}`,
      timestamp: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-10T00:00:00.000Z")),
      modelId: "fixture-model",
    },
    providerMetadata: undefined,
  };
};

vi.mock("@ai-sdk/harness/agent", () => ({
  HarnessAgent: class {
    readonly settings: AgentSettings;
    readonly tools: ToolSet;

    constructor(settings: AgentSettings) {
      if (settings.tools === undefined) throw new Error("Missing model-facing host tools");
      assert.notProperty(settings.tools, GINA_DYNAMIC_WIDGET_TOOL);
      assert.sameMembers(Object.keys(settings.tools), [...listCatalogToolNames()]);
      this.settings = settings;
      this.tools = settings.tools;
    }

    createSession(options: { readonly abortSignal?: AbortSignal }) {
      const sandbox = this.settings.sandbox;
      if (sandbox === undefined) throw new Error("Missing filesystem sandbox");
      // Register the real sandbox cleanup; never install or spawn the ACP process.
      return Promise.resolve(sandbox.createSession(options)).then(
        (session) =>
          ({
            destroy: () => {
              fixture.destroyCalls += 1;
              return fixture.destroyFails
                ? Promise.reject(new Error("Fixture session cleanup failed"))
                : Promise.resolve(session.destroy());
            },
          }) satisfies Pick<HarnessAgentSession, "destroy">,
      );
    }

    generate(): Promise<GenerationEvidence> {
      fixture.generateCalls += 1;
      const readCall = {
        type: "tool-call",
        toolCallId: "native-skill-read",
        toolName: "read",
        input: { path: "skill://research-spot-tokens" },
        providerExecuted: true,
      } satisfies StepResult<ToolSet>["toolCalls"][number];
      const readOutcome: StepResult<ToolSet>["content"][number] = fixture.failedRead
        ? { ...readCall, type: "tool-error", error: new Error("Fixture skill read failed") }
        : { ...readCall, type: "tool-result", output: SKILL_CONTENT };
      const price = this.tools[PRICE_TOOL];
      if (price?.execute === undefined) throw new Error("Missing executable price host tool");
      const executePrice = price.execute;
      return Effect.runPromise(
        Effect.gen(function* () {
          const steps = [sdkStep(0, [readCall, readOutcome])];
          const mirrorCount = fixture.priceCallCount + (fixture.extraPriceMirror ? 1 : 0);
          for (let index = 0; index < mirrorCount; index += 1) {
            if (index < fixture.priceCallCount) {
              const priceCall = {
                type: "tool-call",
                toolCallId: `host-price-call-${index}`,
                toolName: PRICE_TOOL,
                input: PRICE_ARGUMENTS,
                providerExecuted: false,
              } satisfies StepResult<ToolSet>["toolCalls"][number];
              const output = yield* Effect.promise(() =>
                Promise.resolve(
                  executePrice(PRICE_ARGUMENTS, {
                    toolCallId: priceCall.toolCallId,
                    messages: [],
                    context: {},
                  }),
                ),
              );
              steps.push(
                sdkStep(steps.length, [priceCall, { ...priceCall, type: "tool-result", output }]),
              );
            }
            const nativeCallId = `native-price-call-${index}`;
            const mirrorCall = {
              type: "tool-call",
              toolCallId: nativeCallId,
              toolName: `acp_tool_call_${nativeCallId}`,
              input: fixture.mismatchedMirrorArguments
                ? { ...PRICE_ARGUMENTS, vs_currencies: "eur" }
                : PRICE_ARGUMENTS,
              providerExecuted: true,
            } satisfies StepResult<ToolSet>["toolCalls"][number];
            steps.push(
              sdkStep(steps.length, [
                mirrorCall,
                {
                  ...mirrorCall,
                  type: "tool-result",
                  output: {
                    content: [{ type: "text", text: "public fixture" }],
                    details: {
                      serverName: "ai-sdk-harness-tools",
                      mcpToolName: PRICE_TOOL,
                      mcpMeta: { "ai-sdk-harness-acp-correlation": "a".repeat(64) },
                    },
                  },
                },
              ]),
            );
          }
          if (fixture.extraNativeCall) {
            const nativeCall = {
              ...readCall,
              toolCallId: "native-todo-call",
              toolName: "acp_tool_call_fixture",
              input: { todos: [{ content: "Look up Ethereum price", status: "completed" }] },
            } satisfies StepResult<ToolSet>["toolCalls"][number];
            steps.push(
              sdkStep(steps.length, [
                nativeCall,
                { ...nativeCall, type: "tool-result", output: "Todo updated." },
              ]),
            );
          }
          const finalStep = sdkStep(steps.length, [
            { type: "text", text: "Ethereum is $3,200 USD." },
          ]);
          steps.push(finalStep);
          return {
            text: finalStep.text,
            finishReason: finalStep.finishReason,
            usage: finalStep.usage,
            steps,
          };
        }),
      );
    }

    stream(options: { readonly prompt: string; readonly abortSignal?: AbortSignal }) {
      fixture.streamCalls += 1;
      fixture.lastPrompt = options.prompt;
      return this.generate().then((evidence) => {
        const parts: Array<Record<string, unknown>> = [
          { type: "text-delta", id: "answer", text: "Checking " },
          { type: "reasoning-delta", id: "reasoning", text: "private chain" },
          { type: "text-delta", id: "answer", text: "Ethereum." },
          {
            type: "tool-call",
            toolCallId: "stream-price-call",
            toolName: PRICE_TOOL,
            input: PRICE_ARGUMENTS,
            providerExecuted: false,
          },
          { type: "raw", rawValue: { private: "provider frame" } },
          {
            type: "tool-result",
            toolCallId: "stream-price-call",
            toolName: PRICE_TOOL,
            input: PRICE_ARGUMENTS,
            output: PRICE_RESULT,
            providerExecuted: false,
          },
          {
            type: "text-delta",
            id: "answer",
            text: fixture.streamSecretText
              ? "Bearer synthetic-mcp-authorization"
              : "Ethereum is $3,200 USD.",
          },
        ];
        let index = 0;
        let pending: PromiseWithResolvers<{ done: true; value: undefined }> | undefined;
        const stream = {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              const hangAfter = 3;
              if (fixture.streamMode !== "hang" || index < hangAfter) {
                if (index < parts.length) {
                  const value = parts[index];
                  index += 1;
                  return Promise.resolve({ done: false as const, value });
                }
                return Promise.resolve({ done: true as const, value: undefined });
              }
              fixture.onStreamWait?.();
              if (pending === undefined) {
                pending = Promise.withResolvers<{ done: true; value: undefined }>();
                options.abortSignal?.addEventListener(
                  "abort",
                  () => pending?.resolve({ done: true, value: undefined }),
                  { once: true },
                );
              }
              return pending.promise;
            },
            return: () =>
              pending?.promise ?? Promise.resolve({ done: true as const, value: undefined }),
          }),
        };
        return {
          stream,
          get text() {
            return fixture.streamMode === "terminal-error"
              ? Promise.reject(new Error("Fixture terminal accessor failed"))
              : Promise.resolve(evidence.text);
          },
          finishReason: Promise.resolve(evidence.finishReason),
          usage: Promise.resolve(evidence.usage),
          steps: Promise.resolve(evidence.steps),
        };
      });
    }
  },
}));

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

const preparePriceTrial = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "omp-read-evidence-" });
  const agentDirectory = path.join(runtimeDirectory, "native-profile");
  yield* fs.makeDirectory(agentDirectory);
  for (const name of SKILL_NAMES) {
    const directory = path.join(runtimeDirectory, "skills", name);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Canonical skill fixture.\n---\n${SKILL_CONTENT}`,
    );
  }
  const suite = yield* loadPluginEvalSuite(
    path.join(process.cwd(), "plugins/ask-gina/evals/model/v1/families/spot.yaml"),
  );
  const evalCase = suite.cases.find((candidate) => candidate.id === "spot-simple-price");
  if (evalCase === undefined) return yield* Effect.die("Missing spot-simple-price suite case");
  const options = {
    runId: "omp-read-evidence",
    repetition: 1,
    availableTools: GINA_CONNECTED_TOOL_NAMES,
    runtimeDirectory,
    auth: { mode: "native" as const, provider: "fixture", agentDirectory },
    model: "fixture-model",
    reasoning: "off",
    mcpAuthorization: Redacted.make("synthetic-mcp-authorization"),
    timeoutMs: 30_000,
  } satisfies OmpHarnessTrialOptions;
  return { evalCase, options };
});

const runPriceTrial = Effect.gen(function* () {
  const { evalCase, options } = yield* preparePriceTrial;
  const observation = yield* runOmpHarnessPluginEvalTrial(evalCase, options);
  const score = yield* gradePluginEvalObservation(evalCase, observation);
  return { observation, score };
});

describe("OMP harness native read evidence", () => {
  beforeEach(() => {
    fixture.failedRead = false;
    fixture.extraNativeCall = false;
    fixture.priceCallCount = 1;
    fixture.extraPriceMirror = false;
    fixture.mismatchedMirrorArguments = false;
    fixture.generateCalls = 0;
    fixture.streamCalls = 0;
    fixture.destroyCalls = 0;
    fixture.destroyFails = false;
    fixture.streamMode = "success";
    fixture.streamSecretText = false;
    fixture.lastPrompt = undefined;
    fixture.onStreamWait = undefined;
  });

  it.layer(TestPlatformLayer)((it) => {
    it.effect(
      "grades a native skill read and Gina price with its ACP mirror as one canonical call",
      () =>
        Effect.gen(function* () {
          const { observation, score } = yield* runPriceTrial;

          assert.strictEqual(score.routing.score, 1);
          assert.strictEqual(score.arguments.score, 1);
          assert.isTrue(score.overall_pass);
          assert.strictEqual(observation.status, "completed");
          assert.deepStrictEqual(observation.activated_skills, ["research-spot-tokens"]);
          assert.deepStrictEqual(
            observation.tool_calls.map(({ name }) => name),
            [PRICE_TOOL],
          );
          assert.strictEqual(fixture.generateCalls, 1);
          assert.strictEqual(fixture.streamCalls, 0);
        }),
    );

    it.effect("captures ordered stream chat without changing terminal grading evidence", () =>
      Effect.gen(function* () {
        const { evalCase, options } = yield* preparePriceTrial;
        const transcripts: OmpTrialTranscript[] = [];
        const observation = yield* runOmpHarnessPluginEvalTrial(evalCase, {
          ...options,
          onTranscript: (transcript) => {
            transcripts.push(transcript);
            return Promise.resolve();
          },
        });
        const score = yield* gradePluginEvalObservation(evalCase, observation);
        const expectedPrompt = evalCase.turns
          .filter((turn) => turn.role === "user")
          .map((turn) => turn.content)
          .join("\n\n");

        assert.strictEqual(fixture.streamCalls, 1);
        assert.strictEqual(fixture.lastPrompt, expectedPrompt);
        assert.strictEqual(observation.final_answer, "Ethereum is $3,200 USD.");
        assert.strictEqual(score.routing.score, 1);
        assert.strictEqual(score.arguments.score, 1);
        assert.isTrue(score.overall_pass);
        assert.lengthOf(transcripts, 1);
        const [transcript] = transcripts;
        if (transcript === undefined) return;
        assert.strictEqual(transcript.status, "completed");
        assert.isFalse(transcript.truncated);
        assert.deepStrictEqual(transcript.messages, [
          { role: "user", type: "text", text: expectedPrompt },
          { role: "assistant", type: "text", text: "Checking Ethereum." },
          {
            role: "assistant",
            type: "tool-call",
            toolCallId: "stream-price-call",
            toolName: PRICE_TOOL,
            input: PRICE_ARGUMENTS,
          },
          {
            role: "tool",
            type: "tool-result",
            toolCallId: "stream-price-call",
            toolName: PRICE_TOOL,
            output: PRICE_RESULT,
            isError: false,
          },
          {
            role: "assistant",
            type: "text",
            text: "Ethereum is $3,200 USD.",
          },
        ]);
      }),
    );

    it.effect("retains partial stream when terminal accessors reject", () =>
      Effect.gen(function* () {
        fixture.streamMode = "terminal-error";
        const callbackSecret = "terminal-callback-secret-must-not-win";
        const { evalCase, options } = yield* preparePriceTrial;
        const transcripts: OmpTrialTranscript[] = [];
        const result = yield* Effect.result(
          runOmpHarnessPluginEvalTrial(evalCase, {
            ...options,
            onTranscript: (transcript) => {
              transcripts.push(transcript);
              return Promise.reject(new Error(callbackSecret));
            },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, PluginEvalOmpHarnessProcessError);
          assert.notInclude(String(result.failure), callbackSecret);
        }
        assert.lengthOf(transcripts, 1);
        const [transcript] = transcripts;
        if (transcript === undefined) return;
        assert.strictEqual(transcript.status, "failed");
        assert.deepInclude(transcript.messages, {
          role: "assistant",
          type: "text",
          text: "Ethereum is $3,200 USD.",
        });
        assert.strictEqual(fixture.destroyCalls, 1);
      }),
    );

    it.effect("retains partial stream and reports timeout after cleanup", () =>
      Effect.gen(function* () {
        fixture.streamMode = "hang";
        const ready = yield* Deferred.make<void>();
        fixture.onStreamWait = () => {
          void Deferred.doneUnsafe(ready, Effect.void);
        };
        const { evalCase, options } = yield* preparePriceTrial;
        const transcripts: OmpTrialTranscript[] = [];
        const fiber = yield* Effect.forkChild(
          runOmpHarnessPluginEvalTrial(evalCase, {
            ...options,
            timeoutMs: 1_000,
            onTranscript: (transcript, signal) => {
              assert.isFalse(signal.aborted);
              transcripts.push(transcript);
              return Promise.resolve();
            },
          }),
        );
        yield* Deferred.await(ready);
        yield* TestClock.adjust(Duration.millis(1_000));
        const exit = yield* Fiber.await(fiber);

        assert.isTrue(Exit.isFailure(exit));
        assert.lengthOf(transcripts, 1);
        const [transcript] = transcripts;
        if (transcript === undefined) return;
        assert.strictEqual(transcript.status, "timeout");
        assert.deepInclude(transcript.messages, {
          role: "assistant",
          type: "text",
          text: "Checking Ethereum.",
        });
        assert.strictEqual(fixture.destroyCalls, 1);
      }),
    );

    it.effect("retains partial stream without swallowing parent interruption", () =>
      Effect.gen(function* () {
        fixture.streamMode = "hang";
        const ready = yield* Deferred.make<void>();
        fixture.onStreamWait = () => {
          void Deferred.doneUnsafe(ready, Effect.void);
        };
        const callbackSecret = "interrupt-callback-secret-must-not-win";
        const { evalCase, options } = yield* preparePriceTrial;
        const transcripts: OmpTrialTranscript[] = [];
        const fiber = yield* Effect.forkChild(
          runOmpHarnessPluginEvalTrial(evalCase, {
            ...options,
            onTranscript: (transcript, signal) => {
              assert.isFalse(signal.aborted);
              transcripts.push(transcript);
              return Promise.reject(new Error(callbackSecret));
            },
          }),
        );
        yield* Deferred.await(ready);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.isTrue(Cause.hasInterrupts(exit.cause));
          assert.notInclude(String(exit.cause), callbackSecret);
        }
        assert.lengthOf(transcripts, 1);
        const [transcript] = transcripts;
        if (transcript === undefined) return;
        assert.strictEqual(transcript.status, "interruption");
        assert.deepInclude(transcript.messages, {
          role: "assistant",
          type: "text",
          text: "Checking Ethereum.",
        });
      }),
    );

    it.effect("fails a successful trial with a value-free callback rejection after cleanup", () =>
      Effect.gen(function* () {
        fixture.streamSecretText = true;
        const callbackSecret = "callback-secret-must-not-leak";
        const { evalCase, options } = yield* preparePriceTrial;
        const transcripts: OmpTrialTranscript[] = [];
        let cleanupCountAtCallback = 0;
        const result = yield* Effect.result(
          runOmpHarnessPluginEvalTrial(evalCase, {
            ...options,
            onTranscript: (transcript) => {
              cleanupCountAtCallback = fixture.destroyCalls;
              transcripts.push(transcript);
              return Promise.reject(new Error(callbackSecret));
            },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, PluginEvalOmpHarnessTranscriptError);
          if (result.failure instanceof PluginEvalOmpHarnessTranscriptError) {
            assert.strictEqual(result.failure.reason, "write-failed");
          }
          const failureText = String(result.failure);
          assert.notInclude(failureText, callbackSecret);
          assert.notInclude(failureText, "synthetic-mcp-authorization");
        }
        assert.strictEqual(cleanupCountAtCallback, 1);
        assert.lengthOf(transcripts, 1);
        const [transcript] = transcripts;
        if (transcript === undefined) return;
        assert.strictEqual(transcript.status, "completed");
        const finalMessage = transcript.messages.at(-1);
        assert.strictEqual(finalMessage?.type, "text");
        if (finalMessage?.type === "text") {
          assert.notInclude(finalMessage.text, "synthetic-mcp-authorization");
          assert.include(finalMessage.text, "[redacted]");
        }
      }),
    );

    it.effect("stops a successful trial when transcript persistence never settles", () =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const pending = Promise.withResolvers<void>();
        let callbackCancelled = false;
        const { evalCase, options } = yield* preparePriceTrial;
        const fiber = yield* Effect.forkChild(
          runOmpHarnessPluginEvalTrial(evalCase, {
            ...options,
            onTranscript: (_transcript, signal) => {
              signal.addEventListener(
                "abort",
                () => {
                  callbackCancelled = true;
                  pending.resolve();
                },
                { once: true },
              );
              void Deferred.doneUnsafe(ready, Effect.void);
              return pending.promise;
            },
          }),
        );
        yield* Deferred.await(ready);
        yield* TestClock.adjust(Duration.millis(5_000));
        const result = yield* Fiber.join(fiber).pipe(Effect.result);

        assert.isTrue(callbackCancelled);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, PluginEvalOmpHarnessTranscriptError);
          if (result.failure instanceof PluginEvalOmpHarnessTranscriptError) {
            assert.strictEqual(result.failure.reason, "write-timeout");
          }
        }
      }),
    );

    it.effect("reports failed transcript status when settled cleanup fails", () =>
      Effect.gen(function* () {
        fixture.destroyFails = true;
        const { evalCase, options } = yield* preparePriceTrial;
        const transcripts: OmpTrialTranscript[] = [];
        let cleanupCountAtCallback = 0;
        const result = yield* Effect.result(
          runOmpHarnessPluginEvalTrial(evalCase, {
            ...options,
            onTranscript: (transcript) => {
              cleanupCountAtCallback = fixture.destroyCalls;
              transcripts.push(transcript);
              return Promise.resolve();
            },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        assert.strictEqual(cleanupCountAtCallback, 1);
        assert.lengthOf(transcripts, 1);
        assert.strictEqual(transcripts[0]?.status, "failed");
      }),
    );

    it.effect(
      "keeps a failed native skill read incomplete without contaminating Gina routing",
      () =>
        Effect.gen(function* () {
          fixture.failedRead = true;
          const { observation, score } = yield* runPriceTrial;

          assert.strictEqual(observation.status, "failed");
          assert.deepStrictEqual(observation.activated_skills, []);
          assert.strictEqual(score.completion.score, 0);
          assert.isFalse(score.overall_pass);
          assert.strictEqual(score.routing.score, 1);
          assert.strictEqual(score.arguments.score, 1);
        }),
    );

    it.effect("keeps generated native calls in evidence and fails exact Gina routing", () =>
      Effect.gen(function* () {
        fixture.extraNativeCall = true;
        const { observation, score } = yield* runPriceTrial;

        assert.strictEqual(observation.status, "completed");
        assert.deepStrictEqual(observation.activated_skills, ["research-spot-tokens"]);
        assert.deepStrictEqual(
          observation.tool_calls.map(({ name }) => name),
          [PRICE_TOOL, "acp_tool_call_fixture"],
        );
        assert.strictEqual(score.routing.score, 0);
        assert.isFalse(score.overall_pass);
      }),
    );

    it.effect(
      "retains repeated real Gina executions even when both have matching ACP mirrors",
      () =>
        Effect.gen(function* () {
          fixture.priceCallCount = 2;
          const { observation, score } = yield* runPriceTrial;

          assert.deepStrictEqual(
            observation.tool_calls.map(({ name }) => name),
            [PRICE_TOOL, PRICE_TOOL],
          );
          assert.strictEqual(score.routing.score, 0);
          assert.isFalse(score.overall_pass);
        }),
    );

    it.effect("does not reuse one captured host execution to hide a second ACP mirror", () =>
      Effect.gen(function* () {
        fixture.extraPriceMirror = true;
        const { observation, score } = yield* runPriceTrial;

        assert.deepStrictEqual(
          observation.tool_calls.map(({ name }) => name),
          [PRICE_TOOL, "acp_tool_call_native-price-call-1"],
        );
        assert.strictEqual(score.routing.score, 0);
        assert.isFalse(score.overall_pass);
      }),
    );

    it.effect("keeps an ACP mirror with mismatched arguments in exact routing evidence", () =>
      Effect.gen(function* () {
        fixture.mismatchedMirrorArguments = true;
        const { observation, score } = yield* runPriceTrial;

        assert.deepStrictEqual(
          observation.tool_calls.map(({ name }) => name),
          [PRICE_TOOL, "acp_tool_call_native-price-call-0"],
        );
        assert.strictEqual(score.routing.score, 0);
        assert.isFalse(score.overall_pass);
      }),
    );
  });
});
