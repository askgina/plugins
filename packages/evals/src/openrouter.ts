import { createMCPClient, type ListToolsResult, type MCPClient } from "@ai-sdk/mcp";
import { listCatalogToolNames } from "@askgina/contracts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount, wrapLanguageModel, type StepResult, type ToolSet } from "ai";
import { Clock, Data, DateTime, Duration, Effect, Exit, Function } from "effect";

import type {
  PluginEvalCase,
  PluginEvalObservation,
  PluginEvalTokenUsage,
  PluginEvalToolCall,
} from "./contracts";
import { isExactOpenRouterEndpointSlug } from "./profile-identity";
import {
  captureOpenRouterGenerationEvidence,
  type OpenRouterGenerationEvidence,
} from "./provider-evidence";
import { isAllowedGinaReadServerUrl } from "./server-url";

export { isExactOpenRouterEndpointSlug } from "./profile-identity";
export type { OpenRouterGenerationEvidence } from "./provider-evidence";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_OPENROUTER_MAX_TOOL_CALLS = 8;
const MAX_MAX_STEPS = 32;
const MAX_MCP_TOOL_PAGES = 32;
const MAX_MCP_CLOSE_WAIT_MS = 1_000;
const INCOMPLETE_GENERATION_ERROR = "OpenRouter generation did not complete with a final answer";
const UTF8_ENCODER = new TextEncoder();
const CANONICAL_ALLOWED_TOOLS = listCatalogToolNames();
const OPENROUTER_WIRE_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const OPENROUTER_REASONING_EFFORTS = {
  none: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
} as const;

type OpenRouterReasoningEffort = keyof typeof OPENROUTER_REASONING_EFFORTS;

export interface OpenRouterTrialOptions {
  readonly apiKey: string;
  readonly mcpAuthorization: string;
  readonly model: string;
  readonly endpoint: string;
  readonly reasoning: string;
  readonly runId: string;
  readonly repetition: number;
  readonly serverUrl: string;
  readonly allowedTools: readonly string[];
  readonly timeoutMs?: number;
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly expectedProvider?: string;
  readonly onGenerationEvidence?: (record: OpenRouterGenerationEvidence) => Promise<void>;
}

interface ValidatedOpenRouterTrialOptions {
  readonly apiKey: string;
  readonly mcpAuthorization: string;
  readonly model: string;
  readonly endpoint: string;
  readonly reasoning: OpenRouterReasoningEffort;
  readonly runId: string;
  readonly repetition: number;
  readonly serverUrl: string;
  readonly allowedTools: readonly string[];
  readonly timeoutMs: number;
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly expectedProvider?: string;
  readonly onGenerationEvidence?: (record: OpenRouterGenerationEvidence) => Promise<void>;
}

export class PluginEvalOpenRouterRequestError extends Data.TaggedError(
  "PluginEvalOpenRouterRequestError",
)<{
  readonly caseId: string;
  readonly reason: "invalid-options" | "unsupported-reasoning";
}> {}

export class PluginEvalOpenRouterMcpError extends Data.TaggedError("PluginEvalOpenRouterMcpError")<{
  readonly caseId: string;
  readonly reason: "connection-failed" | "catalog-failed" | "catalog-mismatch" | "cleanup-failed";
}> {}

export class PluginEvalOpenRouterGenerationError extends Data.TaggedError(
  "PluginEvalOpenRouterGenerationError",
)<{
  readonly caseId: string;
  readonly reason:
    | "generation-failed"
    | "tool-budget-exhausted"
    | "evidence-write-failed"
    | "evidence-missing"
    | "observed-mismatch";
}> {}

export class PluginEvalOpenRouterTimeoutError extends Data.TaggedError(
  "PluginEvalOpenRouterTimeoutError",
)<{
  readonly caseId: string;
  readonly timeoutMs: number;
}> {}

export type PluginEvalOpenRouterError =
  | PluginEvalOpenRouterRequestError
  | PluginEvalOpenRouterMcpError
  | PluginEvalOpenRouterGenerationError
  | PluginEvalOpenRouterTimeoutError;

const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const uniqueLeft = new Set(left);
  return uniqueLeft.size === left.length && right.every((tool) => uniqueLeft.has(tool));
};

const isReasoningEffort = (value: string): value is OpenRouterReasoningEffort =>
  Object.hasOwn(OPENROUTER_REASONING_EFFORTS, value);

const validateOptions = (
  evalCase: PluginEvalCase,
  options: OpenRouterTrialOptions,
): Effect.Effect<ValidatedOpenRouterTrialOptions, PluginEvalOpenRouterRequestError> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_OPENROUTER_MAX_TOOL_CALLS;
  const commonOptionsAreValid =
    isAllowedGinaReadServerUrl(options.serverUrl) &&
    options.apiKey.trim().length > 0 &&
    options.mcpAuthorization.trim().length > 0 &&
    options.model.trim().length > 0 &&
    isExactOpenRouterEndpointSlug(options.endpoint, options.model) &&
    options.runId.trim().length > 0 &&
    Number.isSafeInteger(options.repetition) &&
    options.repetition > 0 &&
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs > 0 &&
    Number.isSafeInteger(maxSteps) &&
    maxSteps > 0 &&
    maxSteps <= MAX_MAX_STEPS &&
    Number.isSafeInteger(maxToolCalls) &&
    maxToolCalls > 0 &&
    maxToolCalls <= MAX_MAX_STEPS &&
    catalogsMatch(options.allowedTools, CANONICAL_ALLOWED_TOOLS) &&
    (options.expectedProvider === undefined ||
      (options.expectedProvider.length > 0 &&
        options.expectedProvider.length <= 128 &&
        options.expectedProvider === options.expectedProvider.trim()));

  if (!commonOptionsAreValid) {
    return Effect.fail(
      new PluginEvalOpenRouterRequestError({
        caseId: evalCase.id,
        reason: "invalid-options",
      }),
    );
  }
  if (!isReasoningEffort(options.reasoning)) {
    return Effect.fail(
      new PluginEvalOpenRouterRequestError({
        caseId: evalCase.id,
        reason: "unsupported-reasoning",
      }),
    );
  }

  return Effect.succeed({
    apiKey: options.apiKey,
    mcpAuthorization: options.mcpAuthorization,
    model: options.model,
    endpoint: options.endpoint,
    reasoning: options.reasoning,
    runId: options.runId,
    repetition: options.repetition,
    serverUrl: options.serverUrl,
    allowedTools: [...options.allowedTools],
    timeoutMs,
    maxSteps,
    maxToolCalls,
    ...(options.expectedProvider === undefined
      ? {}
      : { expectedProvider: options.expectedProvider }),
    ...(options.onGenerationEvidence === undefined
      ? {}
      : { onGenerationEvidence: options.onGenerationEvidence }),
  });
};

const catalogFailed = (caseId: string): PluginEvalOpenRouterMcpError =>
  new PluginEvalOpenRouterMcpError({
    caseId,
    reason: "catalog-failed",
  });

const abortablePromise = <A, E>(
  run: (signal: AbortSignal) => PromiseLike<A>,
  onError: () => E,
): Effect.Effect<A, E> =>
  Effect.callback((resume, signal) => {
    void Promise.resolve()
      .then(() => run(signal))
      .then(
        (value) => {
          if (!signal.aborted) resume(Effect.succeed(value));
        },
        () => {
          if (!signal.aborted) resume(Effect.fail(onError()));
        },
      );
  });

const listAllMcpTools = (
  client: MCPClient,
  caseId: string,
): Effect.Effect<ListToolsResult, PluginEvalOpenRouterMcpError> =>
  Effect.gen(function* () {
    let page = yield* abortablePromise(
      (signal) => client.listTools({ options: { signal } }),
      () => catalogFailed(caseId),
    );
    const tools = [...page.tools];
    const seenCursors = new Set<string>();
    let pageCount = 1;

    while (page.nextCursor !== undefined) {
      if (pageCount >= MAX_MCP_TOOL_PAGES || seenCursors.has(page.nextCursor)) {
        return yield* catalogFailed(caseId);
      }
      seenCursors.add(page.nextCursor);
      const cursor = page.nextCursor;
      page = yield* abortablePromise(
        (signal) =>
          client.listTools({
            params: { cursor },
            options: { signal },
          }),
        () => catalogFailed(caseId),
      );
      tools.push(...page.tools);
      pageCount += 1;
    }

    return { ...page, tools };
  });

const isJsonValue = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
};

const jsonObject = (value: unknown): PluginEvalToolCall["arguments"] | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    return undefined;
  }
  return value as PluginEvalToolCall["arguments"];
};

const nonNegativeInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const completeTokenUsage = (usage: {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
}): PluginEvalTokenUsage | undefined => {
  const inputTokens = nonNegativeInteger(usage.inputTokens);
  const outputTokens = nonNegativeInteger(usage.outputTokens);
  const totalTokens = nonNegativeInteger(usage.totalTokens);
  return inputTokens === undefined || outputTokens === undefined || totalTokens === undefined
    ? undefined
    : {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
      };
};

const resultByteLength = (value: unknown): number | undefined => {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized === undefined ? undefined : UTF8_ENCODER.encode(serialized).byteLength;
  } catch {
    return undefined;
  }
};

const observedToolCalls = <TOOLS extends ToolSet>(
  steps: readonly StepResult<TOOLS>[],
  wireToCanonical: ReadonlyMap<string, string>,
): readonly PluginEvalToolCall[] => {
  const observed: PluginEvalToolCall[] = [];

  for (const step of steps) {
    for (const toolCall of step.toolCalls) {
      const canonicalName = wireToCanonical.get(toolCall.toolName);
      const argumentsValue = jsonObject(toolCall.input);
      const duration = nonNegativeInteger(step.performance.toolExecutionMs[toolCall.toolCallId]);
      let resultBytes: number | undefined;
      let resultObserved = false;
      let callError: PluginEvalToolCall["error"] =
        canonicalName === undefined || toolCall.invalid === true
          ? {
              code: "invalid_tool",
              message: "OpenRouter requested an unavailable MCP tool",
            }
          : argumentsValue === undefined
            ? {
                code: "invalid_arguments",
                message: "OpenRouter returned invalid MCP arguments",
              }
            : undefined;

      for (const part of step.content) {
        if (
          (part.type !== "tool-result" && part.type !== "tool-error") ||
          part.toolCallId !== toolCall.toolCallId
        ) {
          continue;
        }
        resultObserved = true;
        if (part.type === "tool-error") {
          callError ??= { message: "MCP tool call failed" };
        } else {
          resultBytes = resultByteLength(part.output);
          if (
            typeof part.output === "object" &&
            part.output !== null &&
            !Array.isArray(part.output) &&
            Reflect.get(part.output, "isError") === true
          ) {
            callError ??= { message: "MCP tool call failed" };
          }
        }
        break;
      }

      if (!resultObserved && canonicalName !== undefined && toolCall.invalid !== true) {
        callError ??= {
          code: "missing_result",
          message: "MCP tool result was not observed",
        };
      }

      observed.push({
        sequence: observed.length,
        name: canonicalName ?? toolCall.toolName,
        arguments: argumentsValue ?? {},
        ...(duration === undefined ? {} : { duration_ms: duration }),
        ...(resultBytes === undefined ? {} : { result_bytes: resultBytes }),
        ...(callError === undefined ? {} : { error: callError }),
      });
    }
  }

  return observed;
};

const timeoutError = (caseId: string, timeoutMs: number): PluginEvalOpenRouterTimeoutError =>
  new PluginEvalOpenRouterTimeoutError({ caseId, timeoutMs });

const ensureBeforeDeadline = (
  caseId: string,
  timeoutMs: number,
  deadlineMillis: number,
): Effect.Effect<void, PluginEvalOpenRouterTimeoutError> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    now >= deadlineMillis ? Effect.fail(timeoutError(caseId, timeoutMs)) : Effect.void,
  );

type McpCloseOutcome = "closed" | "failed";

const mcpClientCloses = new WeakMap<MCPClient, Promise<McpCloseOutcome>>();

const closeMcpClientOnce = (client: MCPClient): Promise<McpCloseOutcome> => {
  const activeClose = mcpClientCloses.get(client);
  if (activeClose !== undefined) return activeClose;

  let closeResult: PromiseLike<void>;
  try {
    closeResult = client.close();
  } catch {
    const failed = Promise.resolve<McpCloseOutcome>("failed");
    mcpClientCloses.set(client, failed);
    return failed;
  }

  const outcome = Promise.resolve(closeResult).then(
    (): McpCloseOutcome => "closed",
    (): McpCloseOutcome => "failed",
  );
  mcpClientCloses.set(client, outcome);
  return outcome;
};

const acquireMcpClient = (
  caseId: string,
  options: ValidatedOpenRouterTrialOptions,
): Effect.Effect<MCPClient, PluginEvalOpenRouterMcpError> =>
  abortablePromise(
    (signal) =>
      createMCPClient({
        transport: {
          type: "http",
          url: options.serverUrl,
          headers: { Authorization: `Bearer ${options.mcpAuthorization}` },
          redirect: "error",
        },
        initializationOptions: { signal },
        maxRetries: 0,
        clientName: "ask-gina-openrouter-eval",
      }).then((client) => {
        if (!signal.aborted) return client;
        void closeMcpClientOnce(client);
        return Promise.reject(signal.reason);
      }),
    () =>
      new PluginEvalOpenRouterMcpError({
        caseId,
        reason: "connection-failed",
      }),
  );

const releaseMcpClient = (
  client: MCPClient,
  exit: Exit.Exit<unknown, unknown>,
  caseId: string,
  timeoutMs: number,
  deadlineMillis: number,
): Effect.Effect<void, PluginEvalOpenRouterMcpError | PluginEvalOpenRouterTimeoutError> => {
  if (Exit.isFailure(exit)) {
    return Effect.sync(() => {
      void closeMcpClientOnce(client);
    });
  }

  return Effect.gen(function* () {
    const beforeClose = yield* Clock.currentTimeMillis;
    if (beforeClose >= deadlineMillis) {
      void closeMcpClientOnce(client);
      return yield* timeoutError(caseId, timeoutMs);
    }

    const remainingMs = Math.min(
      Math.max(0, Math.trunc(deadlineMillis - beforeClose)),
      MAX_MCP_CLOSE_WAIT_MS,
    );
    const outcome = yield* Effect.raceFirst(
      Effect.promise(() => closeMcpClientOnce(client)),
      Effect.sleep(Duration.millis(remainingMs)).pipe(Effect.as("timed-out" as const)),
    );
    const afterClose = yield* Clock.currentTimeMillis;
    if (afterClose >= deadlineMillis) return yield* timeoutError(caseId, timeoutMs);
    if (outcome !== "closed") {
      return yield* new PluginEvalOpenRouterMcpError({
        caseId,
        reason: "cleanup-failed",
      });
    }
  });
};

export const runOpenRouterPluginEvalTrial = Function.dual<
  (
    options: OpenRouterTrialOptions,
  ) => (
    evalCase: PluginEvalCase,
  ) => Effect.Effect<PluginEvalObservation, PluginEvalOpenRouterError>,
  (
    evalCase: PluginEvalCase,
    options: OpenRouterTrialOptions,
  ) => Effect.Effect<PluginEvalObservation, PluginEvalOpenRouterError>
>(2, (evalCase, options) =>
  Effect.gen(function* () {
    const validated = yield* validateOptions(evalCase, options);
    const startedMillis = yield* Clock.currentTimeMillis;
    const startedAt = DateTime.formatIso(DateTime.makeUnsafe(startedMillis));
    const deadlineMillis = startedMillis + validated.timeoutMs;

    return yield* Effect.gen(function* () {
      const generated = yield* Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(restore(acquireMcpClient(evalCase.id, validated)), (client) =>
          restore(
            Effect.gen(function* () {
              yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
              const definitions = yield* listAllMcpTools(client, evalCase.id);
              yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
              const discoveredTools = definitions.tools.map(({ name }) => name);
              if (!catalogsMatch(discoveredTools, validated.allowedTools)) {
                return yield* new PluginEvalOpenRouterMcpError({
                  caseId: evalCase.id,
                  reason: "catalog-mismatch",
                });
              }

              const allowed = new Set(validated.allowedTools);
              const tools = yield* Effect.try({
                try: () =>
                  client.toolsFromDefinitions({
                    ...definitions,
                    tools: definitions.tools.filter(({ name }) => allowed.has(name)),
                  }),
                catch: () =>
                  new PluginEvalOpenRouterMcpError({
                    caseId: evalCase.id,
                    reason: "catalog-failed",
                  }),
              });
              yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);

              const wireTools: ToolSet = {};
              const wireToolOrder: string[] = [];
              const wireToCanonical = new Map<string, string>();
              let admittedToolCalls = 0;
              let generationStep = 0;
              let toolCallBudgetError: PluginEvalOpenRouterGenerationError | undefined;
              let latchedGenerationError: PluginEvalOpenRouterGenerationError | undefined;
              const latchGenerationError = (error: PluginEvalOpenRouterGenerationError): never => {
                latchedGenerationError ??= error;
                throw new Error("OpenRouter generation evidence rejected");
              };
              for (const canonicalName of discoveredTools) {
                const wireName = canonicalName.replaceAll(".", "_");
                const tool = tools[canonicalName];
                if (
                  tool === undefined ||
                  !OPENROUTER_WIRE_TOOL_NAME.test(wireName) ||
                  wireToCanonical.has(wireName)
                ) {
                  return yield* new PluginEvalOpenRouterMcpError({
                    caseId: evalCase.id,
                    reason: "catalog-mismatch",
                  });
                }
                const execute = tool.execute;
                wireTools[wireName] =
                  execute === undefined
                    ? tool
                    : {
                        ...tool,
                        execute: (input, executeOptions) => {
                          if (admittedToolCalls >= validated.maxToolCalls) {
                            toolCallBudgetError ??= new PluginEvalOpenRouterGenerationError({
                              caseId: evalCase.id,
                              reason: "tool-budget-exhausted",
                            });
                            throw new Error("MCP tool-call budget exhausted");
                          }
                          admittedToolCalls += 1;
                          return execute(input, executeOptions);
                        },
                      };
                wireToolOrder.push(wireName);
                wireToCanonical.set(wireName, canonicalName);
              }

              const result = yield* abortablePromise(
                (signal) => {
                  const openrouter = createOpenRouter({
                    apiKey: validated.apiKey,
                    compatibility: "strict",
                  });
                  const routing = {
                    only: [validated.endpoint],
                    allow_fallbacks: false,
                    require_parameters: true,
                  };
                  return generateText({
                    model: wrapLanguageModel({
                      model: openrouter(validated.model, {
                        usage: { include: true },
                        provider: routing,
                      }),
                      middleware: {
                        specificationVersion: "v4",
                        wrapGenerate: ({ doGenerate }) =>
                          Promise.resolve(doGenerate()).then((generated) => {
                            generationStep += 1;
                            const evidence = captureOpenRouterGenerationEvidence(
                              generated,
                              generationStep,
                            );
                            const persistEvidence = validated.onGenerationEvidence;
                            const persisted =
                              persistEvidence === undefined
                                ? Promise.resolve()
                                : Promise.resolve()
                                    .then(() => persistEvidence(evidence))
                                    .then(
                                      () => undefined,
                                      () =>
                                        latchGenerationError(
                                          new PluginEvalOpenRouterGenerationError({
                                            caseId: evalCase.id,
                                            reason: "evidence-write-failed",
                                          }),
                                        ),
                                    );
                            return persisted.then(() => {
                              if (validated.expectedProvider !== undefined) {
                                if (evidence.provider === null) {
                                  latchGenerationError(
                                    new PluginEvalOpenRouterGenerationError({
                                      caseId: evalCase.id,
                                      reason: "evidence-missing",
                                    }),
                                  );
                                }
                                if (evidence.provider !== validated.expectedProvider) {
                                  latchGenerationError(
                                    new PluginEvalOpenRouterGenerationError({
                                      caseId: evalCase.id,
                                      reason: "observed-mismatch",
                                    }),
                                  );
                                }
                              }
                              return generated;
                            });
                          }),
                      },
                    }),
                    messages: evalCase.turns.map(({ role, content }) => ({ role, content })),
                    allowSystemInMessages: true,
                    tools: wireTools,
                    toolOrder: wireToolOrder,
                    toolChoice: "auto",
                    stopWhen: isStepCount(validated.maxSteps),
                    maxRetries: 0,
                    abortSignal: signal,
                    providerOptions: {
                      openrouter: {
                        reasoning: { effort: validated.reasoning },
                        provider: routing,
                      },
                    },
                  });
                },
                () =>
                  new PluginEvalOpenRouterGenerationError({
                    caseId: evalCase.id,
                    reason: "generation-failed",
                  }),
              ).pipe(
                Effect.matchEffect({
                  onSuccess: (value) =>
                    latchedGenerationError !== undefined
                      ? Effect.fail(latchedGenerationError)
                      : toolCallBudgetError === undefined
                        ? Effect.succeed(value)
                        : Effect.fail(toolCallBudgetError),
                  onFailure: (error) =>
                    Effect.fail(latchedGenerationError ?? toolCallBudgetError ?? error),
                }),
              );
              yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);

              return { result, discoveredTools, wireToCanonical };
            }),
          ).pipe(
            Effect.onExit((exit) =>
              releaseMcpClient(client, exit, evalCase.id, validated.timeoutMs, deadlineMillis),
            ),
          ),
        ),
      ).pipe(
        Effect.matchEffect({
          onSuccess: (value) =>
            ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis).pipe(
              Effect.as(value),
            ),
          onFailure: (error) =>
            ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
        }),
      );

      const finishedMillis = yield* Clock.currentTimeMillis;
      if (finishedMillis >= deadlineMillis) {
        return yield* timeoutError(evalCase.id, validated.timeoutMs);
      }

      const tokenUsage = completeTokenUsage(generated.result.usage);
      const finalAnswer = generated.result.text.length === 0 ? undefined : generated.result.text;
      const completed = generated.result.finishReason === "stop" && finalAnswer !== undefined;

      return {
        version: 1,
        run_id: validated.runId,
        case_id: evalCase.id,
        target: "openrouter_api",
        model: validated.model,
        repetition: validated.repetition,
        started_at: startedAt,
        status: completed ? "completed" : "failed",
        duration_ms: Math.max(0, Math.trunc(finishedMillis - startedMillis)),
        tool_calls: observedToolCalls(generated.result.steps, generated.wireToCanonical),
        available_tools: generated.discoveredTools,
        ...(tokenUsage === undefined ? {} : { token_usage: tokenUsage }),
        ...(finalAnswer === undefined ? {} : { final_answer: finalAnswer }),
        ...(completed ? {} : { error: INCOMPLETE_GENERATION_ERROR }),
      } satisfies PluginEvalObservation;
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(validated.timeoutMs),
        orElse: () => Effect.fail(timeoutError(evalCase.id, validated.timeoutMs)),
      }),
    );
  }).pipe(
    Effect.withSpan("plugin_evals.openrouter_trial", {
      attributes: {
        "plugin_eval.case_id": evalCase.id,
        "plugin_eval.model": options.model,
        "plugin_eval.reasoning": options.reasoning,
        "plugin_eval.repetition": options.repetition,
      },
    }),
  ),
);
