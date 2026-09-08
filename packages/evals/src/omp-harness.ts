import { createHash } from "node:crypto";
import { createMCPClient, type ListToolsResult, type MCPClient } from "@ai-sdk/mcp";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import { createACP } from "@ai-sdk/harness-acp";
import { createCredentialRequestTransformation } from "@ai-sdk/harness/utils";
import type { HarnessV1SandboxProvider } from "@ai-sdk/harness";
import {
  listCatalogToolNames,
  PRODUCTION_MCP_URL,
  SKILL_NAMES,
  type SkillName,
} from "@askgina/contracts";
import type { StepResult, ToolSet } from "ai";
import {
  Clock,
  Data,
  DateTime,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Function,
  Option,
  Path,
  Redacted,
  Scope,
} from "effect";

import type { PluginEvalCase, PluginEvalObservation, PluginEvalToolCall } from "./contracts";
import { createOmpDockerSandbox } from "./omp-docker-sandbox";
import {
  decodeOmpGuardEvidence,
  makeOmpGuardExtensionSource,
  makeOmpGuardedAcpLauncherSource,
  type OmpGuardEvidence,
} from "./omp-guard";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_MCP_TOOL_PAGES = 32;
const MAX_MCP_CLOSE_WAIT_MS = 1_000;
const MAX_SESSION_DESTROY_WAIT_MS = 8_000;
const OMP_REQUIRED_VERSION = "18.1.14";
const OMP_INCOMPLETE_GENERATION_ERROR = "OMP generation did not complete with a final answer";
const OMP_POLICY_ERROR = "OMP used an action outside approved skill reads or canonical Gina reads";
const OMP_TOOL_EXECUTION_ERROR = "OMP tool execution failed";
const HOST_TOOL_MCP_SERVER_NAME = "ai-sdk-harness-tools";
const CONTAINER_OMP_PATH = "/opt/omp-eval/omp";
const CONTAINER_GUARD_PATH = "/opt/omp-eval/omp-eval-guard.mjs";
const CONTAINER_ACP_LAUNCHER_PATH = "/opt/omp-eval/omp-eval-acp.mjs";
const CONTAINER_CONFIG_PATH = "/opt/omp-eval/config.yml";
const CONTAINER_EVIDENCE_PATH = "/eval/omp-eval-evidence.json";
const CANONICAL_ALLOWED_TOOLS = listCatalogToolNames();
const UTF8_ENCODER = new TextEncoder();
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const PROVIDER_API_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;
const PROVIDER_BASE_URL = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api/v1",
} as const;
const PROVIDER_API = {
  openai: "openai-completions",
  anthropic: "anthropic-messages",
  openrouter: "openai-completions",
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
const NATIVE_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
const SKILL_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MAX_MCP_TOOL_NAME_LENGTH = 64;
const MCP_TOOL_NAME_HASH_LENGTH = 8;
const CANONICAL_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  CANONICAL_ALLOWED_TOOLS.map((name) => [name, true as const]),
);

export type OmpProvider = keyof typeof PROVIDER_API_KEY_ENV;
export type OmpReasoning = keyof typeof OMP_REASONING;

export const isOmpProvider = (value: string): value is OmpProvider =>
  Object.hasOwn(PROVIDER_API_KEY_ENV, value);

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

export interface OmpHarnessTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly runtimeDirectory: string;
  readonly provider: OmpProvider;
  readonly model: string;
  readonly reasoning: string;
  readonly apiKey: Redacted.Redacted<string>;
  readonly mcpAuthorization: Redacted.Redacted<string>;
  readonly timeoutMs: number;
  readonly serverUrl?: string;
  readonly providerBaseUrl?: string;
  readonly dockerImage?: string;
  readonly dockerNetwork?: string;
  readonly sandbox?: HarnessV1SandboxProvider;
}

interface ValidatedOmpHarnessTrialOptions {
  readonly runId: string;
  readonly repetition: number;
  readonly availableTools: readonly string[];
  readonly runtimeDirectory: string;
  readonly provider: OmpProvider;
  readonly model: string;
  readonly modelIdentity: string;
  readonly reasoning: OmpReasoning;
  readonly apiKey: string;
  readonly mcpAuthorization: string;
  readonly timeoutMs: number;
  readonly serverUrl: string;
  readonly providerBaseUrl?: string;
  readonly dockerImage?: string;
  readonly dockerNetwork?: string;
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

interface NativeSdkToolCall {
  readonly input: unknown;
  outcome?: "result" | "error";
}

interface ObservedOmpToolCalls {
  readonly toolCalls: readonly PluginEvalToolCall[];
  readonly failedNativeRead: boolean;
}

interface EvidenceSandbox {
  readonly readTextFile: (options: { readonly path: string }) => PromiseLike<string | null>;
  readonly run: (options: {
    readonly command: string;
    readonly abortSignal?: AbortSignal;
  }) => PromiseLike<{ readonly exitCode: number; readonly stdout: string }>;
}

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
  readonly reason: "could_not_start" | "preflight-failed" | "unsupported-version";
}> {}

export class PluginEvalOmpHarnessMcpError extends Data.TaggedError("PluginEvalOmpHarnessMcpError")<{
  readonly caseId: string;
  readonly reason: "connection-failed" | "catalog-failed" | "catalog-mismatch" | "cleanup-failed";
}> {}

export class PluginEvalOmpHarnessProcessError extends Data.TaggedError(
  "PluginEvalOmpHarnessProcessError",
)<{
  readonly caseId: string;
  readonly reason: "generation-failed" | "incomplete-evidence" | "inventory-mismatch";
}> {}

export class PluginEvalOmpHarnessTimeoutError extends Data.TaggedError(
  "PluginEvalOmpHarnessTimeoutError",
)<{
  readonly caseId: string;
  readonly timeoutMs: number;
}> {}

export type PluginEvalOmpHarnessError =
  | PluginEvalOmpHarnessExecutableError
  | PluginEvalOmpHarnessRequestError
  | PluginEvalOmpHarnessSpawnError
  | PluginEvalOmpHarnessMcpError
  | PluginEvalOmpHarnessProcessError
  | PluginEvalOmpHarnessTimeoutError;

const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const uniqueLeft = new Set(left);
  return uniqueLeft.size === left.length && right.every((tool) => uniqueLeft.has(tool));
};

const isWithin = (path: Path.Path, parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isNativeExecutableHeader = (bytes: readonly number[]): boolean =>
  (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) ||
  (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) ||
  (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && bytes[3] === 0xcf);

const sanitizeMcpToolNamePart = (value: string, fallback: string): string => {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : fallback;
};

const capMcpToolNameLength = (name: string): string => {
  if (name.length <= MAX_MCP_TOOL_NAME_LENGTH) return name;
  const hash = Bun.hash(name).toString(36).slice(0, MCP_TOOL_NAME_HASH_LENGTH);
  const keep = MAX_MCP_TOOL_NAME_LENGTH - hash.length - 1;
  return `${name.slice(0, keep)}_${hash}`;
};

const createOmpNativeToolName = (canonicalName: string): string => {
  const sanitizedServerName = sanitizeMcpToolNamePart(HOST_TOOL_MCP_SERVER_NAME, "server");
  const sanitizedToolName = sanitizeMcpToolNamePart(canonicalName, "tool");
  const prefixWithUnderscore = `${sanitizedServerName}_`;
  const normalizedToolName = sanitizedToolName.startsWith(prefixWithUnderscore)
    ? sanitizedToolName.slice(prefixWithUnderscore.length)
    : sanitizedToolName;
  return capMcpToolNameLength(`mcp__${sanitizedServerName}_${normalizedToolName}`);
};

const CANONICAL_TOOL_BY_NATIVE_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  CANONICAL_ALLOWED_TOOLS.map((canonicalName) => [
    createOmpNativeToolName(canonicalName),
    canonicalName,
  ]),
);

export const OMP_HARNESS_EXPECTED_NATIVE_TOOLS: readonly string[] = [
  "read",
  ...CANONICAL_ALLOWED_TOOLS.map(createOmpNativeToolName),
];
const ALLOWED_SKILL_URIS: readonly string[] = SKILL_NAMES.map((name) => `skill://${name}`);

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

const resultByteLength = (value: unknown): number | undefined => {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized === undefined ? undefined : UTF8_ENCODER.encode(serialized).byteLength;
  } catch {
    return undefined;
  }
};

const inventoryAdmitted = (evidence: OmpGuardEvidence | undefined): boolean =>
  evidence !== undefined &&
  evidence.inventoryExact === true &&
  evidence.phase !== "loaded" &&
  catalogsMatch(evidence.expectedTools, OMP_HARNESS_EXPECTED_NATIVE_TOOLS) &&
  catalogsMatch(evidence.activeTools, OMP_HARNESS_EXPECTED_NATIVE_TOOLS);

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

const destroyHarnessSessionOnce = (
  session: HarnessAgentSession,
  rawSandboxDestroy: RawSandboxDestroyRef,
): Promise<HarnessSessionDestroyOutcome> => {
  const activeDestroy = harnessSessionDestroys.get(session);
  if (activeDestroy !== undefined) return activeDestroy;
  const sessionDestroy = settleHarnessDestroy(() => session.destroy());
  const rawDestroy =
    rawSandboxDestroy.current === undefined
      ? Promise.resolve<HarnessSessionDestroyOutcome>("failed")
      : settleHarnessDestroy(rawSandboxDestroy.current);
  const outcome = Promise.all([sessionDestroy, rawDestroy]).then(
    (results): HarnessSessionDestroyOutcome =>
      results.every((result) => result === "destroyed") ? "destroyed" : "failed",
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
  error instanceof PluginEvalOmpHarnessTimeoutError;

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
  "  enablePiUser: true",
  "  enablePiProject: false",
  "  enableAgentsUser: false",
  "  enableAgentsProject: false",
  "  includeSkills:",
  ...SKILL_NAMES.map((name) => `    - ${name}`),
  "",
].join("\n");

const modelsYaml = (provider: OmpProvider, providerBaseUrl: string | undefined): string => {
  const lines = ["providers:", `  ${provider}:`, `    apiKey: ${PROVIDER_API_KEY_ENV[provider]}`];
  if (providerBaseUrl !== undefined) {
    lines.push(`    baseUrl: ${yamlQuote(providerBaseUrl)}`);
    lines.push(`    api: ${PROVIDER_API[provider]}`);
  }
  lines.push("");
  return lines.join("\n");
};

const installCommand = (provider: OmpProvider, providerBaseUrl: string | undefined): string => {
  const models = modelsYaml(provider, providerBaseUrl);
  return [
    'mkdir -p "$HOME/.local/bin" "$HOME/.omp/agent/skills"',
    `ln -sfn ${CONTAINER_ACP_LAUNCHER_PATH} "$HOME/.local/bin/omp"`,
    `cp ${CONTAINER_CONFIG_PATH} "$HOME/.omp/agent/config.yml"`,
    "cat > \"$HOME/.omp/agent/models.yml\" <<'OMP_EVAL_MODELS_YML'",
    models.trimEnd(),
    "OMP_EVAL_MODELS_YML",
    `version="$(${CONTAINER_OMP_PATH} --version)"`,
    `[ "$version" = "omp/${OMP_REQUIRED_VERSION}" ] || exit 1`,
  ].join("\n");
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
    const guardSource = yield* Effect.try({
      try: () =>
        makeOmpGuardExtensionSource({
          expectedTools: OMP_HARNESS_EXPECTED_NATIVE_TOOLS,
          allowedSkillUris: ALLOWED_SKILL_URIS,
          evidencePath: CONTAINER_EVIDENCE_PATH,
        }),
      catch: () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
    });
    const guardPath = path.join(runtimeDirectory, "omp-eval-guard.mjs");
    yield* fs
      .writeFileString(guardPath, guardSource, {
        flag: "wx",
        mode: 0o444,
      })
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* fs
      .chmod(guardPath, 0o444)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    const launcherSource = yield* Effect.try({
      try: () => makeOmpGuardedAcpLauncherSource(OMP_HARNESS_EXPECTED_NATIVE_TOOLS),
      catch: () => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" }),
    });
    const launcherPath = path.join(runtimeDirectory, "omp-eval-acp.mjs");
    yield* fs
      .writeFileString(launcherPath, launcherSource, {
        flag: "wx",
        mode: 0o555,
      })
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    yield* fs
      .chmod(launcherPath, 0o555)
      .pipe(
        Effect.mapError(() => new PluginEvalOmpHarnessExecutableError({ reason: "invalid-file" })),
      );
    return { runtimeDirectory };
  });

const validateOptions = (
  evalCase: PluginEvalCase,
  options: OmpHarnessTrialOptions,
): Effect.Effect<ValidatedOmpHarnessTrialOptions, PluginEvalOmpHarnessRequestError> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiKey = Redacted.value(options.apiKey);
  const mcpAuthorization = Redacted.value(options.mcpAuthorization);
  const model = options.model.trim();
  const runId = options.runId.trim();
  const providerBaseUrl =
    options.providerBaseUrl === undefined
      ? undefined
      : parseProviderBaseUrl(options.providerBaseUrl);
  const modelIdentity = `${options.provider}/${model}`;
  const serverUrl = options.serverUrl ?? PRODUCTION_MCP_URL;
  if (options.providerBaseUrl !== undefined && providerBaseUrl === undefined) {
    return Effect.fail(
      new PluginEvalOmpHarnessRequestError({ caseId: evalCase.id, reason: "invalid-endpoint" }),
    );
  }
  if (
    !isOmpProvider(options.provider) ||
    !catalogsMatch(options.availableTools, CANONICAL_ALLOWED_TOOLS) ||
    runId.length === 0 ||
    model.length === 0 ||
    apiKey.trim().length === 0 ||
    mcpAuthorization.trim().length === 0 ||
    !options.runtimeDirectory.startsWith("/") ||
    !Number.isSafeInteger(options.repetition) ||
    options.repetition <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    (options.serverUrl !== undefined && options.serverUrl.trim().length === 0)
  ) {
    return Effect.fail(
      new PluginEvalOmpHarnessRequestError({ caseId: evalCase.id, reason: "invalid-options" }),
    );
  }
  if (!isOmpReasoning(options.reasoning)) {
    return Effect.fail(
      new PluginEvalOmpHarnessRequestError({
        caseId: evalCase.id,
        reason: "unsupported-reasoning",
      }),
    );
  }
  return Effect.succeed({
    runId,
    repetition: options.repetition,
    availableTools: [...CANONICAL_ALLOWED_TOOLS],
    runtimeDirectory: options.runtimeDirectory,
    provider: options.provider,
    model,
    modelIdentity,
    reasoning: options.reasoning,
    apiKey,
    mcpAuthorization,
    timeoutMs,
    serverUrl,
    ...(providerBaseUrl === undefined ? {} : { providerBaseUrl }),
    ...(options.dockerImage === undefined ? {} : { dockerImage: options.dockerImage }),
    ...(options.dockerNetwork === undefined ? {} : { dockerNetwork: options.dockerNetwork }),
    ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
  });
};

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
      Effect.sleep(Duration.millis(MAX_SESSION_DESTROY_WAIT_MS)),
    ).pipe(Effect.asVoid);
  }
  return Effect.gen(function* () {
    const beforeDestroy = yield* Clock.currentTimeMillis;
    if (beforeDestroy >= deadlineMillis) {
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

const decodeEvidenceText = (
  evidenceText: string | null | undefined,
): OmpGuardEvidence | undefined => {
  if (evidenceText === null || evidenceText === undefined) return undefined;
  try {
    return decodeOmpGuardEvidence(JSON.parse(evidenceText) as unknown);
  } catch {
    return undefined;
  }
};

const executeCanonicalHostTool = (
  run: () => PromiseLike<unknown>,
  validator: ValidateFunction,
  input: unknown,
  executeOptions: { readonly toolCallId: string; readonly abortSignal?: AbortSignal },
  canonicalName: string,
  captures: CapturedHostToolCall[],
  trustedSession: { current: EvidenceSandbox | undefined },
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
      const sandbox = trustedSession.current;
      if (sandbox === undefined) {
        pushCapture({ error: { message: "OMP harness inventory was not admitted" } });
        return { isError: true };
      }
      const evidenceText = yield* Effect.promise(() =>
        Promise.resolve(sandbox.readTextFile({ path: CONTAINER_EVIDENCE_PATH })).then(
          (text) => text,
          () => null,
        ),
      );
      const evidence = decodeEvidenceText(evidenceText);
      if (!inventoryAdmitted(evidence)) {
        pushCapture({ error: { message: "OMP harness inventory was not admitted" } });
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

const preflightOmpHarnessSession = (
  session: EvidenceSandbox,
  trustedSession: { current: EvidenceSandbox | undefined },
  caseId: string,
  abortSignal: AbortSignal | undefined,
): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      trustedSession.current = session;
      const version = yield* Effect.tryPromise({
        try: (signal) =>
          session.run({
            command: `${CONTAINER_OMP_PATH} --version`,
            abortSignal: abortSignal ?? signal,
          }),
        catch: () =>
          new PluginEvalOmpHarnessSpawnError({
            caseId,
            reason: "preflight-failed",
          }),
      });
      if (version.exitCode !== 0) {
        return yield* new PluginEvalOmpHarnessSpawnError({
          caseId,
          reason: "preflight-failed",
        });
      }
      if (version.stdout.trim() !== `omp/${OMP_REQUIRED_VERSION}`) {
        return yield* new PluginEvalOmpHarnessSpawnError({
          caseId,
          reason: "unsupported-version",
        });
      }
    }),
    abortSignal === undefined ? undefined : { signal: abortSignal },
  );

const wrapHostTools = (
  tools: ToolSet,
  definitions: ListToolsResult,
  discoveredTools: readonly string[],
  captures: CapturedHostToolCall[],
  trustedSession: { current: EvidenceSandbox | undefined },
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
      if (
        tool === undefined ||
        execute === undefined ||
        definition === undefined ||
        !NATIVE_TOOL_NAME.test(canonicalName.replaceAll(".", "_"))
      ) {
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
            trustedSession,
          ),
      };
    }
    return hostTools;
  });

const observedToolCalls = (
  steps: readonly StepResult<ToolSet>[],
  captures: readonly CapturedHostToolCall[],
  nativeCalls: OmpGuardEvidence["nativeCalls"],
): ObservedOmpToolCalls | undefined => {
  const capturesById = new Map(captures.map((capture) => [capture.toolCallId, capture] as const));
  if (capturesById.size !== captures.length) return undefined;

  const hostCallsByName = new Map<string, PluginEvalToolCall[]>();
  const seenHostCallIds = new Set<string>();
  for (const step of steps) {
    for (const toolCall of step.toolCalls) {
      if (CANONICAL_TOOL_NAMES[toolCall.toolName] !== true) continue;
      if (toolCall.providerExecuted !== false || seenHostCallIds.has(toolCall.toolCallId)) {
        return undefined;
      }
      seenHostCallIds.add(toolCall.toolCallId);
      const captured = capturesById.get(toolCall.toolCallId);
      const argumentsValue = jsonObject(toolCall.input) ?? captured?.arguments ?? {};
      let observed: PluginEvalToolCall;
      if (toolCall.invalid === true && captured === undefined) {
        observed = {
          sequence: 0,
          name: toolCall.toolName,
          arguments: argumentsValue,
          error: { code: "invalid_arguments", message: "Invalid tool arguments" },
        };
      } else {
        if (captured === undefined || captured.name !== toolCall.toolName) return undefined;
        observed = {
          sequence: 0,
          name: captured.name,
          arguments: captured.arguments,
          ...(captured.durationMs === undefined ? {} : { duration_ms: captured.durationMs }),
          ...(captured.resultBytes === undefined ? {} : { result_bytes: captured.resultBytes }),
          ...(captured.error === undefined ? {} : { error: captured.error }),
        };
      }
      const namedCalls = hostCallsByName.get(observed.name);
      if (namedCalls === undefined) hostCallsByName.set(observed.name, [observed]);
      else namedCalls.push(observed);
    }
  }
  for (const capture of captures) {
    if (!seenHostCallIds.has(capture.toolCallId)) return undefined;
  }

  const nativeCallById = new Map(nativeCalls.map((call) => [call.id, call] as const));
  if (nativeCallById.size !== nativeCalls.length) return undefined;
  const sdkNativeCalls = new Map<string, NativeSdkToolCall>();
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === "tool-call") {
        if (CANONICAL_TOOL_NAMES[part.toolName] === true) continue;
        if (
          part.providerExecuted !== true ||
          !nativeCallById.has(part.toolCallId) ||
          sdkNativeCalls.has(part.toolCallId)
        ) {
          return undefined;
        }
        sdkNativeCalls.set(part.toolCallId, { input: part.input });
        continue;
      }
      if (part.type !== "tool-result" && part.type !== "tool-error") continue;
      if (CANONICAL_TOOL_NAMES[part.toolName] === true) continue;
      const sdkCall = sdkNativeCalls.get(part.toolCallId);
      if (
        !nativeCallById.has(part.toolCallId) ||
        sdkCall === undefined ||
        sdkCall.outcome !== undefined
      ) {
        return undefined;
      }
      sdkCall.outcome = part.type === "tool-error" ? "error" : "result";
    }
  }

  const toolCalls: PluginEvalToolCall[] = [];
  let failedNativeRead = false;
  for (const nativeCall of nativeCalls) {
    const sdkCall = sdkNativeCalls.get(nativeCall.id);
    if (nativeCall.name === "read") {
      if (sdkCall?.outcome === undefined) return undefined;
      if (sdkCall.outcome === "error") failedNativeRead = true;
      continue;
    }

    const canonicalName = Object.hasOwn(CANONICAL_TOOL_BY_NATIVE_NAME, nativeCall.name)
      ? CANONICAL_TOOL_BY_NATIVE_NAME[nativeCall.name]
      : undefined;
    if (canonicalName === undefined) {
      if (sdkCall?.outcome !== "error") return undefined;
      continue;
    }
    if (sdkCall !== undefined) {
      if (sdkCall.outcome !== "error") return undefined;
      const argumentsValue = jsonObject(sdkCall.input);
      if (argumentsValue === undefined) return undefined;
      toolCalls.push({
        sequence: toolCalls.length,
        name: canonicalName,
        arguments: argumentsValue,
        error: { message: "MCP tool call failed" },
      });
      continue;
    }

    const hostCalls = hostCallsByName.get(canonicalName);
    const hostCall = hostCalls?.shift();
    if (hostCall === undefined) return undefined;
    toolCalls.push({ ...hostCall, sequence: toolCalls.length });
  }
  for (const hostCalls of hostCallsByName.values()) {
    if (hostCalls.length > 0) return undefined;
  }
  return { toolCalls, failedNativeRead };
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

      return yield* Effect.gen(function* () {
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
                  if (!catalogsMatch(discoveredTools, validated.availableTools)) {
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
                  const trustedSession: { current: EvidenceSandbox | undefined } = {
                    current: undefined,
                  };
                  const hostTools = yield* wrapHostTools(
                    tools,
                    definitions,
                    discoveredTools,
                    captures,
                    trustedSession,
                    evalCase.id,
                  );
                  yield* ensureBeforeDeadline(evalCase.id, validated.timeoutMs, deadlineMillis);
                  const apiKeyEnv = PROVIDER_API_KEY_ENV[validated.provider];
                  const selectedSandbox =
                    validated.sandbox ??
                    createOmpDockerSandbox({
                      runtimeDirectory: validated.runtimeDirectory,
                      ...(validated.dockerImage === undefined
                        ? {}
                        : { image: validated.dockerImage }),
                      ...(validated.dockerNetwork === undefined
                        ? {}
                        : { network: validated.dockerNetwork }),
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
                          rawSandboxDestroy.current = () => session.destroy();
                          return session;
                        },
                      ),
                  };
                  const harness = createACP({
                    harnessId: "omp-acp",
                    source: {
                      type: "install-command",
                      command: installCommand(validated.provider, validated.providerBaseUrl),
                    },
                    executable: "omp",
                    args: [
                      "acp",
                      "--trusted-extension",
                      CONTAINER_GUARD_PATH,
                      "--no-extensions",
                      "--provider",
                      validated.provider,
                      "--model",
                      validated.model,
                      "--thinking",
                      validated.reasoning,
                      "--approval-mode",
                      "yolo",
                      "--no-session",
                    ],
                    skillsDirectory: ".omp/agent/skills",
                    modelMapping: { type: "session-config-option", path: "model" },
                    mcpServers: {},
                    credentialEnv: [apiKeyEnv],
                    credentialBrokering: ({ env, sandboxEnv }) => {
                      const key = env[apiKeyEnv];
                      const placeholder = sandboxEnv?.[apiKeyEnv];
                      if (key === undefined || placeholder === undefined) {
                        throw new Error("OMP provider credentials unavailable");
                      }
                      const matchUrl =
                        validated.providerBaseUrl ?? PROVIDER_BASE_URL[validated.provider];
                      const officialAnthropic =
                        validated.provider === "anthropic" &&
                        new URL(matchUrl).origin === PROVIDER_BASE_URL.anthropic;
                      const header = officialAnthropic ? "x-api-key" : "authorization";
                      const prefix = officialAnthropic ? "" : "Bearer ";
                      return [
                        createCredentialRequestTransformation({
                          matchUrl,
                          matchHeaders: { [header]: `${prefix}${placeholder}` },
                          transformHeaders: { [header]: `${prefix}${key}` },
                        }),
                      ];
                    },
                    auth: { [apiKeyEnv]: validated.apiKey },
                    env: { NO_COLOR: "1" },
                  });
                  const agent = new HarnessAgent({
                    harness,
                    sandbox,
                    tools: hostTools,
                    skills,
                    permissionMode: "allow-all",
                    sandboxConfig: {
                      onSession: ({ session, abortSignal }) =>
                        preflightOmpHarnessSession(
                          session,
                          trustedSession,
                          evalCase.id,
                          abortSignal,
                        ),
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
                              const generatedText = yield* Effect.tryPromise({
                                try: (signal) =>
                                  agent.generate({
                                    session,
                                    prompt: promptText(evalCase),
                                    abortSignal: signal,
                                  }),
                                catch: (error) =>
                                  isKnownHarnessError(error)
                                    ? error
                                    : new PluginEvalOmpHarnessProcessError({
                                        caseId: evalCase.id,
                                        reason: "generation-failed",
                                      }),
                              });
                              yield* ensureBeforeDeadline(
                                evalCase.id,
                                validated.timeoutMs,
                                deadlineMillis,
                              );
                              const evidenceSandbox = trustedSession.current;
                              if (evidenceSandbox === undefined) {
                                return yield* new PluginEvalOmpHarnessProcessError({
                                  caseId: evalCase.id,
                                  reason: "incomplete-evidence",
                                });
                              }
                              const evidenceText = yield* Effect.promise(() =>
                                Promise.resolve(
                                  evidenceSandbox.readTextFile({
                                    path: CONTAINER_EVIDENCE_PATH,
                                  }),
                                ).then(
                                  (text) => text,
                                  () => null,
                                ),
                              );
                              const evidence = decodeEvidenceText(evidenceText);
                              if (evidence === undefined) {
                                return yield* new PluginEvalOmpHarnessProcessError({
                                  caseId: evalCase.id,
                                  reason: "incomplete-evidence",
                                });
                              }
                              return { generatedText, evidence, captures };
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
        const { generatedText, evidence, captures } = trialResult;
        if (evidence.phase !== "terminal" || evidence.terminal === undefined) {
          return yield* new PluginEvalOmpHarnessProcessError({
            caseId: evalCase.id,
            reason: "incomplete-evidence",
          });
        }
        if (!inventoryAdmitted(evidence)) {
          return yield* new PluginEvalOmpHarnessProcessError({
            caseId: evalCase.id,
            reason: "inventory-mismatch",
          });
        }
        const observed = observedToolCalls(generatedText.steps, captures, evidence.nativeCalls);
        if (observed === undefined) {
          return yield* new PluginEvalOmpHarnessProcessError({
            caseId: evalCase.id,
            reason: "incomplete-evidence",
          });
        }
        const { toolCalls, failedNativeRead } = observed;
        const terminal = evidence.terminal;
        const tokenUsage =
          terminal.usage === undefined
            ? undefined
            : {
                input_tokens: terminal.usage.inputTokens,
                output_tokens: terminal.usage.outputTokens,
                total_tokens: terminal.usage.totalTokens,
              };
        const incompleteStop =
          terminal.stopReason === "length" ||
          terminal.stopReason === "toolUse" ||
          terminal.stopReason === "error" ||
          terminal.stopReason === "aborted" ||
          terminal.isError;
        const blocked = evidence.blockedActions > 0;
        const failedTool = toolCalls.some((call) => call.error !== undefined);
        const completed =
          terminal.stopReason === "stop" &&
          !incompleteStop &&
          !blocked &&
          !failedTool &&
          !failedNativeRead;
        const finishedMillis = yield* Clock.currentTimeMillis;
        if (finishedMillis >= deadlineMillis) {
          return yield* timeoutError(evalCase.id, validated.timeoutMs);
        }
        const error = completed
          ? undefined
          : blocked
            ? OMP_POLICY_ERROR
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
          activated_skills: [...evidence.activatedSkills],
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
    }).pipe(
      Effect.withSpan("plugin_evals.omp_harness_trial", {
        attributes: {
          "plugin_eval.case_id": evalCase.id,
          "plugin_eval.repetition": options.repetition,
        },
      }),
    ),
);
