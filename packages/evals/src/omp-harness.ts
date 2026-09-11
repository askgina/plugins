import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createMCPClient, type ListToolsResult, type MCPClient } from "@ai-sdk/mcp";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import { createACP } from "@ai-sdk/harness-acp";
import { resolveSandboxHomeDir } from "@ai-sdk/harness/utils";
import type { HarnessV1SandboxProvider } from "@ai-sdk/harness";
import {
  GINA_CONNECTED_TOOL_NAMES,
  listCatalogToolNames,
  PRODUCTION_MCP_URL,
  SKILL_NAMES,
  type SkillName,
} from "@askgina/contracts";
import {
  jsonSchema,
  type GenerateTextResult,
  type StepResult,
  type StreamTextResult,
  type ToolSet,
} from "ai";
import {
  Cause,
  Clock,
  Data,
  DateTime,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Function,
  Option,
  Path,
  Redacted,
  Scope,
  Stream,
} from "effect";

import type { PluginEvalCase, PluginEvalObservation, PluginEvalToolCall } from "./contracts";
import { createLocalHarnessSandbox } from "./local-harness-sandbox";
import {
  createOmpTranscriptCollector,
  type OmpTranscriptCollector,
  type OmpTrialTranscript,
} from "./omp-transcript";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_MCP_TOOL_PAGES = 32;
const MAX_MCP_CLOSE_WAIT_MS = 1_000;
const MAX_SESSION_DESTROY_WAIT_MS = 8_000;
const MAX_TRANSCRIPT_CALLBACK_WAIT_MS = 5_000;
const OMP_TRANSCRIPT_TOOL_EXECUTION_FAILED = "[tool execution failed]";
const OMP_TRANSCRIPT_TOOL_OUTPUT_DENIED = "[tool output denied]";
const OMP_INCOMPLETE_GENERATION_ERROR = "OMP generation did not complete with a final answer";
const OMP_TOOL_EXECUTION_ERROR = "OMP tool execution failed";
const OMP_EVAL_PROVIDER_ALIAS = "omp-eval";
const OMP_EVAL_PROVIDER_API_KEY_ENV = "OMP_EVAL_PROVIDER_API_KEY";
const CANONICAL_ALLOWED_TOOLS = listCatalogToolNames();
const UTF8_ENCODER = new TextEncoder();
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const OMP_MODEL_THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const PROVIDER_PROFILE = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    thinkingMode: "effort",
    thinkingFormat: "openai",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    thinkingMode: "budget",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    thinkingMode: "effort",
    thinkingFormat: "openrouter",
  },
} as const;
const OMP_REASONING = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  auto: true,
} as const;
const SKILL_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_URI_NAME = /^skill:\/\/([a-z0-9-]+)$/u;
const CANONICAL_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  CANONICAL_ALLOWED_TOOLS.map((name) => [name, true as const]),
);

export type OmpApiKeyProvider = keyof typeof PROVIDER_PROFILE;
export type OmpReasoning = keyof typeof OMP_REASONING;

export const isOmpApiKeyProvider = (value: string): value is OmpApiKeyProvider =>
  Object.hasOwn(PROVIDER_PROFILE, value);

const OMP_PROVIDER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export const isOmpProviderIdentifier = (value: string): boolean =>
  OMP_PROVIDER_IDENTIFIER.test(value);

const isOmpReasoning = (value: string): value is OmpReasoning =>
  Object.hasOwn(OMP_REASONING, value);

export interface PrepareOmpHarnessRuntimeOptions {
  readonly root: string;
  readonly executablePath: string;
  readonly expectedSha256: string;
}

export interface PreparedOmpHarnessRuntime {
  readonly runtimeDirectory: string;
}

export type OmpAuth =
  | {
      readonly mode: "api-key";
      readonly provider: OmpApiKeyProvider;
      readonly apiKey: Redacted.Redacted<string>;
      readonly providerBaseUrl?: string;
    }
  | {
      readonly mode: "native";
      readonly provider: string;
      readonly agentDirectory: string;
    };

export interface OmpHarnessTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly runtimeDirectory: string;
  readonly auth: OmpAuth;
  readonly model: string;
  readonly reasoning: string;
  readonly mcpAuthorization: Redacted.Redacted<string>;
  readonly timeoutMs: number;
  readonly serverUrl?: string;
  readonly sandbox?: HarnessV1SandboxProvider;
  readonly onTranscript?: (
    transcript: OmpTrialTranscript,
    signal: AbortSignal,
  ) => PromiseLike<void>;
}

type ValidatedOmpAuth =
  | {
      readonly mode: "api-key";
      readonly provider: OmpApiKeyProvider;
      readonly apiKey: string;
      readonly providerBaseUrl?: string;
    }
  | {
      readonly mode: "native";
      readonly provider: string;
      readonly agentDirectory: string;
    };

interface ValidatedOmpHarnessTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly runtimeDirectory: string;
  readonly auth: ValidatedOmpAuth;
  readonly model: string;
  readonly modelIdentity: string;
  readonly reasoning: OmpReasoning;
  readonly mcpAuthorization: string;
  readonly timeoutMs: number;
  readonly serverUrl: string;
  readonly sandbox?: HarnessV1SandboxProvider;
}

interface CapturedHostToolCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: PluginEvalToolCall["arguments"];
  readonly durationMs?: number;
  readonly resultBytes?: number;
  readonly error?: PluginEvalToolCall["error"];
}

interface ObservedNativeCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: PluginEvalToolCall["arguments"];
  outcome?: "result" | "error";
  result?: unknown;
}

interface ObservedOmpToolCalls {
  readonly toolCalls: readonly PluginEvalToolCall[];
  readonly activatedSkills: readonly SkillName[];
  readonly failedNativeRead: boolean;
}

type OmpGenerationEvidence = Pick<
  GenerateTextResult<ToolSet, Record<string, unknown>, never>,
  "text" | "finishReason" | "usage" | "steps"
>;

export class PluginEvalOmpHarnessExecutableError extends Data.TaggedError(
  "PluginEvalOmpHarnessExecutableError",
)<{
  readonly reason: "invalid-path" | "invalid-file" | "digest-mismatch" | "forbidden-path";
}> {}

export class PluginEvalOmpHarnessRequestError extends Data.TaggedError(
  "PluginEvalOmpHarnessRequestError",
)<{
  readonly caseId: string;
  readonly reason: "invalid-options" | "unsupported-reasoning" | "invalid-endpoint";
}> {}

export class PluginEvalOmpHarnessSpawnError extends Data.TaggedError(
  "PluginEvalOmpHarnessSpawnError",
)<{
  readonly caseId: string;
  readonly reason: "could_not_start";
}> {}

export class PluginEvalOmpHarnessMcpError extends Data.TaggedError("PluginEvalOmpHarnessMcpError")<{
  readonly caseId: string;
  readonly reason: "connection-failed" | "catalog-failed" | "catalog-mismatch" | "cleanup-failed";
}> {}

export class PluginEvalOmpHarnessProcessError extends Data.TaggedError(
  "PluginEvalOmpHarnessProcessError",
)<{
  readonly caseId: string;
  readonly reason: "generation-failed" | "incomplete-evidence";
}> {}

export class PluginEvalOmpHarnessTimeoutError extends Data.TaggedError(
  "PluginEvalOmpHarnessTimeoutError",
)<{
  readonly caseId: string;
  readonly timeoutMs: number;
}> {}

/** Capture failure fails a successful trial without replacing an existing trial failure. */
export class PluginEvalOmpHarnessTranscriptError extends Data.TaggedError(
  "PluginEvalOmpHarnessTranscriptError",
)<{
  readonly caseId: string;
  readonly reason: "write-failed" | "write-timeout";
}> {}

export type PluginEvalOmpHarnessError =
  | PluginEvalOmpHarnessExecutableError
  | PluginEvalOmpHarnessRequestError
  | PluginEvalOmpHarnessSpawnError
  | PluginEvalOmpHarnessMcpError
  | PluginEvalOmpHarnessProcessError
  | PluginEvalOmpHarnessTimeoutError
  | PluginEvalOmpHarnessTranscriptError;

const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const uniqueLeft = new Set(left);
  return uniqueLeft.size === left.length && right.every((tool) => uniqueLeft.has(tool));
};

const isSupportedOmpCatalog = (names: readonly string[]): boolean =>
  catalogsMatch(names, CANONICAL_ALLOWED_TOOLS) || catalogsMatch(names, GINA_CONNECTED_TOOL_NAMES);

const isWithin = (path: Path.Path, parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isNativeExecutableHeader = (bytes: readonly number[]): boolean =>
  (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) ||
  (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) ||
  (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && bytes[3] === 0xcf);

const OMP_BUILTIN_TOOLS: ToolSet = Object.fromEntries([
  [
    "read",
    {
      nativeName: "read",
      toolUseKind: "readonly",
      inputSchema: jsonSchema<Record<string, unknown>>({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      }),
    },
  ],
]);

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
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(isJsonValue);
};

const jsonObject = (value: unknown): PluginEvalToolCall["arguments"] | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    return undefined;
  }
  return value as PluginEvalToolCall["arguments"];
};

const jsonInput = (value: unknown): PluginEvalToolCall["arguments"] | undefined => {
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return jsonObject(value);
};

const resultByteLength = (value: unknown): number | undefined => {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized === undefined ? undefined : UTF8_ENCODER.encode(serialized).byteLength;
  } catch {
    return undefined;
  }
};

const skillNameForReadTarget = (
  target: string,
  runtimeDirectory: string,
  sessionSkillsDirectory: string | undefined,
): SkillName | undefined => {
  const uriMatch = SKILL_URI_NAME.exec(target);
  if (uriMatch !== null) {
    return SKILL_NAMES.find((name) => name === uriMatch[1]);
  }
  return SKILL_NAMES.find(
    (name) =>
      target === `${runtimeDirectory}/skills/${name}/SKILL.md` ||
      (sessionSkillsDirectory !== undefined &&
        target === `${sessionSkillsDirectory}/${name}/SKILL.md`),
  );
};

const timeoutError = (caseId: string, timeoutMs: number): PluginEvalOmpHarnessTimeoutError =>
  new PluginEvalOmpHarnessTimeoutError({ caseId, timeoutMs });

const ensureBeforeDeadline = (
  caseId: string,
  timeoutMs: number,
  deadlineMillis: number,
): Effect.Effect<void, PluginEvalOmpHarnessTimeoutError> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    now >= deadlineMillis ? Effect.fail(timeoutError(caseId, timeoutMs)) : Effect.void,
  );

const withRunDeadline = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  caseId: string,
  timeoutMs: number,
  deadlineMillis: number,
): Effect.Effect<A, E | PluginEvalOmpHarnessTimeoutError, R> =>
  Effect.gen(function* () {
    const before = yield* Clock.currentTimeMillis;
    if (before >= deadlineMillis) return yield* timeoutError(caseId, timeoutMs);
    return yield* effect.pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(deadlineMillis - before),
        orElse: () => Effect.fail(timeoutError(caseId, timeoutMs)),
      }),
      Effect.matchEffect({
        onFailure: (error) =>
          ensureBeforeDeadline(caseId, timeoutMs, deadlineMillis).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        onSuccess: (value) =>
          ensureBeforeDeadline(caseId, timeoutMs, deadlineMillis).pipe(Effect.as(value)),
      }),
    );
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

const catalogFailed = (caseId: string): PluginEvalOmpHarnessMcpError =>
  new PluginEvalOmpHarnessMcpError({ caseId, reason: "catalog-failed" });

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

type HarnessSessionDestroyOutcome = "destroyed" | "failed";
type RawSandboxDestroy = () => PromiseLike<void>;
type RawSandboxDestroyRef = { current: RawSandboxDestroy | undefined };
const harnessSessionDestroys = new WeakMap<
  HarnessAgentSession,
  Promise<HarnessSessionDestroyOutcome>
>();

// Publish the shared promise before invoking provider code, including sync throws.
const shareSandboxDestroy = (destroy: RawSandboxDestroy): RawSandboxDestroy => {
  let shared: Promise<void> | undefined;
  return () => (shared ??= Promise.resolve().then(destroy));
};

const settleHarnessDestroy = (
  destroy: RawSandboxDestroy,
): Promise<HarnessSessionDestroyOutcome> => {
  try {
    return Promise.resolve(destroy()).then(
      (): HarnessSessionDestroyOutcome => "destroyed",
      (): HarnessSessionDestroyOutcome => "failed",
    );
  } catch {
    return Promise.resolve("failed");
  }
};

const requestRawSandboxDestroy = (
  rawSandboxDestroy: RawSandboxDestroyRef,
): Promise<HarnessSessionDestroyOutcome> => {
  const destroy = rawSandboxDestroy.current;
  return destroy === undefined
    ? Promise.resolve<HarnessSessionDestroyOutcome>("failed")
    : settleHarnessDestroy(destroy);
};

const destroyHarnessSessionOnce = (
  session: HarnessAgentSession,
  rawSandboxDestroy: RawSandboxDestroyRef,
): Promise<HarnessSessionDestroyOutcome> => {
  const activeDestroy = harnessSessionDestroys.get(session);
  if (activeDestroy !== undefined) return activeDestroy;
  // Stock session.destroy() awaits adapter doDestroy then sandbox destroy.
  // Observe the shared sandbox destroy after that so a swallowed rejection
  // stays visible. Race the existing MAX_SESSION_DESTROY_WAIT_MS budget so a
  // hung adapter still requests bounded physical cleanup.
  const outcome = Effect.runPromise(
    Effect.gen(function* () {
      const sessionOutcome = yield* Effect.promise(() =>
        settleHarnessDestroy(() => session.destroy()),
      );
      const sandboxOutcome = yield* Effect.promise(() =>
        requestRawSandboxDestroy(rawSandboxDestroy),
      );
      return sessionOutcome === "destroyed" && sandboxOutcome === "destroyed"
        ? "destroyed"
        : "failed";
    }).pipe(
      Effect.raceFirst(
        Effect.sleep(Duration.millis(MAX_SESSION_DESTROY_WAIT_MS)).pipe(
          Effect.flatMap(() => Effect.promise(() => requestRawSandboxDestroy(rawSandboxDestroy))),
          Effect.as("failed" as const),
        ),
      ),
    ),
  );
  harnessSessionDestroys.set(session, outcome);
  return outcome;
};

const isKnownHarnessError = (error: unknown): error is PluginEvalOmpHarnessError =>
  error instanceof PluginEvalOmpHarnessExecutableError ||
  error instanceof PluginEvalOmpHarnessRequestError ||
  error instanceof PluginEvalOmpHarnessSpawnError ||
  error instanceof PluginEvalOmpHarnessMcpError ||
  error instanceof PluginEvalOmpHarnessProcessError ||
  error instanceof PluginEvalOmpHarnessTimeoutError ||
  error instanceof PluginEvalOmpHarnessTranscriptError;

const generationError = (caseId: string, error: unknown): PluginEvalOmpHarnessError =>
  isKnownHarnessError(error)
    ? error
    : new PluginEvalOmpHarnessProcessError({ caseId, reason: "generation-failed" });

const consumeTranscriptStream = (
  streamed: StreamTextResult<ToolSet, Record<string, unknown>, never>,
  collector: OmpTranscriptCollector,
  caseId: string,
  signal: AbortSignal,
): Promise<OmpGenerationEvidence> =>
  Effect.runPromise(
    Stream.fromAsyncIterable(streamed.stream, (error) => generationError(caseId, error)).pipe(
      Stream.runForEach((part) =>
        Effect.sync(() => {
          switch (part.type) {
            case "text-delta":
              collector.assistant(part.text);
              break;
            case "tool-call":
              collector.toolCall(part.toolCallId, part.toolName, part.input);
              break;
            case "tool-result":
              collector.toolResult(part.toolCallId, part.toolName, part.output, false);
              break;
            case "tool-error":
              collector.toolResult(
                part.toolCallId,
                part.toolName,
                OMP_TRANSCRIPT_TOOL_EXECUTION_FAILED,
                true,
              );
              break;
            case "tool-output-denied":
              collector.toolResult(
                part.toolCallId,
                part.toolName,
                OMP_TRANSCRIPT_TOOL_OUTPUT_DENIED,
                true,
              );
              break;
          }
        }),
      ),
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            Promise.all([
              streamed.text,
              streamed.finishReason,
              streamed.usage,
              streamed.steps,
            ]).then(([text, finishReason, usage, steps]) => ({ text, finishReason, usage, steps })),
          catch: (error) => generationError(caseId, error),
        }),
      ),
    ),
    { signal },
  );

const isTypedTimeoutError = (error: unknown): boolean =>
  Cause.isTimeoutError(error) ||
  (typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    error._tag.endsWith("TimeoutError"));

const transcriptStatus = (
  exit: Exit.Exit<PluginEvalObservation, PluginEvalOmpHarnessError>,
): OmpTrialTranscript["status"] => {
  if (Exit.isSuccess(exit)) return exit.value.status;
  if (Cause.hasInterrupts(exit.cause)) return "interruption";
  return isTypedTimeoutError(Option.getOrUndefined(Cause.findErrorOption(exit.cause)))
    ? "timeout"
    : "failed";
};

const invokeTranscriptCallback = (
  callback: (transcript: OmpTrialTranscript, signal: AbortSignal) => PromiseLike<void>,
  transcript: OmpTrialTranscript,
  caseId: string,
): Effect.Effect<void, PluginEvalOmpHarnessTranscriptError> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.tryPromise({
      try: (signal) => callback(transcript, signal),
      catch: () => new PluginEvalOmpHarnessTranscriptError({ caseId, reason: "write-failed" }),
    }).pipe(Effect.forkChild({ startImmediately: true, uninterruptible: false }));
    const outcome = yield* Effect.raceFirst(
      Fiber.await(fiber).pipe(Effect.map((exit) => ({ type: "settled" as const, exit }))),
      Effect.sleep(Duration.millis(MAX_TRANSCRIPT_CALLBACK_WAIT_MS)).pipe(
        Effect.as({ type: "timed-out" as const }),
      ),
    );
    if (outcome.type === "timed-out") {
      yield* Fiber.interrupt(fiber);
      return yield* new PluginEvalOmpHarnessTranscriptError({
        caseId,
        reason: "write-timeout",
      });
    }
    return yield* outcome.exit;
  });

const finalizeTranscript = (
  collector: OmpTranscriptCollector,
  callback: (transcript: OmpTrialTranscript, signal: AbortSignal) => PromiseLike<void>,
  metadata: Omit<OmpTrialTranscript, "messages" | "status" | "truncated">,
  exit: Exit.Exit<PluginEvalObservation, PluginEvalOmpHarnessError>,
): Effect.Effect<void, PluginEvalOmpHarnessTranscriptError> =>
  Effect.gen(function* () {
    const collected = yield* Effect.try({
      try: () => collector.finish(),
      catch: () =>
        new PluginEvalOmpHarnessTranscriptError({
          caseId: metadata.caseId,
          reason: "write-failed",
        }),
    });
    const transcript = {
      ...metadata,
      status: transcriptStatus(exit),
      messages: collected.messages,
      truncated: collected.truncated,
    } satisfies OmpTrialTranscript;
    yield* invokeTranscriptCallback(callback, transcript, metadata.caseId);
  }).pipe(
    Exit.isSuccess(exit) ? Function.identity : Effect.catch((error) => Effect.logWarning(error)),
  );

const parseProviderBaseUrl = (value: string): string | undefined => {
  if (value.includes("@") || value.includes("\n") || value.includes("\0") || value.includes("\\")) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.href.includes("@")
    ) {
      return undefined;
    }
    return url.href.replace(/\/$/u, "") === value.replace(/\/$/u, "") ? value : url.href;
  } catch {
    return undefined;
  }
};

const yamlQuote = (value: string): string =>
  /[:#|>*&!%@`'"]/u.test(value) || value !== value.trim() ? JSON.stringify(value) : value;

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const nestedEvalConfig = [
  "startup:",
  "  checkUpdate: false",
  "  quiet: true",
  "marketplace:",
  "  autoUpdate: off",
  "memory:",
  "  backend: off",
  "memories:",
  "  enabled: false",
  "advisor:",
  "  enabled: false",
  "task:",
  "  isolation:",
  "    enabled: false",
  "  eager: default",
  "  batch: false",
  "dev:",
  "  autoqa: false",
  "tools:",
  "  intentTracing: false",
  "  xdev: false",
  "retry:",
  "  enabled: false",
  "  modelFallback: false",
  "exa:",
  "  enabled: false",
  "async:",
  "  enabled: false",
  "bash:",
  "  autoBackground:",
  "    enabled: false",
  "eval:",
  "  autoBackground:",
  "    enabled: false",
  "skills:",
  "  enabled: true",
  "  enableSkillCommands: false",
  "  enableCodexUser: false",
  "  enableClaudeUser: false",
  "  enableClaudeProject: false",
  "  enablePiUser: false",
  "  enablePiProject: false",
  "  enableAgentsUser: true",
  "  enableAgentsProject: false",
  "  includeSkills:",
  ...SKILL_NAMES.map((name) => `    - ${name}`),
  "",
].join("\n");

const modelsYaml = (
  provider: OmpApiKeyProvider,
  model: string,
  providerBaseUrl: string | undefined,
): string => {
  const profile = PROVIDER_PROFILE[provider];
  const lines = [
    "providers:",
    `  ${OMP_EVAL_PROVIDER_ALIAS}:`,
    `    baseUrl: ${yamlQuote(providerBaseUrl ?? profile.baseUrl)}`,
    `    apiKey: ${OMP_EVAL_PROVIDER_API_KEY_ENV}`,
    "    auth: apiKey",
    `    api: ${profile.api}`,
    "    models:",
    `      - id: ${JSON.stringify(model)}`,
    "        reasoning: true",
    "        thinking:",
    `          mode: ${profile.thinkingMode}`,
    "          efforts:",
  ];
  for (const effort of OMP_MODEL_THINKING_EFFORTS) {
    lines.push(`            - ${effort}`);
  }
  if ("thinkingFormat" in profile) {
    lines.push(
      "        compat:",
      "          supportsReasoningEffort: true",
      `          thinkingFormat: ${profile.thinkingFormat}`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const installCommand = (
  runtimeDirectory: string,
  auth: ValidatedOmpAuth,
  model: string,
): string => {
  const lines = [
    'mkdir -p "$HOME/.local/bin"',
    `ln -sfn ${shellQuote(`${runtimeDirectory}/omp`)} "$HOME/.local/bin/omp"`,
  ];
  if (auth.mode === "api-key") {
    lines.push(
      'mkdir -p "$HOME/.omp/agent"',
      "cat > \"$HOME/.omp/agent/models.yml\" <<'OMP_EVAL_MODELS_YML'",
      modelsYaml(auth.provider, model, auth.providerBaseUrl).trimEnd(),
      "OMP_EVAL_MODELS_YML",
    );
  }
  lines.push(
    'version="$("$HOME/.local/bin/omp" --version)"',
    'case "$version" in omp/*) ;; *) exit 1 ;; esac',
  );
  return lines.join("\n");
};

const snapshotExecutable = (
  executablePath: string,
  expectedSha256: string,
  snapshotPath: string,
): Effect.Effect<void, PluginEvalOmpHarnessExecutableError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!path.isAbsolute(executablePath) || !SHA256_HEX.test(expectedSha256)) {
      return yield* new PluginEvalOmpHarnessExecutableError({ reason: "invalid-path" });
    }
    const canonical = yield* fs
      .realPath(executablePath)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-path" })),
      );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fs
          .open(canonical, { flag: "r" })
          .pipe(
            Effect.mapError(
              () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
            ),
          );
        const snapshotWriter = yield* fs
          .open(snapshotPath, { flag: "wx", mode: 0o555 })
          .pipe(
            Effect.mapError(
              () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
            ),
          );
        const before = yield* source.stat.pipe(
          Effect.mapError(
            () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
          ),
        );
        if (before.type !== "File" || (before.mode & 0o111) === 0) {
          return yield* new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" });
        }
        yield* source
          .seek(0n, "start")
          .pipe(
            Effect.mapError(
              () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
            ),
          );
        const hash = createHash("sha256");
        const header: number[] = [];
        while (true) {
          const maybeChunk = yield* source
            .readAlloc(64 * 1024)
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          if (Option.isNone(maybeChunk)) break;
          const chunk = maybeChunk.value;
          hash.update(chunk);
          yield* snapshotWriter
            .writeAll(chunk)
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          for (let index = 0; index < chunk.length && header.length < 4; index += 1) {
            const value = chunk[index];
            if (value !== undefined) header.push(value);
          }
        }
        yield* snapshotWriter.sync.pipe(
          Effect.mapError(
            () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
          ),
        );
        const after = yield* source.stat.pipe(
          Effect.mapError(
            () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
          ),
        );
        const sha256 = hash.digest("hex");
        const beforeIno = Option.getOrUndefined(before.ino);
        const afterIno = Option.getOrUndefined(after.ino);
        if (
          !isNativeExecutableHeader(header) ||
          sha256 !== expectedSha256 ||
          after.type !== "File" ||
          before.dev !== after.dev ||
          beforeIno !== afterIno ||
          before.mode !== after.mode ||
          before.size !== after.size
        ) {
          return yield* new PluginEvalOmpHarnessExecutableError({ reason: "digest-mismatch" });
        }
      }),
    );
    yield* fs
      .chmod(snapshotPath, 0o555)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
  });

const parseSkillFrontmatter = (
  content: string,
  expectedName: SkillName,
): Effect.Effect<{ readonly description: string }, PluginEvalOmpHarnessExecutableError> => {
  const block = SKILL_FRONTMATTER.exec(content)?.[1];
  if (block === undefined) {
    return Effect.fail(new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }));
  }
  const record: Record<string, string> = {};
  for (const line of block.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    record[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const description = record.description;
  if (record.name !== expectedName || description === undefined || description.length === 0) {
    return Effect.fail(new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }));
  }
  return Effect.succeed({ description });
};

const stageCanonicalSkills = (
  root: string,
  runtimeDirectory: string,
): Effect.Effect<void, PluginEvalOmpHarnessExecutableError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const canonicalRoot = yield* fs
      .realPath(root)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-path" })),
      );
    const skillsRoot = path.join(canonicalRoot, "plugins", "ask-gina", "skills");
    const skillsDestination = path.join(runtimeDirectory, "skills");
    yield* fs
      .makeDirectory(skillsDestination, { recursive: true, mode: 0o755 })
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* fs
      .chmod(skillsDestination, 0o755)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* Effect.forEach(
      SKILL_NAMES,
      (name) =>
        Effect.gen(function* () {
          const candidate = path.join(skillsRoot, name, "SKILL.md");
          if (!isWithin(path, skillsRoot, candidate) || path.basename(candidate) !== "SKILL.md") {
            return yield* new PluginEvalOmpHarnessExecutableError({ reason: "forbidden-path" });
          }
          const realPath = yield* fs
            .realPath(candidate)
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          if (!isWithin(path, skillsRoot, realPath) || path.basename(realPath) !== "SKILL.md") {
            return yield* new PluginEvalOmpHarnessExecutableError({ reason: "forbidden-path" });
          }
          const content = yield* fs
            .readFileString(realPath)
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          yield* parseSkillFrontmatter(content, name);
          const destinationDirectory = path.join(skillsDestination, name);
          const destinationFile = path.join(destinationDirectory, "SKILL.md");
          yield* fs
            .makeDirectory(destinationDirectory, { recursive: true, mode: 0o755 })
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          yield* fs
            .chmod(destinationDirectory, 0o755)
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          yield* fs
            .writeFileString(destinationFile, content, {
              flag: "wx",
              mode: 0o444,
            })
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
          yield* fs
            .chmod(destinationFile, 0o444)
            .pipe(
              Effect.mapError(
                () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
              ),
            );
        }),
      { concurrency: 1 },
    );
  });

export const prepareOmpHarnessRuntime = (
  options: PrepareOmpHarnessRuntimeOptions,
): Effect.Effect<
  PreparedOmpHarnessRuntime,
  PluginEvalOmpHarnessExecutableError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!path.isAbsolute(options.root) || !path.isAbsolute(options.executablePath)) {
      return yield* new PluginEvalOmpHarnessExecutableError({ reason: "invalid-path" });
    }
    const expectedSha256 = options.expectedSha256.toLowerCase();
    const runtimeDirectory = yield* fs
      .makeTempDirectoryScoped({ prefix: "ask-gina-omp-runtime-" })
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* fs
      .chmod(runtimeDirectory, 0o755)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* snapshotExecutable(
      options.executablePath,
      expectedSha256,
      path.join(runtimeDirectory, "omp"),
    );
    yield* stageCanonicalSkills(options.root, runtimeDirectory);
    const configPath = path.join(runtimeDirectory, "config.yml");
    yield* fs
      .writeFileString(configPath, nestedEvalConfig, {
        flag: "wx",
        mode: 0o444,
      })
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* fs
      .chmod(configPath, 0o444)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    return { runtimeDirectory };
  });

const invalidOptions = (caseId: string): PluginEvalOmpHarnessRequestError =>
  new PluginEvalOmpHarnessRequestError({ caseId, reason: "invalid-options" });

const validateOptions = (
  evalCase: PluginEvalCase,
  options: OmpHarnessTrialOptions,
): Effect.Effect<
  ValidatedOmpHarnessTrialOptions,
  PluginEvalOmpHarnessRequestError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const mcpAuthorization = Redacted.value(options.mcpAuthorization);
    const model = options.model.trim();
    const runId = options.runId.trim();
    const serverUrl = options.serverUrl ?? PRODUCTION_MCP_URL;
    const authOption = options.auth;
    if (
      authOption === undefined ||
      typeof authOption !== "object" ||
      authOption === null ||
      (authOption.mode !== "api-key" && authOption.mode !== "native") ||
      !isSupportedOmpCatalog(options.availableTools) ||
      runId.length === 0 ||
      model.length === 0 ||
      mcpAuthorization.trim().length === 0 ||
      !options.runtimeDirectory.startsWith("/") ||
      !Number.isSafeInteger(options.repetition) ||
      options.repetition <= 0 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      (options.serverUrl !== undefined && options.serverUrl.trim().length === 0)
    ) {
      return yield* invalidOptions(evalCase.id);
    }
    if (!isOmpReasoning(options.reasoning)) {
      return yield* new PluginEvalOmpHarnessRequestError({
        caseId: evalCase.id,
        reason: "unsupported-reasoning",
      });
    }

    let auth: ValidatedOmpAuth;
    if (authOption.mode === "api-key") {
      const providerBaseUrl =
        authOption.providerBaseUrl === undefined
          ? undefined
          : parseProviderBaseUrl(authOption.providerBaseUrl);
      if (authOption.providerBaseUrl !== undefined && providerBaseUrl === undefined) {
        return yield* new PluginEvalOmpHarnessRequestError({
          caseId: evalCase.id,
          reason: "invalid-endpoint",
        });
      }
      const apiKey = Redacted.value(authOption.apiKey);
      if (!isOmpApiKeyProvider(authOption.provider) || apiKey.trim().length === 0) {
        return yield* invalidOptions(evalCase.id);
      }
      auth = {
        mode: "api-key",
        provider: authOption.provider,
        apiKey,
        ...(providerBaseUrl === undefined ? {} : { providerBaseUrl }),
      };
    } else {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      if (
        !isOmpProviderIdentifier(authOption.provider) ||
        !path.isAbsolute(authOption.agentDirectory)
      ) {
        return yield* invalidOptions(evalCase.id);
      }
      const info = yield* fs
        .stat(authOption.agentDirectory)
        .pipe(Effect.mapError(() => invalidOptions(evalCase.id)));
      if (info.type !== "Directory") {
        return yield* invalidOptions(evalCase.id);
      }
      auth = {
        mode: "native",
        provider: authOption.provider,
        agentDirectory: authOption.agentDirectory,
      };
    }

    return {
      runId,
      repetition: options.repetition,
      availableTools: [...CANONICAL_ALLOWED_TOOLS],
      runtimeDirectory: options.runtimeDirectory,
      auth,
      model,
      modelIdentity: `${auth.provider}/${model}`,
      reasoning: options.reasoning,
      mcpAuthorization,
      timeoutMs,
      serverUrl,
      ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
    };
  });

const listAllMcpTools = (
  client: MCPClient,
  caseId: string,
): Effect.Effect<ListToolsResult, PluginEvalOmpHarnessMcpError> =>
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

const acquireMcpClient = (
  caseId: string,
  options: ValidatedOmpHarnessTrialOptions,
): Effect.Effect<MCPClient, PluginEvalOmpHarnessMcpError> =>
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
        clientName: "ask-gina-omp-eval",
      }).then((client) => {
        if (!signal.aborted) return client;
        void closeMcpClientOnce(client);
        return Promise.reject(signal.reason);
      }),
    () => new PluginEvalOmpHarnessMcpError({ caseId, reason: "connection-failed" }),
  );

const releaseMcpClient = (
  client: MCPClient,
  exit: Exit.Exit<unknown, unknown>,
  caseId: string,
  timeoutMs: number,
  deadlineMillis: number,
): Effect.Effect<void, PluginEvalOmpHarnessMcpError | PluginEvalOmpHarnessTimeoutError> => {
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
      return yield* new PluginEvalOmpHarnessMcpError({ caseId, reason: "cleanup-failed" });
    }
  });
};

const releaseHarnessSession = (
  session: HarnessAgentSession,
  rawSandboxDestroy: RawSandboxDestroyRef,
  exit: Exit.Exit<unknown, unknown>,
  caseId: string,
  timeoutMs: number,
  deadlineMillis: number,
): Effect.Effect<void, PluginEvalOmpHarnessProcessError | PluginEvalOmpHarnessTimeoutError> => {
  if (Exit.isFailure(exit)) {
    return Effect.raceFirst(
      Effect.promise(() => destroyHarnessSessionOnce(session, rawSandboxDestroy)),
      Effect.sleep(Duration.millis(MAX_SESSION_DESTROY_WAIT_MS)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            void requestRawSandboxDestroy(rawSandboxDestroy);
          }),
        ),
      ),
    ).pipe(Effect.asVoid);
  }
  return Effect.gen(function* () {
    const beforeDestroy = yield* Clock.currentTimeMillis;
    if (beforeDestroy >= deadlineMillis) {
      void requestRawSandboxDestroy(rawSandboxDestroy);
      void destroyHarnessSessionOnce(session, rawSandboxDestroy);
      return yield* timeoutError(caseId, timeoutMs);
    }
    const remainingMs = Math.min(
      Math.max(0, Math.trunc(deadlineMillis - beforeDestroy)),
      MAX_SESSION_DESTROY_WAIT_MS,
    );
    const outcome = yield* Effect.raceFirst(
      Effect.promise(() => destroyHarnessSessionOnce(session, rawSandboxDestroy)),
      Effect.sleep(Duration.millis(remainingMs)).pipe(Effect.as("timed-out" as const)),
    );
    const afterDestroy = yield* Clock.currentTimeMillis;
    if (afterDestroy >= deadlineMillis || outcome === "timed-out") {
      void requestRawSandboxDestroy(rawSandboxDestroy);
    }
    if (afterDestroy >= deadlineMillis) return yield* timeoutError(caseId, timeoutMs);
    if (outcome !== "destroyed") {
      return yield* new PluginEvalOmpHarnessProcessError({
        caseId,
        reason: "generation-failed",
      });
    }
  });
};

const loadStagedSkills = (
  runtimeDirectory: string,
  caseId: string,
): Effect.Effect<
  ReadonlyArray<{ readonly name: string; readonly description: string; readonly content: string }>,
  PluginEvalOmpHarnessRequestError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.forEach(SKILL_NAMES, (name) =>
      Effect.gen(function* () {
        const skillPath = path.join(runtimeDirectory, "skills", name, "SKILL.md");
        const content = yield* fs.readFileString(skillPath);
        const parsed = yield* parseSkillFrontmatter(content, name);
        return {
          name,
          description: parsed.description,
          content: content.replace(SKILL_FRONTMATTER, "").trimStart(),
        };
      }),
    );
  }).pipe(
    Effect.mapError(
      () => new PluginEvalOmpHarnessRequestError({ caseId, reason: "invalid-options" }),
    ),
  );

const createInputSchemaCompiler = (): ((schema: unknown) => ValidateFunction | undefined) => {
  const ajv = addFormats(
    new Ajv({
      allErrors: false,
      allowUnionTypes: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
      strict: true,
      validateFormats: true,
    }),
  );
  return (schema: unknown): ValidateFunction | undefined => {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return undefined;
    if (Object.hasOwn(schema, "$async")) return undefined;
    try {
      return ajv.compile(schema);
    } catch {
      return undefined;
    }
  };
};

const executeCanonicalHostTool = (
  run: () => PromiseLike<unknown>,
  validator: ValidateFunction,
  input: unknown,
  executeOptions: { readonly toolCallId: string; readonly abortSignal?: AbortSignal },
  canonicalName: string,
  captures: CapturedHostToolCall[],
): Promise<unknown> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const argumentsValue = jsonObject(input);
      const pushCapture = (extra: Pick<CapturedHostToolCall, "resultBytes" | "error">): void => {
        captures.push({
          toolCallId: executeOptions.toolCallId,
          name: canonicalName,
          arguments: argumentsValue ?? {},
          ...extra,
        });
      };
      if (argumentsValue === undefined || validator(input) !== true) {
        pushCapture({
          error: { code: "invalid_arguments", message: "Invalid tool arguments" },
        });
        return { isError: true };
      }
      const output = yield* Effect.promise(() =>
        Promise.resolve(run()).then(
          (value) => value,
          () => undefined,
        ),
      );
      if (output === undefined) {
        pushCapture({ error: { message: "MCP tool call failed" } });
        return { isError: true };
      }
      if (
        typeof output === "object" &&
        output !== null &&
        !Array.isArray(output) &&
        "isError" in output &&
        output.isError === true
      ) {
        pushCapture({
          resultBytes: resultByteLength(output),
          error: { message: "MCP tool call failed" },
        });
        return output;
      }
      pushCapture({ resultBytes: resultByteLength(output) });
      return output;
    }),
    executeOptions.abortSignal === undefined ? undefined : { signal: executeOptions.abortSignal },
  );

const wrapHostTools = (
  tools: ToolSet,
  definitions: ListToolsResult,
  discoveredTools: readonly string[],
  captures: CapturedHostToolCall[],
  caseId: string,
): Effect.Effect<ToolSet, PluginEvalOmpHarnessMcpError> =>
  Effect.gen(function* () {
    const compileInputSchema = createInputSchemaCompiler();
    const definitionsByName = new Map(definitions.tools.map((tool) => [tool.name, tool] as const));
    const hostTools: ToolSet = {};
    for (const canonicalName of discoveredTools) {
      const tool = tools[canonicalName];
      const definition = definitionsByName.get(canonicalName);
      const execute = tool?.execute;
      if (tool === undefined || execute === undefined || definition === undefined) {
        return yield* new PluginEvalOmpHarnessMcpError({ caseId, reason: "catalog-mismatch" });
      }
      const validator = compileInputSchema(definition.inputSchema);
      if (validator === undefined) {
        return yield* catalogFailed(caseId);
      }
      hostTools[canonicalName] = {
        ...tool,
        execute: (input, executeOptions) =>
          executeCanonicalHostTool(
            () => execute(input, executeOptions),
            validator,
            input,
            executeOptions,
            canonicalName,
            captures,
          ),
      };
    }
    return hostTools;
  });

const nativeMcpToolName = (output: unknown): string | undefined => {
  if (typeof output !== "object" || output === null || !("details" in output)) return undefined;
  const { details } = output;
  if (
    typeof details !== "object" ||
    details === null ||
    !("serverName" in details) ||
    details.serverName !== "ai-sdk-harness-tools" ||
    !("mcpToolName" in details) ||
    typeof details.mcpToolName !== "string" ||
    CANONICAL_TOOL_NAMES[details.mcpToolName] !== true ||
    !("mcpMeta" in details)
  )
    return undefined;
  const { mcpMeta } = details;
  if (
    typeof mcpMeta !== "object" ||
    mcpMeta === null ||
    !("ai-sdk-harness-acp-correlation" in mcpMeta) ||
    typeof mcpMeta["ai-sdk-harness-acp-correlation"] !== "string" ||
    !SHA256_HEX.test(mcpMeta["ai-sdk-harness-acp-correlation"])
  )
    return undefined;
  return details.mcpToolName;
};

const observedToolCalls = (
  steps: readonly StepResult<ToolSet>[],
  captures: readonly CapturedHostToolCall[],
  runtimeDirectory: string,
  sessionSkillsDirectory: string | undefined,
): ObservedOmpToolCalls | undefined => {
  const capturesById = new Map(captures.map((capture) => [capture.toolCallId, capture] as const));
  if (capturesById.size !== captures.length) return undefined;

  const hostCallsById = new Map<string, StepResult<ToolSet>["toolCalls"][number]>();
  const nativeById = new Map<string, ObservedNativeCall>();
  for (const step of steps) {
    for (const toolCall of step.toolCalls) {
      if (toolCall.providerExecuted === true) continue;
      if (hostCallsById.has(toolCall.toolCallId)) return undefined;
      hostCallsById.set(toolCall.toolCallId, toolCall);
    }
    for (const part of step.content) {
      if (part.type !== "tool-call" || part.providerExecuted !== true) continue;
      if (nativeById.has(part.toolCallId)) return undefined;
      nativeById.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        name: part.toolName,
        arguments: jsonInput(part.input) ?? {},
      });
    }
  }
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type !== "tool-result" && part.type !== "tool-error") continue;
      const nativeCall = nativeById.get(part.toolCallId);
      if (nativeCall === undefined || nativeCall.outcome !== undefined) {
        if (nativeCall === undefined) continue;
        return undefined;
      }
      nativeCall.outcome =
        part.type === "tool-error" || ("isError" in part && part.isError === true)
          ? "error"
          : "result";
      nativeCall.result = part.type === "tool-result" ? part.output : part.error;
    }
  }
  for (const nativeCall of nativeById.values()) {
    if (nativeCall.outcome === undefined) return undefined;
  }

  const toolCalls: PluginEvalToolCall[] = [];
  const activatedSkills = new Set<SkillName>();
  const seenHostCallIds = new Set<string>();
  const matchedMirrorHostIds = new Set<string>();
  let failedNativeRead = false;
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type !== "tool-call") continue;
      if (part.providerExecuted === true) {
        const nativeCall = nativeById.get(part.toolCallId);
        if (nativeCall === undefined) return undefined;
        if (nativeCall.name === "read") {
          if (nativeCall.outcome === "error") {
            failedNativeRead = true;
          } else if (nativeCall.outcome === "result") {
            const target = nativeCall.arguments["path"] ?? nativeCall.arguments["file_path"];
            if (typeof target === "string") {
              const skill = skillNameForReadTarget(
                target,
                runtimeDirectory,
                sessionSkillsDirectory,
              );
              if (skill !== undefined) activatedSkills.add(skill);
            }
          }
          continue;
        }
        const canonicalName = nativeMcpToolName(nativeCall.result);
        if (canonicalName !== undefined) {
          const matchedCapture = captures.find(
            (capture) =>
              capture.name === canonicalName &&
              !matchedMirrorHostIds.has(capture.toolCallId) &&
              (capture.error === undefined) === (nativeCall.outcome === "result") &&
              isDeepStrictEqual(capture.arguments, nativeCall.arguments),
          );
          if (matchedCapture !== undefined) {
            matchedMirrorHostIds.add(matchedCapture.toolCallId);
            continue;
          }
        }
        toolCalls.push({
          sequence: toolCalls.length,
          name: nativeCall.name,
          arguments: nativeCall.arguments,
          ...(nativeCall.outcome === "error"
            ? { error: { message: "Native tool call failed" } }
            : {}),
        });
        continue;
      }
      if (seenHostCallIds.has(part.toolCallId)) return undefined;
      seenHostCallIds.add(part.toolCallId);
      const hostCall = hostCallsById.get(part.toolCallId);
      const captured = capturesById.get(part.toolCallId);
      if (captured !== undefined && captured.name !== part.toolName) return undefined;
      const argumentsValue = jsonInput(part.input) ?? captured?.arguments ?? {};
      if (captured === undefined) {
        if (hostCall?.invalid === true) {
          toolCalls.push({
            sequence: toolCalls.length,
            name: part.toolName,
            arguments: argumentsValue,
            error: { code: "invalid_arguments", message: "Invalid tool arguments" },
          });
          continue;
        }
        if (CANONICAL_TOOL_NAMES[part.toolName] === true) return undefined;
        toolCalls.push({
          sequence: toolCalls.length,
          name: part.toolName,
          arguments: argumentsValue,
        });
        continue;
      }
      toolCalls.push({
        sequence: toolCalls.length,
        name: captured.name,
        arguments: captured.arguments,
        ...(captured.durationMs === undefined ? {} : { duration_ms: captured.durationMs }),
        ...(captured.resultBytes === undefined ? {} : { result_bytes: captured.resultBytes }),
        ...(captured.error === undefined ? {} : { error: captured.error }),
      });
    }
  }
  for (const capture of captures) {
    if (!seenHostCallIds.has(capture.toolCallId)) return undefined;
  }
  return { toolCalls, activatedSkills: [...activatedSkills], failedNativeRead };
};

const promptText = (evalCase: PluginEvalCase): string =>
  evalCase.turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join("\n\n");

const createHarnessSession = (
  agent: HarnessAgent,
  rawSandboxDestroy: RawSandboxDestroyRef,
  caseId: string,
): Effect.Effect<HarnessAgentSession, PluginEvalOmpHarnessError> =>
  Effect.callback((resume, signal) => {
    void Promise.resolve()
      .then(() => agent.createSession({ abortSignal: signal }))
      .then(
        (session) => {
          if (!signal.aborted) {
            resume(Effect.succeed(session));
            return;
          }
          void destroyHarnessSessionOnce(session, rawSandboxDestroy);
        },
        (error) => {
          if (rawSandboxDestroy.current !== undefined) {
            void settleHarnessDestroy(rawSandboxDestroy.current);
          }
          if (signal.aborted) return;
          resume(
            Effect.fail(
              isKnownHarnessError(error)
                ? error
                : new PluginEvalOmpHarnessSpawnError({
                    caseId,
                    reason: "could_not_start",
                  }),
            ),
          );
        },
      );
  });

export const runOmpHarnessPluginEvalTrial = Function.dual<
  (
    options: OmpHarnessTrialOptions,
  ) => (
    evalCase: PluginEvalCase,
  ) => Effect.Effect<
    PluginEvalObservation,
    PluginEvalOmpHarnessError,
    FileSystem.FileSystem | Path.Path
  >,
  (
    evalCase: PluginEvalCase,
    options: OmpHarnessTrialOptions,
  ) => Effect.Effect<
    PluginEvalObservation,
    PluginEvalOmpHarnessError,
    FileSystem.FileSystem | Path.Path
  >
>(
  2,
  (
    evalCase: PluginEvalCase,
    options: OmpHarnessTrialOptions,
  ): Effect.Effect<
    PluginEvalObservation,
    PluginEvalOmpHarnessError,
    FileSystem.FileSystem | Path.Path
  > =>
    Effect.gen(function* () {
      const validated = yield* validateOptions(evalCase, options);
      const startedMillis = yield* Clock.currentTimeMillis;
      const startedAt = DateTime.formatIso(DateTime.makeUnsafe(startedMillis));
      const deadlineMillis = startedMillis + validated.timeoutMs;
      const prompt = promptText(evalCase);
      const transcriptCallback = options.onTranscript;
      const transcriptCollector =
        transcriptCallback === undefined
          ? undefined
          : createOmpTranscriptCollector([
              validated.mcpAuthorization,
              ...(validated.auth.mode === "api-key" ? [validated.auth.apiKey] : []),
            ]);

      const trial = Effect.gen(function* () {
        const skills = yield* withRunDeadline(
          loadStagedSkills(validated.runtimeDirectory, evalCase.id),
          evalCase.id,
          validated.timeoutMs,
          deadlineMillis,
        );
        const trialResult = yield* withRunDeadline(
          Effect.uninterruptibleMask((restore) =>
            Effect.flatMap(restore(acquireMcpClient(evalCase.id, validated)), (client) =>
              restore(
                Effect.gen(function* () {
                  yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
                  const definitions = yield* listAllMcpTools(client, evalCase.id);
                  yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
                  const discoveredTools = definitions.tools.map(({ name }) => name);
                  if (!isSupportedOmpCatalog(discoveredTools)) {
                    return yield* new PluginEvalOmpHarnessMcpError({
                      caseId: evalCase.id,
                      reason: "catalog-mismatch",
                    });
                  }
                  const allowed = new Set(validated.availableTools);
                  const tools = yield* Effect.try({
                    try: () =>
                      client.toolsFromDefinitions({
                        ...definitions,
                        tools: definitions.tools.filter(({ name }) => allowed.has(name)),
                      }),
                    catch: () =>
                      new PluginEvalOmpHarnessMcpError({
                        caseId: evalCase.id,
                        reason: "catalog-failed",
                      }),
                  });
                  const captures: CapturedHostToolCall[] = [];
                  const hostTools = yield* wrapHostTools(
                    tools,
                    definitions,
                    validated.availableTools,
                    captures,
                    evalCase.id,
                  );
                  yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
                  const selectedSandbox =
                    validated.sandbox ??
                    createLocalHarnessSandbox({
                      rootDirectory: validated.runtimeDirectory,
                    });
                  const rawSandboxDestroy: RawSandboxDestroyRef = { current: undefined };
                  const sandbox: HarnessV1SandboxProvider = {
                    ...selectedSandbox,
                    createSession: (sessionOptions) =>
                      Promise.resolve(selectedSandbox.createSession(sessionOptions)).then(
                        (session) => {
                          if (typeof session.destroy !== "function") {
                            throw new Error("OMP sandbox session cleanup unavailable");
                          }
                          const sharedDestroy = shareSandboxDestroy(session.destroy.bind(session));
                          rawSandboxDestroy.current = sharedDestroy;
                          Object.assign(session, { destroy: sharedDestroy });
                          return session;
                        },
                      ),
                  };
                  const { auth } = validated;
                  const harness = createACP({
                    harnessId: "omp-acp",
                    builtinTools: OMP_BUILTIN_TOOLS,
                    source: {
                      type: "install-command",
                      command: installCommand(validated.runtimeDirectory, auth, validated.model),
                    },
                    executable: "omp",
                    args: [
                      "acp",
                      "--no-extensions",
                      "--tools",
                      "read",
                      "--config",
                      `${validated.runtimeDirectory}/config.yml`,
                      "--provider",
                      auth.mode === "api-key" ? OMP_EVAL_PROVIDER_ALIAS : auth.provider,
                      "--model",
                      validated.model,
                      "--thinking",
                      validated.reasoning,
                      "--approval-mode",
                      "yolo",
                      "--no-session",
                    ],
                    skillsDirectory: ".agents/skills",
                    modelMapping: { type: "session-config-option", path: "model" },
                    mcpServers: {},
                    hostToolMcpTransport: "http",
                    env:
                      auth.mode === "api-key"
                        ? {
                            NO_COLOR: "1",
                            [OMP_EVAL_PROVIDER_API_KEY_ENV]: auth.apiKey,
                          }
                        : {
                            NO_COLOR: "1",
                            PI_CODING_AGENT_DIR: auth.agentDirectory,
                          },
                  });
                  let sessionSkillsDirectory: string | undefined;
                  const agent = new HarnessAgent({
                    harness,
                    sandbox,
                    tools: hostTools,
                    skills,
                    permissionMode: "allow-all",
                    sandboxConfig: {
                      onSession: ({ session, abortSignal }) =>
                        resolveSandboxHomeDir({ sandbox: session, abortSignal }).then((home) => {
                          sessionSkillsDirectory = `${home}/.agents/skills`;
                        }),
                    },
                  });
                  return yield* withRunDeadline(
                    Effect.uninterruptibleMask((restoreSession) =>
                      Effect.flatMap(
                        restoreSession(createHarnessSession(agent, rawSandboxDestroy, evalCase.id)),
                        (session) =>
                          restoreSession(
                            Effect.gen(function* () {
                              yield* ensureBeforeDeadline(
                                evalCase.id,
                                validated.timeoutMs,
                                deadlineMillis,
                              );
                              let generatedText: OmpGenerationEvidence;
                              if (transcriptCollector === undefined) {
                                generatedText = yield* Effect.tryPromise({
                                  try: (signal) =>
                                    agent.generate({ session, prompt, abortSignal: signal }),
                                  catch: (error) => generationError(evalCase.id, error),
                                });
                              } else {
                                transcriptCollector.user(prompt);
                                generatedText = yield* Effect.tryPromise({
                                  try: (signal) =>
                                    agent
                                      .stream({ session, prompt, abortSignal: signal })
                                      .then((streamed) =>
                                        consumeTranscriptStream(
                                          streamed,
                                          transcriptCollector,
                                          evalCase.id,
                                          signal,
                                        ),
                                      ),
                                  catch: (error) => generationError(evalCase.id, error),
                                });
                              }
                              yield* ensureBeforeDeadline(
                                evalCase.id,
                                validated.timeoutMs,
                                deadlineMillis,
                              );
                              return { generatedText, captures, sessionSkillsDirectory };
                            }),
                          ).pipe(
                            Effect.onExit((exit) =>
                              releaseHarnessSession(
                                session,
                                rawSandboxDestroy,
                                exit,
                                evalCase.id,
                                validated.timeoutMs,
                                deadlineMillis,
                              ),
                            ),
                          ),
                      ),
                    ),
                    evalCase.id,
                    validated.timeoutMs,
                    deadlineMillis,
                  );
                }),
              ).pipe(
                Effect.onExit((exit) =>
                  releaseMcpClient(client, exit, evalCase.id, validated.timeoutMs, deadlineMillis),
                ),
              ),
            ),
          ),
          evalCase.id,
          validated.timeoutMs,
          deadlineMillis,
        );

        yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
        const { generatedText, captures, sessionSkillsDirectory } = trialResult;
        const observed = observedToolCalls(
          generatedText.steps,
          captures,
          validated.runtimeDirectory,
          sessionSkillsDirectory,
        );
        if (observed === undefined) {
          return yield* new PluginEvalOmpHarnessProcessError({
            caseId: evalCase.id,
            reason: "incomplete-evidence",
          });
        }
        const { toolCalls, activatedSkills, failedNativeRead } = observed;
        const usage = generatedText.usage;
        const tokenUsage =
          usage !== undefined &&
          typeof usage.inputTokens === "number" &&
          typeof usage.outputTokens === "number" &&
          typeof usage.totalTokens === "number"
            ? {
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                total_tokens: usage.totalTokens,
              }
            : undefined;
        const failedTool = toolCalls.some((call) => call.error !== undefined);
        const completed = generatedText.finishReason === "stop" && !failedTool && !failedNativeRead;
        const finishedMillis = yield* Clock.currentTimeMillis;
        if (finishedMillis >= deadlineMillis) {
          return yield* timeoutError(evalCase.id, validated.timeoutMs);
        }
        const error = completed
          ? undefined
          : failedTool || failedNativeRead
            ? OMP_TOOL_EXECUTION_ERROR
            : OMP_INCOMPLETE_GENERATION_ERROR;
        return {
          version: 1,
          run_id: validated.runId,
          case_id: evalCase.id,
          target: "omp_harness",
          model: validated.modelIdentity,
          repetition: validated.repetition,
          started_at: startedAt,
          status: error === undefined ? "completed" : "failed",
          duration_ms: Math.max(0, finishedMillis - startedMillis),
          activated_skills: [...activatedSkills],
          tool_calls: [...toolCalls],
          available_tools: [...validated.availableTools],
          ...(tokenUsage === undefined ? {} : { token_usage: tokenUsage }),
          ...(generatedText.text.length === 0 ? {} : { final_answer: generatedText.text }),
          ...(error === undefined ? {} : { error }),
        } satisfies PluginEvalObservation;
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(validated.timeoutMs),
          orElse: () => Effect.fail(timeoutError(evalCase.id, validated.timeoutMs)),
        }),
      );
      if (transcriptCollector === undefined || transcriptCallback === undefined) {
        return yield* trial;
      }
      return yield* trial.pipe(
        Effect.onExit((exit) =>
          finalizeTranscript(
            transcriptCollector,
            transcriptCallback,
            {
              runId: validated.runId,
              caseId: evalCase.id,
              repetition: validated.repetition,
              model: validated.modelIdentity,
              startedAt,
            },
            exit,
          ),
        ),
      );
    }).pipe(
      Effect.withSpan("plugin_evals.omp_harness_trial", {
        attributes: {
          "plugin_eval.case_id": evalCase.id,
          "plugin_eval.repetition": options.repetition,
        },
      }),
    ),
);
