import { createHash } from "node:crypto";
import {
  Clock,
  Data,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Function,
  Option,
  Path,
  Redacted,
  Scope,
  Stream,
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { isGinaReadToolName, listCatalogToolNames, READ_SCOPE } from "@askgina/contracts";

import type {
  PluginEvalCase,
  PluginEvalObservation,
  PluginEvalTokenUsage,
  PluginEvalToolCall,
} from "./contracts";
import { collectBoundedUtf8Output } from "./bounded-output";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "codex-cli";
const PROCESS_FORCE_KILL_AFTER = Duration.seconds(1);
const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const CODEX_EVAL_PROFILE = "ask-gina-eval";

export const CODEX_CLI_MAX_STDOUT_BYTES = 1_048_576;
export const CODEX_CLI_MAX_STDERR_BYTES = 65_536;

export const ASK_GINA_PLUGIN_SKILL_NAMES = [
  "review-gina-account",
  "research-spot-tokens",
  "research-hyperliquid",
  "research-prediction-markets",
] as const;

const ASK_GINA_SKILL_NAMES: Readonly<Record<(typeof ASK_GINA_PLUGIN_SKILL_NAMES)[number], true>> = {
  "review-gina-account": true,
  "research-spot-tokens": true,
  "research-hyperliquid": true,
  "research-prediction-markets": true,
};
const ASK_GINA_SKILL_PATH_RE =
  /(?:^|[/\\])ask-gina(?:@[^/\\]+)?(?:[/\\].*)?[/\\]skills[/\\](review-gina-account|research-spot-tokens|research-hyperliquid|research-prediction-markets)[/\\]SKILL\.md\b/u;
const ASK_GINA_MCP_SERVER = "gina";
const ASK_GINA_MCP_SERVER_NAMES: Readonly<Record<string, true>> = {
  gina: true,
  "ask-gina": true,
};
const CODEX_NON_ACTION_ITEM_TYPES: Readonly<Record<string, true>> = {
  agent_message: true,
  reasoning: true,
  todo_list: true,
};
const SAFE_SKILL_READ_COMMAND_RE =
  /^(?:cat(?:\s+--)?|sed\s+-n\s+(?:'\d+(?:,\d+)?p'|"\d+(?:,\d+)?p"|\d+(?:,\d+)?p))\s+(?:"([^"\s;&|><$`]+)"|'([^'\s;&|><$`]+)'|([^\s;&|><$`'"]+))$/u;
const UTF8_ENCODER = new TextEncoder();
export class PluginEvalCodexCliSpawnError extends Data.TaggedError("PluginEvalCodexCliSpawnError")<{
  readonly caseId: string;
  readonly reason:
    | "catalog-mismatch"
    | "could_not_collect_output"
    | "could_not_start"
    | "could_not_write_profile";
}> {}

export class PluginEvalCodexCliTimeoutError extends Data.TaggedError(
  "PluginEvalCodexCliTimeoutError",
)<{
  readonly caseId: string;
  readonly timeoutMs: number;
}> {}

export class PluginEvalCodexCliExecutableError extends Data.TaggedError(
  "PluginEvalCodexCliExecutableError",
)<{
  readonly reason:
    | "invalid-path"
    | "forbidden-path"
    | "invalid-file"
    | "digest-mismatch"
    | "descriptor-unavailable";
}> {}
export class PluginEvalCodexCliProcessError extends Data.TaggedError(
  "PluginEvalCodexCliProcessError",
)<{
  readonly caseId: string;
  readonly reason: "malformed-jsonl" | "stdout-truncated" | "stderr-truncated" | "nonzero-exit";
}> {}

export type PluginEvalCodexCliError =
  | PluginEvalCodexCliSpawnError
  | PluginEvalCodexCliTimeoutError
  | PluginEvalCodexCliExecutableError
  | PluginEvalCodexCliProcessError;

export interface AttestedCodexExecutable {
  readonly path: string;
  readonly sha256: string;
  readonly dev: number;
  readonly ino?: number;
  readonly mode: number;
  readonly size: bigint;
}

export interface OpenAttestedCodexExecutable {
  readonly command: string;
  readonly executable: AttestedCodexExecutable;
}

export interface AttestCodexExecutableOptions {
  readonly executablePath: string;
  readonly expectedSha256: string;
  readonly forbiddenRoots?: readonly string[];
}

const isWithin = (path: Path.Path, parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isNativeExecutableHeader = (bytes: readonly number[]): boolean =>
  (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) ||
  (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) ||
  (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && bytes[3] === 0xcf);

const executableDescriptorPath = (descriptor: number): string | undefined => {
  if (process.platform === "linux") return `/proc/self/fd/${descriptor}`;
  return undefined;
};

const fileDescriptor = (file: FileSystem.File): number | undefined => {
  const descriptor = Reflect.get(file, "fd");
  return typeof descriptor === "number" && Number.isSafeInteger(descriptor) && descriptor >= 0
    ? descriptor
    : undefined;
};

const inspectOpenExecutable = (
  handle: FileSystem.File,
  expectedSha256: string,
  options: {
    readonly copyTo?: FileSystem.File;
    readonly forbiddenWriteBits: number;
  },
): Effect.Effect<Omit<AttestedCodexExecutable, "path">, PluginEvalCodexCliExecutableError> =>
  Effect.gen(function* () {
    const before = yield* handle.stat.pipe(
      Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
    );
    if (
      before.type !== "File" ||
      (before.mode & 0o111) === 0 ||
      (before.mode & options.forbiddenWriteBits) !== 0
    ) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "invalid-file" });
    }
    yield* handle
      .seek(0n, "start")
      .pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
      );
    const hash = createHash("sha256");
    const header: number[] = [];
    while (true) {
      const maybeChunk = yield* handle
        .readAlloc(64 * 1024)
        .pipe(
          Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
        );
      if (Option.isNone(maybeChunk)) break;
      const chunk = maybeChunk.value;
      hash.update(chunk);
      if (options.copyTo !== undefined) {
        yield* options.copyTo
          .writeAll(chunk)
          .pipe(
            Effect.mapError(
              () => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" }),
            ),
          );
      }
      for (let index = 0; index < chunk.length && header.length < 4; index += 1) {
        const value = chunk[index];
        if (value !== undefined) header.push(value);
      }
    }
    if (options.copyTo !== undefined) {
      yield* options.copyTo.sync.pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
      );
    }
    const after = yield* handle.stat.pipe(
      Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
    );
    const beforeIno = Option.getOrUndefined(before.ino);
    const afterIno = Option.getOrUndefined(after.ino);
    const beforeMtime = Option.getOrUndefined(before.mtime)?.getTime();
    const afterMtime = Option.getOrUndefined(after.mtime)?.getTime();
    const sha256 = hash.digest("hex");
    if (
      !isNativeExecutableHeader(header) ||
      sha256 !== expectedSha256 ||
      after.type !== "File" ||
      before.dev !== after.dev ||
      beforeIno !== afterIno ||
      before.mode !== after.mode ||
      before.size !== after.size ||
      beforeMtime !== afterMtime
    ) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "digest-mismatch" });
    }
    if (
      !Number.isSafeInteger(after.dev) ||
      !Number.isSafeInteger(after.mode) ||
      (afterIno !== undefined && !Number.isSafeInteger(afterIno))
    ) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "invalid-file" });
    }
    return {
      sha256,
      dev: after.dev,
      ...(afterIno === undefined ? {} : { ino: afterIno }),
      mode: after.mode,
      size: after.size,
    };
  });

export const openAttestedCodexExecutable = ({
  executablePath,
  expectedSha256,
  forbiddenRoots = [],
}: AttestCodexExecutableOptions): Effect.Effect<
  OpenAttestedCodexExecutable,
  PluginEvalCodexCliExecutableError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!path.isAbsolute(executablePath) || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "invalid-path" });
    }
    const canonical = yield* fs
      .realPath(executablePath)
      .pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-path" })),
      );
    if (forbiddenRoots.some((root) => isWithin(path, path.resolve(root), canonical))) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "forbidden-path" });
    }
    const descriptorRoot = executableDescriptorPath(0);
    if (descriptorRoot === undefined) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "descriptor-unavailable" });
    }
    const snapshotDirectory = yield* fs
      .makeTempDirectoryScoped({
        prefix: "ask-gina-codex-executable-",
      })
      .pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
      );
    yield* fs
      .chmod(snapshotDirectory, 0o700)
      .pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
      );
    const snapshotPath = path.join(snapshotDirectory, "codex");
    const inspected = yield* Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fs
          .open(canonical, { flag: "r" })
          .pipe(
            Effect.mapError(
              () => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" }),
            ),
          );
        const snapshotWriter = yield* fs
          .open(snapshotPath, { flag: "wx", mode: 0o500 })
          .pipe(
            Effect.mapError(
              () => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" }),
            ),
          );
        const sourceInspection = yield* inspectOpenExecutable(source, expectedSha256, {
          copyTo: snapshotWriter,
          forbiddenWriteBits: 0o022,
        });
        yield* fs
          .chmod(snapshotPath, 0o500)
          .pipe(
            Effect.mapError(
              () => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" }),
            ),
          );
        return sourceInspection;
      }),
    );
    const snapshot = yield* fs
      .open(snapshotPath, { flag: "r" })
      .pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
      );
    const descriptor = fileDescriptor(snapshot);
    if (descriptor === undefined) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "descriptor-unavailable" });
    }
    const command = executableDescriptorPath(descriptor);
    if (command === undefined) {
      return yield* new PluginEvalCodexCliExecutableError({ reason: "descriptor-unavailable" });
    }
    yield* inspectOpenExecutable(snapshot, expectedSha256, { forbiddenWriteBits: 0o222 });
    yield* fs
      .remove(snapshotPath)
      .pipe(
        Effect.mapError(() => new PluginEvalCodexCliExecutableError({ reason: "invalid-file" })),
      );
    return {
      command,
      executable: { path: canonical, ...inspected },
    };
  });

export const attestCodexExecutable = (
  options: AttestCodexExecutableOptions,
): Effect.Effect<
  AttestedCodexExecutable,
  PluginEvalCodexCliExecutableError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.scoped(
    openAttestedCodexExecutable(options).pipe(Effect.map(({ executable }) => executable)),
  );

export interface CodexExecParsedStream {
  readonly activated_skills: readonly string[];
  readonly tool_calls: readonly PluginEvalToolCall[];
  readonly unsupported_actions: number;
  readonly malformed_jsonl: boolean;
  readonly final_answer?: string;
  readonly token_usage?: PluginEvalTokenUsage;
  readonly error?: string;
}

export interface CodexCliCommand {
  readonly caseId: string;
  readonly command: string;
  readonly executable: AttestedCodexExecutable;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: "pipe";
  readonly input: string;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
}

export interface CodexCliProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface CodexCliTrialRunner {
  readonly run: (
    command: CodexCliCommand,
  ) => Effect.Effect<
    CodexCliProcessResult,
    PluginEvalCodexCliSpawnError | PluginEvalCodexCliExecutableError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >;
}

export interface CodexCliTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly workingDirectory: string;
  readonly openAiApiKey: Redacted.Redacted;
  readonly model?: string;
  readonly displayedModel?: string;
  readonly reasoning?: string;
  readonly timeoutMs?: number;
  readonly executable: AttestedCodexExecutable;
  readonly codexHome: string;
  readonly pluginId: string;
  readonly pluginSkillRoot: string;
  readonly parentEnvironment: Readonly<Record<string, string | undefined>>;
  readonly runner?: CodexCliTrialRunner;
}

export const CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES = [
  "PATH",
  "HOME",
  "CODEX_HOME",
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
const CODEX_CLI_SHELL_ENVIRONMENT_NAMES = CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES.filter(
  (name) =>
    name !== "HOME" && name !== "CODEX_HOME" && name !== "USERPROFILE" && !name.startsWith("XDG_"),
);

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const buildCodexCliEnvironment = (
  parentEnvironment: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES) {
    const value = parentEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
};
const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.every((tool, index) => index === 0 || tool !== sortedLeft[index - 1]) &&
    sortedLeft.every((tool, index) => tool === sortedRight[index])
  );
};

const tomlString = (value: string): string => JSON.stringify(value);

const configuredMcpServerNames = (config: string): readonly string[] => {
  const names: string[] = [];
  const key = "\"(?:\\\\.|[^\"\\\\])*\"|'[^']*'|[A-Za-z0-9_-]+";
  const patterns = [
    new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(${key})(?:\\s*\\.|\\s*\\])`, "gmu"),
    new RegExp(`^\\s*mcp_servers\\s*\\.\\s*(${key})\\s*\\.`, "gmu"),
  ];
  for (const pattern of patterns) {
    for (const match of config.matchAll(pattern)) {
      const rawName = match[1];
      if (rawName === undefined) continue;
      let name: string;
      if (rawName.startsWith('"')) {
        try {
          const decoded: unknown = JSON.parse(rawName);
          if (typeof decoded !== "string") continue;
          name = decoded;
        } catch {
          continue;
        }
      } else if (rawName.startsWith("'")) {
        name = rawName.slice(1, -1);
      } else {
        name = rawName;
      }
      if (!names.includes(name)) names.push(name);
    }
  }
  return names.sort();
};

const codexEvalProfile = (options: CodexCliTrialOptions, baseConfig: string): string => {
  const disabledServers = configuredMcpServerNames(baseConfig);
  const readRoots = [options.workingDirectory, options.pluginSkillRoot].filter(
    (root, index, roots) => root !== options.codexHome && roots.indexOf(root) === index,
  );
  return [
    'approval_policy = "never"',
    'web_search = "disabled"',
    `default_permissions = ${tomlString(CODEX_EVAL_PROFILE)}`,
    "",
    "[features]",
    "apps = false",
    "",
    `[permissions.${CODEX_EVAL_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    ...readRoots.map((root) => `${tomlString(root)} = "read"`),
    `${tomlString(options.codexHome)} = "deny"`,
    "",
    `[permissions.${CODEX_EVAL_PROFILE}.network]`,
    "enabled = false",
    "",
    ...disabledServers.flatMap((server) => [
      `[mcp_servers.${tomlString(server)}]`,
      "enabled = false",
      "",
    ]),
    `[plugins.${tomlString(options.pluginId)}.mcp_servers.${ASK_GINA_MCP_SERVER}]`,
    "enabled = true",
    'default_tools_approval_mode = "auto"',
    `enabled_tools = [${options.availableTools.map(tomlString).join(", ")}]`,
    "",
  ].join("\n");
};

const writeCodexEvalProfile = (
  caseId: string,
  options: CodexCliTrialOptions,
): Effect.Effect<void, PluginEvalCodexCliSpawnError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseConfigPath = path.join(options.codexHome, "config.toml");
    const profilePath = path.join(options.codexHome, `${CODEX_EVAL_PROFILE}.config.toml`);
    yield* fs.makeDirectory(options.codexHome, { recursive: true });
    const baseConfig = (yield* fs.exists(baseConfigPath))
      ? yield* fs.readFileString(baseConfigPath)
      : "";
    yield* fs.writeFileString(profilePath, codexEvalProfile(options, baseConfig), {
      flag: "w",
      mode: 0o600,
    });
  }).pipe(
    Effect.mapError(
      () =>
        new PluginEvalCodexCliSpawnError({
          caseId: caseId,
          reason: "could_not_write_profile",
        }),
    ),
  );

export const extractAskGinaActivatedSkills = (command: string): string | undefined => {
  const skill = ASK_GINA_SKILL_PATH_RE.exec(command)?.[1];
  return skill !== undefined && Object.hasOwn(ASK_GINA_SKILL_NAMES, skill) ? skill : undefined;
};

const eventItem = (
  event: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined => {
  const item = event.item;
  if (isJsonObject(item)) return item;
  const payload = event.payload;
  if (!isJsonObject(payload)) return undefined;
  const nested = payload.item;
  return isJsonObject(nested) ? nested : payload;
};

const skillFromPluginPath = (candidate: string, pluginSkillRoot: string): string | undefined => {
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  const normalizedRoot = pluginSkillRoot.replaceAll("\\", "/").replace(/\/$/u, "");
  for (const skill of ASK_GINA_PLUGIN_SKILL_NAMES) {
    if (normalizedCandidate === `${normalizedRoot}/${skill}/SKILL.md`) return skill;
  }
  return undefined;
};

const skillFromReadItem = (
  item: Readonly<Record<string, unknown>>,
  pluginSkillRoot: string,
): string | undefined => {
  if (item.type === "file_read") {
    const candidate = asString(item.path) ?? asString(item.file);
    return candidate === undefined ? undefined : skillFromPluginPath(candidate, pluginSkillRoot);
  }
  if (item.type !== "command_execution") return undefined;
  const command = asString(item.command)?.trim();
  if (command === undefined) return undefined;
  const match = SAFE_SKILL_READ_COMMAND_RE.exec(command);
  const candidate = match?.[1] ?? match?.[2] ?? match?.[3];
  return candidate === undefined ? undefined : skillFromPluginPath(candidate, pluginSkillRoot);
};

const isUnsupportedCodexAction = (
  item: Readonly<Record<string, unknown>>,
  pluginSkillRoot: string,
): boolean => {
  const type = asString(item.type);
  if (type === undefined) return true;
  if (Object.hasOwn(CODEX_NON_ACTION_ITEM_TYPES, type)) return false;
  if (type === "mcp_tool_call") return !isMcpToolItem(item);
  if (type === "command_execution" || type === "file_read") {
    return skillFromReadItem(item, pluginSkillRoot) === undefined;
  }
  return true;
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

const toolNameFromItem = (item: Readonly<Record<string, unknown>>): string | undefined =>
  asString(item.tool);

const isMcpToolItem = (item: Readonly<Record<string, unknown>>): boolean => {
  const type = asString(item.type);
  const name = toolNameFromItem(item);
  const server = asString(item.server);
  return (
    type === "mcp_tool_call" &&
    server !== undefined &&
    Object.hasOwn(ASK_GINA_MCP_SERVER_NAMES, server) &&
    name !== undefined &&
    isGinaReadToolName(name)
  );
};

const toolCallFromItem = (
  item: Readonly<Record<string, unknown>>,
  sequence: number,
): PluginEvalToolCall | undefined => {
  const name = toolNameFromItem(item);
  if (name === undefined || !isMcpToolItem(item)) return undefined;

  const result = item.result ?? item.output ?? item.aggregated_output ?? item.response;
  const serialized =
    typeof result === "string" ? result : result === undefined ? undefined : JSON.stringify(result);
  const failed = (item.error !== undefined && item.error !== null) || item.status === "failed";
  const decodedArguments = decodeToolArguments(item.arguments ?? item.args);

  return {
    sequence,
    name,
    arguments: decodedArguments ?? {},
    requested_scope: READ_SCOPE,
    ...(serialized === undefined
      ? {}
      : { result_bytes: UTF8_ENCODER.encode(serialized).byteLength }),
    ...(decodedArguments === undefined
      ? { error: { code: "invalid_arguments", message: "Codex returned invalid MCP arguments" } }
      : failed
        ? { error: { message: "MCP tool call failed" } }
        : {}),
  };
};

const tokenUsageFromUnknown = (value: unknown): PluginEvalTokenUsage | undefined => {
  if (!isJsonObject(value)) return undefined;
  const inputTokens = value.input_tokens;
  const outputTokens = value.output_tokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return undefined;
  const totalTokens =
    typeof value.total_tokens === "number" ? value.total_tokens : inputTokens + outputTokens;
  return {
    input_tokens: Math.max(0, Math.trunc(inputTokens)),
    output_tokens: Math.max(0, Math.trunc(outputTokens)),
    total_tokens: Math.max(0, Math.trunc(totalTokens)),
  };
};

export const parseCodexExecJsonl = Function.dual<
  (pluginSkillRoot: string) => (jsonl: string) => CodexExecParsedStream,
  (jsonl: string, pluginSkillRoot: string) => CodexExecParsedStream
>(2, (jsonl, pluginSkillRoot) => {
  const activatedSkills: string[] = [];
  const toolCalls: PluginEvalToolCall[] = [];
  const invalidLines: string[] = [];
  let finalAnswer: string | undefined;
  let tokenUsage: PluginEvalTokenUsage | undefined;
  let unsupportedActions = 0;

  for (const [index, rawLine] of jsonl.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidLines.push(`line ${index + 1}`);
      continue;
    }
    if (!isJsonObject(parsed)) continue;

    const type = asString(parsed.type);
    const item = eventItem(parsed);
    if (item !== undefined) {
      const skill = skillFromReadItem(item, pluginSkillRoot);
      if (skill !== undefined && !activatedSkills.includes(skill)) activatedSkills.push(skill);
      if (type === "item.completed" && isMcpToolItem(item)) {
        const toolCall = toolCallFromItem(item, toolCalls.length);
        if (toolCall !== undefined) toolCalls.push(toolCall);
      }
      if (type === "item.completed" && isUnsupportedCodexAction(item, pluginSkillRoot)) {
        unsupportedActions += 1;
      }
      if (type === "item.completed" && item.type === "agent_message") {
        const text = asString(item.text);
        if (text !== undefined) finalAnswer = text;
      }
    }
    if (type === "turn.completed") {
      tokenUsage = tokenUsageFromUnknown(parsed.usage) ?? tokenUsage;
    }
  }

  return {
    activated_skills: activatedSkills,
    tool_calls: toolCalls,
    unsupported_actions: unsupportedActions,
    malformed_jsonl: invalidLines.length > 0,
    ...(finalAnswer === undefined ? {} : { final_answer: finalAnswer }),
    ...(tokenUsage === undefined ? {} : { token_usage: tokenUsage }),
    ...(unsupportedActions === 0
      ? {}
      : { error: "Codex used an action outside the MCP catalog or a pure plugin skill read" }),
  };
});
const detectCodexCliOutputTruncation = <Error>(
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

const promptFromCase = (evalCase: PluginEvalCase): string => {
  const userTurns = evalCase.turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  return (userTurns.length > 0 ? userTurns : evalCase.turns.map((turn) => turn.content)).join(
    "\n\n",
  );
};

export const makeCodexCliCommand = Function.dual<
  (options: CodexCliTrialOptions) => (evalCase: PluginEvalCase) => CodexCliCommand,
  (evalCase: PluginEvalCase, options: CodexCliTrialOptions) => CodexCliCommand
>(2, (evalCase, options) => ({
  caseId: evalCase.id,
  command: options.executable.path,
  executable: options.executable,
  args: [
    "--profile",
    CODEX_EVAL_PROFILE,
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-rules",
    "--strict-config",
    "--color",
    "never",
    "-C",
    options.workingDirectory,
    "-c",
    'approval_policy="never"',
    "-c",
    `plugins.${JSON.stringify(options.pluginId)}.enabled=true`,
    "-c",
    `shell_environment_policy.include_only=${JSON.stringify(CODEX_CLI_SHELL_ENVIRONMENT_NAMES)}`,
    "-c",
    `shell_environment_policy.exclude=${JSON.stringify([OPENAI_API_KEY_ENV])}`,
    ...(options.reasoning === undefined
      ? []
      : ["-c", `model_reasoning_effort=${JSON.stringify(options.reasoning)}`]),
    ...(options.model === undefined ? [] : ["-m", options.model]),
  ],
  workingDirectory: options.workingDirectory,
  environment: {
    ...buildCodexCliEnvironment(options.parentEnvironment),
    HOME: options.codexHome,
    CODEX_HOME: options.codexHome,
    USERPROFILE: options.codexHome,
    XDG_CONFIG_HOME: options.codexHome,
    XDG_CACHE_HOME: options.codexHome,
    XDG_DATA_HOME: options.codexHome,
    [OPENAI_API_KEY_ENV]: Redacted.value(options.openAiApiKey),
  },
  stdin: "pipe",
  input: promptFromCase(evalCase),
  stdoutLimitBytes: CODEX_CLI_MAX_STDOUT_BYTES,
  stderrLimitBytes: CODEX_CLI_MAX_STDERR_BYTES,
}));

export const effectCodexCliTrialRunner: CodexCliTrialRunner = {
  run: (command) =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openAttestedCodexExecutable({
          executablePath: command.executable.path,
          expectedSha256: command.executable.sha256,
        });
        const actual = opened.executable;
        if (
          command.command !== actual.path ||
          command.executable.dev !== actual.dev ||
          command.executable.ino !== actual.ino ||
          command.executable.mode !== actual.mode ||
          command.executable.size !== actual.size
        ) {
          return yield* new PluginEvalCodexCliExecutableError({ reason: "digest-mismatch" });
        }
        const process = yield* ChildProcess.make(opened.command, command.args, {
          cwd: command.workingDirectory,
          env: { ...command.environment },
          extendEnv: false,
          stdin: {
            stream: Stream.make(UTF8_ENCODER.encode(command.input)),
            endOnDone: true,
          },
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: PROCESS_FORCE_KILL_AFTER,
        }).pipe(
          Effect.mapError(
            () =>
              new PluginEvalCodexCliSpawnError({
                caseId: command.caseId,
                reason: "could_not_start",
              }),
          ),
        );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectBoundedUtf8Output(process.stdout, command.stdoutLimitBytes),
            detectCodexCliOutputTruncation(process.stderr, command.stderrLimitBytes),
            process.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.mapError(
            () =>
              new PluginEvalCodexCliSpawnError({
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
        } satisfies CodexCliProcessResult;
      }),
    ),
};

export const runCodexCliPluginEvalTrial = Function.dual<
  (
    options: CodexCliTrialOptions,
  ) => (
    evalCase: PluginEvalCase,
  ) => Effect.Effect<
    PluginEvalObservation,
    PluginEvalCodexCliError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >,
  (
    evalCase: PluginEvalCase,
    options: CodexCliTrialOptions,
  ) => Effect.Effect<
    PluginEvalObservation,
    PluginEvalCodexCliError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >
>(2, (evalCase, options) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? effectCodexCliTrialRunner;
  const command = makeCodexCliCommand(evalCase, options);

  return Effect.gen(function* () {
    if (!catalogsMatch(options.availableTools, listCatalogToolNames())) {
      return yield* new PluginEvalCodexCliSpawnError({
        caseId: evalCase.id,
        reason: "catalog-mismatch",
      });
    }
    yield* writeCodexEvalProfile(evalCase.id, options);

    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const startedMillis = yield* Clock.currentTimeMillis;
    const processResult = yield* runner.run(command).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () =>
          Effect.fail(new PluginEvalCodexCliTimeoutError({ caseId: evalCase.id, timeoutMs })),
      }),
    );
    if (processResult.stdoutTruncated) {
      return yield* new PluginEvalCodexCliProcessError({
        caseId: evalCase.id,
        reason: "stdout-truncated",
      });
    }
    if (processResult.stderrTruncated) {
      return yield* new PluginEvalCodexCliProcessError({
        caseId: evalCase.id,
        reason: "stderr-truncated",
      });
    }
    if (processResult.exitCode !== 0) {
      return yield* new PluginEvalCodexCliProcessError({
        caseId: evalCase.id,
        reason: "nonzero-exit",
      });
    }

    const parsed = parseCodexExecJsonl(processResult.stdout, options.pluginSkillRoot);
    if (parsed.malformed_jsonl) {
      return yield* new PluginEvalCodexCliProcessError({
        caseId: evalCase.id,
        reason: "malformed-jsonl",
      });
    }
    const finishedMillis = yield* Clock.currentTimeMillis;

    return {
      version: 1,
      run_id: options.runId,
      case_id: evalCase.id,
      target: "codex_cli",
      model: options.model ?? DEFAULT_MODEL,
      ...(options.displayedModel === undefined ? {} : { displayed_model: options.displayedModel }),
      repetition: options.repetition,
      started_at: startedAt,
      status: parsed.error === undefined ? "completed" : "failed",
      duration_ms: Math.max(0, finishedMillis - startedMillis),
      activated_skills: [...parsed.activated_skills],
      tool_calls: [...parsed.tool_calls],
      available_tools: options.availableTools,
      ...(parsed.token_usage === undefined ? {} : { token_usage: parsed.token_usage }),
      ...(parsed.final_answer === undefined ? {} : { final_answer: parsed.final_answer }),
      ...(parsed.error === undefined ? {} : { error: parsed.error }),
    } satisfies PluginEvalObservation;
  }).pipe(
    Effect.withSpan("plugin_evals.codex_cli_trial", {
      attributes: {
        "plugin_eval.case_id": evalCase.id,
        "plugin_eval.repetition": options.repetition,
      },
    }),
  );
});
