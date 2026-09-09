import {
  type GinaReadToolName,
  listCatalogToolNames,
  PRODUCTION_MCP_URL,
  READ_SCOPE,
  SKILL_NAMES,
} from "@askgina/contracts";
import {
  Clock,
  Data,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Function,
  Path,
  Redacted,
  Stream,
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import type {
  PluginEvalCase,
  PluginEvalObservation,
  PluginEvalTokenUsage,
  PluginEvalToolCall,
} from "./contracts";
import { collectBoundedUtf8Output } from "./bounded-output";

// Claude Code print-mode contract assumed by this adapter:
// @anthropic-ai/claude-code >= 2.1.259 for --permission-prompts, >= 2.1.248 for
// --restricted, plus --strict-mcp-config/--no-session-persistence.
// --max-turns is documented for -p even when omitted from `claude --help`.
// Flag set checked against v2.1.263 help and official CLI/headless docs.
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TURNS = 8;
const MAXIMUM_MAX_TURNS = 32;
const PROCESS_FORCE_KILL_AFTER = Duration.seconds(1);
const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
const ASK_GINA_MCP_SERVER = "ask-gina";
const claudeMcpToolName = (canonicalName: string): string =>
  `mcp__${ASK_GINA_MCP_SERVER.replace(/[^a-zA-Z0-9_-]/g, "_")}__${canonicalName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
const CANONICAL_CATALOG_TOOL_NAMES = listCatalogToolNames();
const CLAUDE_MCP_TOOL_NAME_LOOKUP: Readonly<Record<string, GinaReadToolName>> = (() => {
  const lookup: Record<string, GinaReadToolName> = {};
  for (const canonicalName of CANONICAL_CATALOG_TOOL_NAMES) {
    const nativeName = claudeMcpToolName(canonicalName);
    if (Object.hasOwn(lookup, nativeName)) {
      throw new Error("Gina MCP catalogue has colliding Claude native tool names");
    }
    lookup[nativeName] = canonicalName;
  }
  return lookup;
})();
const CLAUDE_INIT_TOOL_NAMES: readonly string[] = [
  "Skill",
  "Read",
  ...CANONICAL_CATALOG_TOOL_NAMES.map(claudeMcpToolName),
];
const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
const MCP_DISCOVERY_CACHE_ENV = "MCP_DISCOVERY_CACHE";
const UTF8_ENCODER = new TextEncoder();

export const CLAUDE_CLI_MAX_STDOUT_BYTES = 1_048_576;
export const CLAUDE_CLI_MAX_STDERR_BYTES = 65_536;

const ASK_GINA_SKILL_NAME_SET: Readonly<Record<(typeof SKILL_NAMES)[number], true>> = {
  "review-gina-account": true,
  "research-spot-tokens": true,
  "research-hyperliquid": true,
  "research-prediction-markets": true,
};
const CLAUDE_SKILL_PERMISSION_RULES = SKILL_NAMES.map(
  (skill) => `Skill(${ASK_GINA_MCP_SERVER}:${skill})`,
);

const CLAUDE_EFFORTS = {
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
} as const;

type ClaudeEffort = keyof typeof CLAUDE_EFFORTS;

const CLAUDE_NON_ACTION_BLOCK_TYPES: Readonly<Record<string, true>> = {
  text: true,
  thinking: true,
  redacted_thinking: true,
};

const DISALLOWED_BUILTIN_TOOLS =
  "Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Agent,Task,Glob,Grep,LS";

export const CLAUDE_CLI_ALLOWED_ENVIRONMENT_NAMES = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "CI",
] as const;

export class PluginEvalClaudeCliSpawnError extends Data.TaggedError(
  "PluginEvalClaudeCliSpawnError",
)<{
  readonly caseId: string;
  readonly reason:
    | "catalog-mismatch"
    | "could_not_collect_output"
    | "could_not_start"
    | "could_not_write_config"
    | "invalid-options";
}> {}

export class PluginEvalClaudeCliTimeoutError extends Data.TaggedError(
  "PluginEvalClaudeCliTimeoutError",
)<{
  readonly caseId: string;
  readonly timeoutMs: number;
}> {}

export class PluginEvalClaudeCliProcessError extends Data.TaggedError(
  "PluginEvalClaudeCliProcessError",
)<{
  readonly caseId: string;
  readonly reason:
    | "incomplete-stream"
    | "malformed-jsonl"
    | "nonzero-exit"
    | "stderr-truncated"
    | "stdout-truncated";
}> {}

export type PluginEvalClaudeCliError =
  | PluginEvalClaudeCliSpawnError
  | PluginEvalClaudeCliTimeoutError
  | PluginEvalClaudeCliProcessError;

export interface ClaudeCliParsedStream {
  readonly activated_skills: readonly string[];
  readonly tool_calls: readonly PluginEvalToolCall[];
  readonly unsupported_actions: number;
  readonly malformed_jsonl: boolean;
  readonly incomplete: boolean;
  readonly available_tools?: readonly string[];
  readonly final_answer?: string;
  readonly token_usage?: PluginEvalTokenUsage;
  readonly error?: string;
}

export interface ClaudeCliCommand {
  readonly caseId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
}

export interface ClaudeCliProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface ClaudeCliTrialRunner {
  readonly run: (
    command: ClaudeCliCommand,
  ) => Effect.Effect<
    ClaudeCliProcessResult,
    PluginEvalClaudeCliSpawnError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >;
}

export interface ClaudeCliTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly workingDirectory: string;
  readonly executablePath: string;
  readonly pluginDirectory: string;
  readonly mcpAuthorization: Redacted.Redacted<string>;
  readonly apiKey: Redacted.Redacted<string>;
  readonly model: string;
  readonly reasoning: string;
  readonly parentEnvironment: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxTurns?: number;
  readonly runner?: ClaudeCliTrialRunner;
}

export interface ClaudeCliParseContext {
  readonly pluginDirectory: string;
  readonly workingDirectory: string;
  readonly forbiddenReadRoots: readonly string[];
}

interface ClaudeCliPreparedPaths {
  readonly configDirectory: string;
  readonly mcpConfigPath: string;
  readonly settingsPath: string;
  readonly pluginDirectory: string;
  readonly workingDirectory: string;
}

interface ValidatedClaudeCliTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly workingDirectory: string;
  readonly executablePath: string;
  readonly pluginDirectory: string;
  readonly mcpAuthorization: string;
  readonly apiKey: string;
  readonly model: string;
  readonly reasoning: ClaudeEffort;
  readonly parentEnvironment: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  readonly maxTurns: number;
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const isClaudeEffort = (value: string): value is ClaudeEffort =>
  Object.hasOwn(CLAUDE_EFFORTS, value);

const isAskGinaSkillName = (value: string): value is (typeof SKILL_NAMES)[number] =>
  Object.hasOwn(ASK_GINA_SKILL_NAME_SET, value);

const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const uniqueLeft = new Set(left);
  return uniqueLeft.size === left.length && right.every((tool) => uniqueLeft.has(tool));
};

const collapsePath = (value: string): string => {
  const replaced = value.replaceAll("\\", "/");
  const absolute = replaced.startsWith("/");
  const resolved: string[] = [];
  for (const segment of replaced.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return `${absolute ? "/" : ""}${resolved.join("/")}`;
};

const isWithin = (parent: string, child: string): boolean => {
  const normalizedParent = collapsePath(parent).replace(/\/$/u, "");
  const normalizedChild = collapsePath(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
};

const resolveCandidatePath = (workingDirectory: string, candidate: string): string => {
  const normalized = candidate.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return collapsePath(normalized);
  return collapsePath(`${workingDirectory.replace(/\/$/u, "")}/${normalized}`);
};

const absoluteReadRule = (target: string): string => {
  const collapsed = collapsePath(target).replace(/\/$/u, "");
  const withoutLeading = collapsed.startsWith("/") ? collapsed.slice(1) : collapsed;
  return `Read(//${withoutLeading}/**)`;
};

const mcpAuthorizationHeader = (token: string): string =>
  token.startsWith("Bearer ") ? token : `Bearer ${token}`;

const promptFromCase = (evalCase: PluginEvalCase): string => {
  const userTurns = evalCase.turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  return (userTurns.length > 0 ? userTurns : evalCase.turns.map((turn) => turn.content)).join(
    "\n\n",
  );
};

export const buildClaudeCliEnvironment = (
  parentEnvironment: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of CLAUDE_CLI_ALLOWED_ENVIRONMENT_NAMES) {
    const value = parentEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
};

const claudeEvalSettings = (
  paths: ClaudeCliPreparedPaths,
  availableTools: readonly string[],
): string =>
  JSON.stringify({
    disableAllHooks: true,
    disableBundledSkills: true,
    disableAutoMode: "disable",
    disableBypassPermissionsMode: "disable",
    permissions: {
      defaultMode: "dontAsk",
      disableAutoMode: "disable",
      disableBypassPermissionsMode: "disable",
      blockReadsOutsideWorkingDirectories: true,
      allow: [
        ...CLAUDE_SKILL_PERMISSION_RULES,
        absoluteReadRule(paths.pluginDirectory),
        absoluteReadRule(pathJoin(paths.pluginDirectory, "skills")),
        ...availableTools.map(claudeMcpToolName),
      ],
      deny: [
        "Bash",
        "Write",
        "Edit",
        "NotebookEdit",
        "WebFetch",
        "WebSearch",
        "Agent",
        "Task",
        absoluteReadRule(paths.configDirectory),
      ],
    },
  });

const claudeMcpConfig = (authorization: string): string =>
  JSON.stringify({
    mcpServers: {
      [ASK_GINA_MCP_SERVER]: {
        type: "http",
        url: PRODUCTION_MCP_URL,
        headers: {
          Authorization: mcpAuthorizationHeader(authorization),
        },
      },
    },
  });

const writeClaudeEvalConfig = (
  caseId: string,
  options: ValidatedClaudeCliTrialOptions,
  paths: ClaudeCliPreparedPaths,
): Effect.Effect<void, PluginEvalClaudeCliSpawnError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.chmod(paths.configDirectory, 0o700);
    yield* fs.makeDirectory(pathJoin(paths.configDirectory, "tmp"), {
      recursive: true,
      mode: 0o700,
    });
    yield* fs.writeFileString(
      paths.settingsPath,
      claudeEvalSettings(paths, options.availableTools),
      {
        flag: "w",
        mode: 0o600,
      },
    );
    yield* fs.writeFileString(paths.mcpConfigPath, claudeMcpConfig(options.mcpAuthorization), {
      flag: "w",
      mode: 0o600,
    });
  }).pipe(
    Effect.mapError(
      () =>
        new PluginEvalClaudeCliSpawnError({
          caseId,
          reason: "could_not_write_config",
        }),
    ),
  );

const pathJoin = (left: string, right: string): string =>
  `${left.replace(/[/\\]+$/u, "")}/${right}`;

const makeClaudeCliCommand = (
  evalCase: PluginEvalCase,
  options: ValidatedClaudeCliTrialOptions,
  paths: ClaudeCliPreparedPaths,
): ClaudeCliCommand => {
  const configTmp = pathJoin(paths.configDirectory, "tmp");
  const addDirectories = [paths.pluginDirectory, pathJoin(paths.pluginDirectory, "skills")]
    .filter((root) => !isWithin(paths.workingDirectory, root))
    .flatMap((root) => ["--add-dir", root]);
  const allowedTools = [
    ...CLAUDE_SKILL_PERMISSION_RULES,
    "Read",
    ...options.availableTools.map(claudeMcpToolName),
  ].join(",");
  return {
    caseId: evalCase.id,
    command: options.executablePath,
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--restricted",
      "--strict-mcp-config",
      "--permission-prompts",
      "none",
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
      "--plugin-dir",
      paths.pluginDirectory,
      "--mcp-config",
      paths.mcpConfigPath,
      "--settings",
      paths.settingsPath,
      ...addDirectories,
      "--tools",
      "Skill,Read",
      "--disallowedTools",
      DISALLOWED_BUILTIN_TOOLS,
      "--allowedTools",
      allowedTools,
      "--model",
      options.model,
      "--effort",
      options.reasoning,
      "--max-turns",
      String(options.maxTurns),
      "--",
      promptFromCase(evalCase),
    ],
    workingDirectory: paths.workingDirectory,
    environment: {
      ...buildClaudeCliEnvironment(options.parentEnvironment),
      HOME: paths.configDirectory,
      USERPROFILE: paths.configDirectory,
      [CLAUDE_CONFIG_DIR_ENV]: paths.configDirectory,
      XDG_CONFIG_HOME: paths.configDirectory,
      XDG_CACHE_HOME: paths.configDirectory,
      XDG_DATA_HOME: paths.configDirectory,
      TMPDIR: configTmp,
      TMP: configTmp,
      TEMP: configTmp,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_MAX_RETRIES: "0",
      CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: "1",
      [MCP_DISCOVERY_CACHE_ENV]: "0",
      [ANTHROPIC_API_KEY_ENV]: options.apiKey,
    },
    stdoutLimitBytes: CLAUDE_CLI_MAX_STDOUT_BYTES,
    stderrLimitBytes: CLAUDE_CLI_MAX_STDERR_BYTES,
  };
};

const detectClaudeCliOutputTruncation = <Error>(
  stream: Stream.Stream<Uint8Array, Error>,
  maximumBytes: number,
): Effect.Effect<boolean, Error> => {
  const limit = Math.max(0, Math.trunc(maximumBytes));
  return stream.pipe(
    Stream.runFold(
      () => ({ byteLength: 0, truncated: false }),
      (output, chunk) => {
        const remaining = Math.max(0, limit - output.byteLength);
        output.byteLength += Math.min(remaining, chunk.byteLength);
        if (chunk.byteLength > remaining) output.truncated = true;
        return output;
      },
    ),
    Effect.map((output) => output.truncated),
  );
};

export const effectClaudeCliTrialRunner: ClaudeCliTrialRunner = {
  run: (command) =>
    Effect.scoped(
      Effect.gen(function* () {
        const process = yield* ChildProcess.make(command.command, command.args, {
          cwd: command.workingDirectory,
          env: { ...command.environment },
          extendEnv: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: PROCESS_FORCE_KILL_AFTER,
        }).pipe(
          Effect.mapError(
            () =>
              new PluginEvalClaudeCliSpawnError({
                caseId: command.caseId,
                reason: "could_not_start",
              }),
          ),
        );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectBoundedUtf8Output(process.stdout, command.stdoutLimitBytes),
            detectClaudeCliOutputTruncation(process.stderr, command.stderrLimitBytes),
            process.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.mapError(
            () =>
              new PluginEvalClaudeCliSpawnError({
                caseId: command.caseId,
                reason: "could_not_collect_output",
              }),
          ),
        );
        return {
          exitCode,
          stdout: stdout.text,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr,
        } satisfies ClaudeCliProcessResult;
      }),
    ),
};

const messageContent = (event: Readonly<Record<string, unknown>>): unknown => {
  if (isJsonObject(event.message)) return event.message.content;
  return event.content;
};

const contentBlocks = (value: unknown): readonly Record<string, unknown>[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonObject);
};

const skillFromUnknown = (value: unknown): string | undefined => {
  const raw = asString(value)?.trim();
  if (raw === undefined) return undefined;
  const trimmed = raw.replace(/^\/+/u, "");
  const separator = trimmed.indexOf(":");
  const skill =
    separator === -1
      ? trimmed
      : trimmed.slice(0, separator) === ASK_GINA_MCP_SERVER
        ? trimmed.slice(separator + 1)
        : trimmed;
  return isAskGinaSkillName(skill) ? skill : undefined;
};

const skillFromToolInput = (input: Readonly<Record<string, unknown>>): string | undefined =>
  skillFromUnknown(input.skill) ?? skillFromUnknown(input.name) ?? skillFromUnknown(input.command);

const skillFromPluginPath = (candidate: string, pluginDirectory: string): string | undefined => {
  const normalizedCandidate = collapsePath(candidate);
  const skillsRoot = collapsePath(pathJoin(pluginDirectory, "skills")).replace(/\/$/u, "");
  for (const skill of SKILL_NAMES) {
    if (normalizedCandidate === `${skillsRoot}/${skill}/SKILL.md`) {
      return skill;
    }
  }
  return undefined;
};

const catalogFromClaudeInit = (
  event: Readonly<Record<string, unknown>>,
  pluginDirectory: string,
): readonly GinaReadToolName[] | undefined => {
  const pluginErrors = event.plugin_errors;
  const serverErrors = event.mcp_server_errors;
  if (
    (pluginErrors !== undefined && (!Array.isArray(pluginErrors) || pluginErrors.length > 0)) ||
    (serverErrors !== undefined && (!Array.isArray(serverErrors) || serverErrors.length > 0))
  ) {
    return undefined;
  }
  const plugins = event.plugins;
  if (!Array.isArray(plugins) || plugins.length !== 1 || !isJsonObject(plugins[0]))
    return undefined;
  const plugin = plugins[0];
  const pluginPath = asString(plugin.path);
  if (
    asString(plugin.name) !== ASK_GINA_MCP_SERVER ||
    pluginPath === undefined ||
    collapsePath(pluginPath) !== collapsePath(pluginDirectory)
  ) {
    return undefined;
  }
  const servers = event.mcp_servers;
  if (!Array.isArray(servers) || servers.length !== 1 || !isJsonObject(servers[0]))
    return undefined;
  const server = servers[0];
  if (asString(server.name) !== ASK_GINA_MCP_SERVER || asString(server.status) !== "connected") {
    return undefined;
  }
  const tools = event.tools;
  if (!Array.isArray(tools)) return undefined;
  const toolNames: string[] = [];
  let endConversationSeen = false;
  for (const tool of tools) {
    if (typeof tool !== "string" || tool.length === 0) return undefined;
    if (tool === "EndConversation") {
      if (endConversationSeen) return undefined;
      endConversationSeen = true;
      continue;
    }
    toolNames.push(tool);
  }
  if (!catalogsMatch(toolNames, CLAUDE_INIT_TOOL_NAMES)) return undefined;
  return CANONICAL_CATALOG_TOOL_NAMES;
};

const decodeToolArguments = (value: unknown): PluginEvalToolCall["arguments"] | undefined => {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isJsonObject(parsed) ? (parsed as PluginEvalToolCall["arguments"]) : undefined;
    } catch {
      return undefined;
    }
  }
  return isJsonObject(value) ? (value as PluginEvalToolCall["arguments"]) : undefined;
};

const tokenUsageFromUnknown = (value: unknown): PluginEvalTokenUsage | undefined => {
  if (!isJsonObject(value)) return undefined;
  const inputTokens = value.input_tokens;
  const outputTokens = value.output_tokens;
  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  ) {
    return undefined;
  }
  const totalTokens =
    value.total_tokens === undefined ? inputTokens + outputTokens : value.total_tokens;
  if (typeof totalTokens !== "number" || !Number.isSafeInteger(totalTokens) || totalTokens < 0) {
    return undefined;
  }
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
};

const serializedResultBytes = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return UTF8_ENCODER.encode(serialized).byteLength;
};

const classifyToolUse = (
  name: string,
  input: Readonly<Record<string, unknown>>,
  context: ClaudeCliParseContext,
):
  | { readonly kind: "skill"; readonly skill: string }
  | { readonly kind: "read"; readonly skill?: string }
  | { readonly kind: "mcp"; readonly name: string }
  | { readonly kind: "unsupported" } => {
  if (name === "Skill") {
    const skill = skillFromToolInput(input);
    return skill === undefined ? { kind: "unsupported" } : { kind: "skill", skill };
  }
  if (name === "Read") {
    const candidate = asString(input.file_path) ?? asString(input.path) ?? asString(input.file);
    if (candidate === undefined) return { kind: "unsupported" };
    const resolved = resolveCandidatePath(context.workingDirectory, candidate);
    if (context.forbiddenReadRoots.some((root) => isWithin(root, resolved))) {
      return { kind: "unsupported" };
    }
    const skill = skillFromPluginPath(resolved, context.pluginDirectory);
    if (skill !== undefined) return { kind: "read", skill };
    if (
      isWithin(context.pluginDirectory, resolved) ||
      isWithin(context.workingDirectory, resolved)
    ) {
      return { kind: "read" };
    }
    return { kind: "unsupported" };
  }
  const canonicalName = CLAUDE_MCP_TOOL_NAME_LOOKUP[name];
  if (canonicalName === undefined) return { kind: "unsupported" };
  return { kind: "mcp", name: canonicalName };
};

export const parseClaudeCliStreamJson = Function.dual<
  (context: ClaudeCliParseContext) => (jsonl: string) => ClaudeCliParsedStream,
  (jsonl: string, context: ClaudeCliParseContext) => ClaudeCliParsedStream
>(2, (jsonl, context) => {
  const activatedSkills: string[] = [];
  const toolCalls: PluginEvalToolCall[] = [];
  let malformedJsonl = false;
  const pending = new Map<
    string,
    | {
        readonly kind: "mcp";
        readonly sequence: number;
        readonly name: string;
        readonly arguments: PluginEvalToolCall["arguments"];
      }
    | { readonly kind: "skill"; readonly skill: string }
    | { readonly kind: "read"; readonly skill?: string }
    | { readonly kind: "ignored" }
  >();
  const seenToolUseIds = new Set<string>();
  let finalAnswer: string | undefined;
  let tokenUsage: PluginEvalTokenUsage | undefined;
  let unsupportedActions = 0;
  let resultSeen = false;
  let resultSuccess = false;
  let eventsAfterResult = 0;
  let nextToolCallSequence = 0;
  let initSeen = false;
  let initInvalid = false;
  let sawActionOrResult = false;
  let initAvailableTools: readonly GinaReadToolName[] | undefined;

  const rememberSkill = (skill: string): void => {
    if (!activatedSkills.includes(skill)) activatedSkills.push(skill);
  };

  for (const rawLine of jsonl.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (resultSeen) eventsAfterResult += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedJsonl = true;
      continue;
    }
    if (!isJsonObject(parsed)) {
      malformedJsonl = true;
      continue;
    }

    const type = asString(parsed.type);
    if (type === "system") {
      if (asString(parsed.subtype) !== "init") continue;
      if (initSeen || sawActionOrResult) {
        initInvalid = true;
        initAvailableTools = undefined;
        continue;
      }
      initSeen = true;
      const catalog = catalogFromClaudeInit(parsed, context.pluginDirectory);
      if (catalog === undefined) {
        initInvalid = true;
        continue;
      }
      initAvailableTools = catalog;
      continue;
    }
    if (type === "assistant" || type === "user" || type === "result") {
      if (initAvailableTools === undefined) {
        sawActionOrResult = true;
        initInvalid = true;
        continue;
      }
    }
    if (type === "assistant") {
      for (const block of contentBlocks(messageContent(parsed))) {
        const blockType = asString(block.type);
        if (blockType === undefined) continue;
        if (Object.hasOwn(CLAUDE_NON_ACTION_BLOCK_TYPES, blockType)) continue;
        if (blockType !== "tool_use") {
          unsupportedActions += 1;
          continue;
        }
        const id = asString(block.id);
        const name = asString(block.name);
        const input = isJsonObject(block.input) ? block.input : undefined;
        if (id === undefined || name === undefined) {
          malformedJsonl = true;
          continue;
        }
        if (seenToolUseIds.has(id)) {
          malformedJsonl = true;
          continue;
        }
        seenToolUseIds.add(id);
        const classified = classifyToolUse(name, input ?? {}, context);
        if (classified.kind === "unsupported") {
          unsupportedActions += 1;
          pending.set(id, { kind: "ignored" });
          continue;
        }
        if (classified.kind === "skill") {
          pending.set(id, { kind: "skill", skill: classified.skill });
          continue;
        }
        if (classified.kind === "read") {
          pending.set(
            id,
            classified.skill === undefined
              ? { kind: "read" }
              : { kind: "read", skill: classified.skill },
          );
          continue;
        }
        const sequence = nextToolCallSequence;
        nextToolCallSequence += 1;
        const argumentsValue = decodeToolArguments(input);
        if (argumentsValue === undefined) {
          toolCalls.push({
            sequence,
            name: classified.name,
            arguments: {},
            requested_scope: READ_SCOPE,
            error: {
              code: "invalid_arguments",
              message: "Claude returned invalid MCP arguments",
            },
          });
          pending.set(id, { kind: "ignored" });
        } else {
          pending.set(id, {
            kind: "mcp",
            sequence,
            name: classified.name,
            arguments: argumentsValue,
          });
        }
      }
      continue;
    }

    if (type === "user") {
      for (const block of contentBlocks(messageContent(parsed))) {
        if (asString(block.type) !== "tool_result") continue;
        const toolUseId = asString(block.tool_use_id) ?? asString(block.toolUseId);
        if (toolUseId === undefined) {
          malformedJsonl = true;
          continue;
        }
        const pendingCall = pending.get(toolUseId);
        pending.delete(toolUseId);
        if (pendingCall === undefined) {
          malformedJsonl = true;
          continue;
        }
        const failed = block.is_error === true || block.isError === true;
        if (pendingCall.kind === "skill" || pendingCall.kind === "read") {
          if (!failed && pendingCall.skill !== undefined) rememberSkill(pendingCall.skill);
          continue;
        }
        if (pendingCall.kind !== "mcp") continue;
        const resultBytes = serializedResultBytes(block.content ?? block.output);
        toolCalls.push({
          sequence: pendingCall.sequence,
          name: pendingCall.name,
          arguments: pendingCall.arguments,
          requested_scope: READ_SCOPE,
          ...(resultBytes === undefined ? {} : { result_bytes: resultBytes }),
          ...(failed ? { error: { message: "MCP tool call failed" } } : {}),
        });
      }
      continue;
    }

    if (type === "result") {
      resultSeen = true;
      const subtype = asString(parsed.subtype);
      resultSuccess = subtype === "success" && parsed.is_error === false;
      const resultText = asString(parsed.result);
      if (resultText !== undefined) finalAnswer = resultText;
      tokenUsage = tokenUsageFromUnknown(parsed.usage) ?? tokenUsage;
      continue;
    }
  }

  const incomplete =
    initAvailableTools === undefined ||
    initInvalid ||
    !resultSuccess ||
    [...pending.values()].some((value) => value.kind !== "ignored") ||
    eventsAfterResult > 0;
  const orderedToolCalls = [...toolCalls].sort((left, right) => left.sequence - right.sequence);
  return {
    activated_skills: activatedSkills,
    tool_calls: orderedToolCalls,
    unsupported_actions: unsupportedActions,
    malformed_jsonl: malformedJsonl,
    incomplete,
    ...(initAvailableTools === undefined ? {} : { available_tools: initAvailableTools }),
    ...(finalAnswer === undefined ? {} : { final_answer: finalAnswer }),
    ...(tokenUsage === undefined ? {} : { token_usage: tokenUsage }),
    ...(unsupportedActions === 0
      ? {}
      : {
          error: "Claude used an action outside Skill, plugin reads, or canonical Gina MCP reads",
        }),
  };
});

const validateOptions = (
  evalCase: PluginEvalCase,
  options: ClaudeCliTrialOptions,
): Effect.Effect<ValidatedClaudeCliTrialOptions, PluginEvalClaudeCliSpawnError> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const apiKey = Redacted.value(options.apiKey);
  const mcpAuthorization = Redacted.value(options.mcpAuthorization);
  if (!catalogsMatch(options.availableTools, listCatalogToolNames())) {
    return Effect.fail(
      new PluginEvalClaudeCliSpawnError({
        caseId: evalCase.id,
        reason: "catalog-mismatch",
      }),
    );
  }
  if (
    options.runId.trim().length === 0 ||
    options.model.trim().length === 0 ||
    apiKey.trim().length === 0 ||
    mcpAuthorization.trim().length === 0 ||
    !options.executablePath.startsWith("/") ||
    !options.workingDirectory.startsWith("/") ||
    !options.pluginDirectory.startsWith("/") ||
    !Number.isSafeInteger(options.repetition) ||
    options.repetition <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxTurns) ||
    maxTurns <= 0 ||
    maxTurns > MAXIMUM_MAX_TURNS ||
    !isClaudeEffort(options.reasoning)
  ) {
    return Effect.fail(
      new PluginEvalClaudeCliSpawnError({
        caseId: evalCase.id,
        reason: "invalid-options",
      }),
    );
  }
  return Effect.succeed({
    runId: options.runId,
    repetition: options.repetition,
    availableTools: options.availableTools,
    workingDirectory: options.workingDirectory,
    executablePath: options.executablePath,
    pluginDirectory: options.pluginDirectory,
    mcpAuthorization,
    apiKey,
    model: options.model,
    reasoning: options.reasoning,
    parentEnvironment: options.parentEnvironment,
    timeoutMs,
    maxTurns,
  });
};

export const runClaudeCliPluginEvalTrial = Function.dual<
  (
    options: ClaudeCliTrialOptions,
  ) => (
    evalCase: PluginEvalCase,
  ) => Effect.Effect<
    PluginEvalObservation,
    PluginEvalClaudeCliError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >,
  (
    evalCase: PluginEvalCase,
    options: ClaudeCliTrialOptions,
  ) => Effect.Effect<
    PluginEvalObservation,
    PluginEvalClaudeCliError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >
>(2, (evalCase, options) => {
  const runner = options.runner ?? effectClaudeCliTrialRunner;
  return Effect.scoped(
    Effect.gen(function* () {
      const validated = yield* validateOptions(evalCase, options);
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const configDirectory = yield* fs
        .makeTempDirectoryScoped({ prefix: "ask-gina-claude-config-" })
        .pipe(
          Effect.mapError(
            () =>
              new PluginEvalClaudeCliSpawnError({
                caseId: evalCase.id,
                reason: "could_not_write_config",
              }),
          ),
        );
      const paths: ClaudeCliPreparedPaths = {
        configDirectory,
        mcpConfigPath: path.join(configDirectory, "mcp.json"),
        settingsPath: path.join(configDirectory, "settings.json"),
        pluginDirectory: validated.pluginDirectory,
        workingDirectory: validated.workingDirectory,
      };
      yield* writeClaudeEvalConfig(evalCase.id, validated, paths);
      const command = makeClaudeCliCommand(evalCase, validated, paths);
      const startedAt = DateTime.formatIso(yield* DateTime.now);
      const startedMillis = yield* Clock.currentTimeMillis;
      const processResult = yield* runner.run(command).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(validated.timeoutMs),
          orElse: () =>
            Effect.fail(
              new PluginEvalClaudeCliTimeoutError({
                caseId: evalCase.id,
                timeoutMs: validated.timeoutMs,
              }),
            ),
        }),
      );
      if (processResult.stdoutTruncated) {
        return yield* new PluginEvalClaudeCliProcessError({
          caseId: evalCase.id,
          reason: "stdout-truncated",
        });
      }
      if (processResult.stderrTruncated) {
        return yield* new PluginEvalClaudeCliProcessError({
          caseId: evalCase.id,
          reason: "stderr-truncated",
        });
      }
      if (processResult.exitCode !== 0) {
        return yield* new PluginEvalClaudeCliProcessError({
          caseId: evalCase.id,
          reason: "nonzero-exit",
        });
      }

      const parsed = parseClaudeCliStreamJson(processResult.stdout, {
        pluginDirectory: validated.pluginDirectory,
        workingDirectory: validated.workingDirectory,
        forbiddenReadRoots: [configDirectory],
      });
      if (parsed.malformed_jsonl) {
        return yield* new PluginEvalClaudeCliProcessError({
          caseId: evalCase.id,
          reason: "malformed-jsonl",
        });
      }
      if (parsed.incomplete) {
        return yield* new PluginEvalClaudeCliProcessError({
          caseId: evalCase.id,
          reason: "incomplete-stream",
        });
      }
      const finishedMillis = yield* Clock.currentTimeMillis;
      return {
        version: 1,
        run_id: validated.runId,
        case_id: evalCase.id,
        target: "claude_cli",
        model: validated.model,
        repetition: validated.repetition,
        started_at: startedAt,
        status: parsed.error === undefined ? "completed" : "failed",
        duration_ms: Math.max(0, finishedMillis - startedMillis),
        activated_skills: [...parsed.activated_skills],
        tool_calls: [...parsed.tool_calls],
        ...(parsed.available_tools === undefined
          ? {}
          : { available_tools: [...parsed.available_tools] }),
        ...(parsed.token_usage === undefined ? {} : { token_usage: parsed.token_usage }),
        ...(parsed.final_answer === undefined ? {} : { final_answer: parsed.final_answer }),
        ...(parsed.error === undefined ? {} : { error: parsed.error }),
      } satisfies PluginEvalObservation;
    }),
  ).pipe(
    Effect.withSpan("plugin_evals.claude_cli_trial", {
      attributes: {
        "plugin_eval.case_id": evalCase.id,
        "plugin_eval.repetition": options.repetition,
      },
    }),
  );
});
