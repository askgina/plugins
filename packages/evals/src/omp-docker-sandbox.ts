import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { Duplex, PassThrough } from "node:stream";

import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1PortEndpoint,
  HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import { HarnessSandboxAuthenticationError } from "@ai-sdk/harness";
import { Data, Duration, Effect, Schema } from "effect";

const Dockerode: typeof import("dockerode") = createRequire(import.meta.url)("dockerode");

export const DEFAULT_OMP_DOCKER_IMAGE =
  "node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d";
export const DEFAULT_OMP_SANDBOX_PORT = 4000;
export const OMP_RUNTIME_MOUNT_PATH = "/opt/omp-eval";
export const OMP_SANDBOX_WORKDIR = "/eval";
export const OMP_SANDBOX_PROVIDER_ID = "omp-docker";
export const OMP_SANDBOX_PNPM_VERSION = "10.28.2";

export class OmpDockerSandboxError extends Data.TaggedError("OmpDockerSandboxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type OmpDockerFailure = OmpDockerSandboxError | HarnessSandboxAuthenticationError;

const HELPER_PATH = `${OMP_SANDBOX_WORKDIR}/.omp-sandbox/helper.mjs`;
const PNPM_BIN = `${OMP_SANDBOX_WORKDIR}/.local/bin/pnpm`;
const BRIDGE_PORT_KEY = `${DEFAULT_OMP_SANDBOX_PORT}/tcp`;
const MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const NANO_CPUS = 2_000_000_000;
const PIDS_LIMIT = 512;
const EVAL_TMPFS_BYTES = 1_073_741_824;
const TMP_TMPFS_BYTES = 268_435_456;
const HOME_TMPFS_BYTES = 16_777_216;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const CLEANUP_WAIT_MS = 8_000;
const CLEANUP_REQUEST_MS = 3_000;
const EXEC_EXIT_POLL_MS = 20;
const MAX_SPAWN_ACK_BYTES = 256;
const DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const SPAWN_READY_LINE = "OMP_SPAWN_READY";
const LABEL_MANAGED = "askgina.evals.omp-sandbox";
const TEXT_ENCODINGS = new Set(["utf-8", "utf8", "latin1", "utf16le"]);

const CONTAINER_PATH = `${OMP_SANDBOX_WORKDIR}/.local/bin:${OMP_RUNTIME_MOUNT_PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const CONTAINER_ENV = [
  `HOME=${OMP_SANDBOX_WORKDIR}`,
  "TMPDIR=/tmp",
  `PATH=${CONTAINER_PATH}`,
  `NPM_CONFIG_CACHE=${OMP_SANDBOX_WORKDIR}/.npm`,
  `NPM_CONFIG_PREFIX=${OMP_SANDBOX_WORKDIR}/.local`,
  "NPM_CONFIG_UPDATE_NOTIFIER=false",
  "NPM_CONFIG_FUND=false",
  `PNPM_HOME=${OMP_SANDBOX_WORKDIR}/.local/share/pnpm`,
  `XDG_CACHE_HOME=${OMP_SANDBOX_WORKDIR}/.cache`,
  `XDG_CONFIG_HOME=${OMP_SANDBOX_WORKDIR}/.config`,
  `XDG_DATA_HOME=${OMP_SANDBOX_WORKDIR}/.local/share`,
  `XDG_STATE_HOME=${OMP_SANDBOX_WORKDIR}/.local/state`,
] as const;

const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const encodeUnknownJson = Schema.encodeEffect(UnknownJsonString);
const decodeUnknownJson = Schema.decodeEffect(UnknownJsonString);
const HelperReadSchema = Schema.Struct({
  ok: Schema.Boolean,
  exists: Schema.optional(Schema.Boolean),
  contentBase64: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
const HelperWriteSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
const HelperReadJson = Schema.fromJsonString(HelperReadSchema);
const HelperWriteJson = Schema.fromJsonString(HelperWriteSchema);
const decodeHelperRead = Schema.decodeEffect(HelperReadJson);
const decodeHelperWrite = Schema.decodeEffect(HelperWriteJson);

const HELPER_SOURCE = [
  "import { spawn } from 'node:child_process';",
  "import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';",
  "import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';",
  "import { dirname, isAbsolute, join, normalize } from 'node:path';",
  "import { stdin } from 'node:process';",
  "",
  "const WORK = '/eval';",
  "const PROC_DIR = '/eval/.omp-procs';",
  "const MAX_FILE_BYTES = 33554432;",
  "const TOKEN = /^[a-f0-9-]{8,64}$/;",
  "",
  "const mode = process.argv[2] ?? 'rpc';",
  "",
  "const fail = () => {",
  "  process.stdout.write(JSON.stringify({ ok: false }));",
  "  process.exit(1);",
  "};",
  "",
  "const readStdin = async () => {",
  "  const chunks = [];",
  "  for await (const chunk of stdin) chunks.push(chunk);",
  "  return Buffer.concat(chunks);",
  "};",
  "",
  "const readJsonLine = async () => {",
  "  let buffer = '';",
  "  for await (const chunk of stdin) {",
  "    buffer += chunk.toString('utf8');",
  "    const index = buffer.indexOf('\\n');",
  "    if (index !== -1) {",
  "      stdin.pause();",
  "      return JSON.parse(buffer.slice(0, index));",
  "    }",
  "  }",
  "  return JSON.parse(buffer);",
  "};",
  "",
  "const resolvePath = (value) => {",
  "  if (typeof value !== 'string' || value.length === 0 || value.includes('\\0')) {",
  "    throw new Error('path is invalid');",
  "  }",
  "  const resolved = normalize(isAbsolute(value) ? value : join(WORK, value));",
  "  if (resolved !== '/' && resolved.endsWith('/')) return resolved.slice(0, -1);",
  "  return resolved;",
  "};",
  "",
  "const envRecord = (value) => {",
  "  const env = { ...process.env };",
  "  if (value == null || typeof value !== 'object' || Array.isArray(value)) return env;",
  "  for (const [key, entry] of Object.entries(value)) {",
  "    if (typeof key !== 'string' || key.length === 0 || key.includes('=') || key.includes('\\0')) continue;",
  "    if (typeof entry === 'string') env[key] = entry;",
  "  }",
  "  return env;",
  "};",
  "",
  "const killPid = (pid) => {",
  "  for (const target of [-pid, pid]) {",
  "    try {",
  "      process.kill(target, 'SIGKILL');",
  "    } catch (error) {",
  "      if (!error || error.code !== 'ESRCH') throw error;",
  "    }",
  "  }",
  "};",
  "",
  "const removeToken = (token) => {",
  "  try {",
  "    unlinkSync(`${PROC_DIR}/${token}`);",
  "  } catch (error) {",
  "    if (!error || error.code !== 'ENOENT') throw error;",
  "  }",
  "};",
  "",
  "const runRpc = async () => {",
  "  const request = JSON.parse((await readStdin()).toString('utf8') || '{}');",
  "  if (request.op === 'read') {",
  "    const path = resolvePath(request.path);",
  "    try {",
  "      const info = await stat(path);",
  "      if (!info.isFile()) throw new Error('not a file');",
  "      if (info.size > MAX_FILE_BYTES) throw new Error('file exceeds byte limit');",
  "      const content = await readFile(path);",
  "      process.stdout.write(JSON.stringify({",
  "        ok: true,",
  "        exists: true,",
  "        contentBase64: content.toString('base64'),",
  "      }));",
  "      return;",
  "    } catch (error) {",
  "      if (error && error.code === 'ENOENT') {",
  "        process.stdout.write(JSON.stringify({ ok: true, exists: false }));",
  "        return;",
  "      }",
  "      throw error;",
  "    }",
  "  }",
  "  if (request.op === 'write') {",
  "    const path = resolvePath(request.path);",
  "    if (typeof request.contentBase64 !== 'string') throw new Error('content is invalid');",
  "    const content = Buffer.from(request.contentBase64, 'base64');",
  "    if (content.byteLength > MAX_FILE_BYTES) throw new Error('file exceeds byte limit');",
  "    await mkdir(dirname(path), { recursive: true });",
  "    await writeFile(path, content);",
  "    process.stdout.write(JSON.stringify({ ok: true }));",
  "    return;",
  "  }",
  "  throw new Error('unknown helper operation');",
  "};",
  "",
  "const runSpawn = async () => {",
  "  const request = await readJsonLine();",
  "  if (typeof request.command !== 'string' || request.command.length === 0) {",
  "    throw new Error('command is invalid');",
  "  }",
  "  if (typeof request.token !== 'string' || !TOKEN.test(request.token)) {",
  "    throw new Error('token is invalid');",
  "  }",
  "  const cwd = request.cwd == null ? WORK : resolvePath(request.cwd);",
  "  mkdirSync(PROC_DIR, { recursive: true, mode: 0o700 });",
  "  const cancelled = `${PROC_DIR}/${request.token}.cancelled`;",
  "  if (existsSync(cancelled)) { process.exitCode = 1; return; }",
  "  const child = spawn('/bin/sh', ['-c', request.command], {",
  "    cwd,",
  "    env: envRecord(request.env),",
  "    stdio: ['ignore', 'pipe', 'pipe'],",
  "    detached: true,",
  "  });",
  "  if (child.pid == null) throw new Error('process did not start');",
  "  writeFileSync(`${PROC_DIR}/${request.token}`, String(child.pid), { encoding: 'utf8', mode: 0o600 });",
  "  if (existsSync(cancelled)) killPid(child.pid);",
  `  process.stdout.write('${SPAWN_READY_LINE}\\n');`,
  "  const shutdown = () => {",
  "    killPid(child.pid);",
  "  };",
  "  process.on('SIGHUP', shutdown);",
  "  process.on('SIGTERM', shutdown);",
  "  process.on('SIGINT', shutdown);",
  "  child.stdout.pipe(process.stdout);",
  "  child.stderr.pipe(process.stderr);",
  "  child.once('close', (code) => {",
  "    try {",
  "      removeToken(request.token);",
  "      process.exitCode = code ?? 1;",
  "    } catch {",
  "      process.exitCode = 1;",
  "    }",
  "  });",
  "};",
  "",
  "const runKill = async () => {",
  "  const request = JSON.parse((await readStdin()).toString('utf8') || '{}');",
  "  if (typeof request.token !== 'string' || !TOKEN.test(request.token)) {",
  "    throw new Error('token is invalid');",
  "  }",
  "  mkdirSync(PROC_DIR, { recursive: true, mode: 0o700 });",
  "  writeFileSync(`${PROC_DIR}/${request.token}.cancelled`, '', { mode: 0o600 });",
  "  let pid = 0;",
  "  try {",
  "    pid = Number.parseInt(readFileSync(`${PROC_DIR}/${request.token}`, 'utf8'), 10);",
  "  } catch (error) {",
  "    if (error && error.code === 'ENOENT') {",
  "      process.stdout.write(JSON.stringify({ ok: true }));",
  "      return;",
  "    }",
  "    throw error;",
  "  }",
  "  if (!Number.isInteger(pid) || pid <= 1) throw new Error('stored process is invalid');",
  "  killPid(pid);",
  "  removeToken(request.token);",
  "  process.stdout.write(JSON.stringify({ ok: true }));",
  "};",
  "",
  "const main = async () => {",
  "  if (mode === 'spawn') return runSpawn();",
  "  if (mode === 'kill') return runKill();",
  "  return runRpc();",
  "};",
  "",
  "main().catch(fail);",
].join("\n");

export interface OmpDockerSandboxOptions {
  readonly runtimeDirectory: string;
  readonly image?: string;
  readonly network?: string;
}

type SandboxSession = ReturnType<HarnessV1NetworkSandboxSession["restricted"]>;
type DockerClient = InstanceType<typeof Dockerode>;
type DockerContainer = import("dockerode").Container;
type DockerExec = import("dockerode").Exec;
type DockerNetwork = import("dockerode").Network;

interface SpawnHandle {
  readonly token: string;
  readonly exec: DockerExec;
  readonly stream: Duplex;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  killed: boolean;
  abortError?: OmpDockerSandboxError;
  abortTeardown?: () => void;
}

interface StartedExec {
  readonly exec: DockerExec;
  readonly stream: Duplex;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
}

interface ValidatedSandboxOptions {
  readonly runtimeDirectory: string;
  readonly image: string;
  readonly callerNetwork: string | undefined;
}

const ignoreError = (_error: unknown): void => undefined;

const sandboxError = (message: string, cause?: unknown): OmpDockerSandboxError =>
  new OmpDockerSandboxError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const abortError = (signal: AbortSignal): OmpDockerSandboxError =>
  sandboxError("OMP sandbox was aborted.", signal.reason);

const dockerCause = (error: unknown): unknown =>
  error instanceof OmpDockerSandboxError && error.cause !== undefined ? error.cause : error;

const dockerStatus = (error: unknown): number | undefined => {
  const candidate = dockerCause(error);
  if (typeof candidate !== "object" || candidate === null) return undefined;
  if ("statusCode" in candidate && typeof candidate.statusCode === "number")
    return candidate.statusCode;
  if ("status" in candidate && typeof candidate.status === "number") return candidate.status;
  return undefined;
};

const isIgnorableDockerError = (error: unknown): boolean => {
  const status = dockerStatus(error);
  if (status === 304 || status === 404) return true;
  const candidate = dockerCause(error);
  const message = candidate instanceof Error ? candidate.message : String(candidate);
  return /no such (container|network|exec)|is not running|already (stopped|paused)|not found/iu.test(
    message,
  );
};

const isDockerAuthError = (error: unknown): boolean => {
  const status = dockerStatus(error);
  return status === 401 || status === 403;
};

const requireAbsolutePath = (value: string, field: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    /\s/u.test(value)
  ) {
    throw sandboxError(`OMP Docker ${field} is invalid.`);
  }
  if (value.startsWith("/") === false) {
    throw sandboxError(`OMP Docker ${field} must be an absolute path.`);
  }
  return value;
};

const resolveImage = (image: string | undefined): string => {
  if (image === undefined || image.length === 0) return DEFAULT_OMP_DOCKER_IMAGE;
  if (image.length > 256 || /[\s\0]/u.test(image)) {
    throw sandboxError("OMP Docker image override is invalid.");
  }
  if (image.includes("@") && /@sha256:[a-fA-F0-9]{64}$/u.test(image) === false) {
    throw sandboxError("OMP Docker image override must be digest-pinned.");
  }
  return image;
};

const requireNetworkName = (network: string): string => {
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(network) === false) {
    throw sandboxError("OMP Docker network option is invalid.");
  }
  return network;
};

const encodeText = (
  content: string,
  encoding: string | undefined,
): Effect.Effect<Uint8Array, OmpDockerSandboxError> => {
  const label = encoding ?? "utf-8";
  if (TEXT_ENCODINGS.has(label) === false) {
    return Effect.fail(sandboxError(`OMP sandbox text encoding is unsupported: ${label}`));
  }
  return Effect.succeed(
    Buffer.from(content, label === "utf-8" ? "utf8" : (label as BufferEncoding)),
  );
};

const decodeText = (
  bytes: Uint8Array,
  encoding: string | undefined,
): Effect.Effect<string, OmpDockerSandboxError> => {
  const label = encoding ?? "utf-8";
  if (TEXT_ENCODINGS.has(label) === false) {
    return Effect.fail(sandboxError(`OMP sandbox text encoding is unsupported: ${label}`));
  }
  return Effect.succeed(
    Buffer.from(bytes).toString(label === "utf-8" ? "utf8" : (label as BufferEncoding)),
  );
};

const sliceTextLines = (text: string, startLine?: number, endLine?: number): string => {
  const lines = text.split("\n");
  const start = Math.max(1, startLine ?? 1);
  const end = Math.max(start - 1, endLine ?? lines.length);
  return lines.slice(start - 1, end).join("\n");
};

const toWebStream = (stream: PassThrough): ReadableStream<Uint8Array> =>
  Duplex.toWeb(stream).readable as ReadableStream<Uint8Array>;

const abortEffect = (signal: AbortSignal): Effect.Effect<never, OmpDockerSandboxError> =>
  Effect.callback<never, OmpDockerSandboxError>((resume) => {
    const fail = () => {
      resume(Effect.fail(abortError(signal)));
    };
    if (signal.aborted === true) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
    return Effect.sync(() => {
      signal.removeEventListener("abort", fail);
    });
  });

const withAbort = <A, E>(
  effect: Effect.Effect<A, E>,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E | OmpDockerSandboxError> =>
  signal === undefined ? effect : Effect.raceFirst(effect, abortEffect(signal));

const runBoundary = <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> =>
  Effect.runPromise(withAbort(effect, signal));

const fromDocker = <A>(
  start: (signal: AbortSignal) => Promise<A>,
  onLate: (value: A) => void = ignoreError,
): Effect.Effect<A, OmpDockerSandboxError> =>
  Effect.callback<A, OmpDockerSandboxError>((resume, signal) => {
    let settled = false;
    const work = start(signal);
    const settleFail = (error: unknown) => {
      if (settled === true) return;
      settled = true;
      resume(Effect.fail(sandboxError("OMP Docker operation failed.", error)));
    };
    const settleOk = (value: A) => {
      if (settled === true || signal.aborted === true) {
        onLate(value);
        return;
      }
      settled = true;
      resume(Effect.succeed(value));
    };
    void work.then(settleOk, settleFail);
    if (signal.aborted === true) {
      settled = true;
      resume(Effect.fail(abortError(signal)));
    }
  });

const collectPassThrough = (
  stream: PassThrough,
  maxBytes: number,
): Effect.Effect<Buffer, OmpDockerSandboxError> =>
  Effect.callback<Buffer, OmpDockerSandboxError>((resume) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (next: Effect.Effect<Buffer, OmpDockerSandboxError>) => {
      if (settled === true) return;
      settled = true;
      resume(next);
    };
    const onData = (chunk: Buffer) => {
      if (settled === true) return;
      if (size + chunk.byteLength > maxBytes) {
        finish(Effect.fail(sandboxError("OMP sandbox stream exceeded byte limit.")));
        return;
      }
      chunks.push(Buffer.from(chunk));
      size += chunk.byteLength;
    };
    const onError = () => {
      finish(Effect.fail(sandboxError("OMP sandbox stream failed.")));
    };
    const onEnd = () => {
      finish(Effect.succeed(Buffer.concat(chunks, size)));
    };
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
    return Effect.sync(() => {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    });
  });

const waitForSpawnReady = (stream: PassThrough): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.callback<void, OmpDockerSandboxError>((resume) => {
    let buffer: Buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (next: Effect.Effect<void, OmpDockerSandboxError>) => {
      if (settled === true) return;
      settled = true;
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
      resume(next);
    };
    const onData = (chunk: Buffer) => {
      if (settled === true) return;
      buffer = buffer.byteLength === 0 ? chunk : Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline === -1) {
        if (buffer.byteLength > MAX_SPAWN_ACK_BYTES) {
          finish(Effect.fail(sandboxError("OMP sandbox process did not start.")));
        }
        return;
      }
      const line = buffer.subarray(0, newline).toString("utf8");
      const rest = buffer.subarray(newline + 1);
      if (newline > MAX_SPAWN_ACK_BYTES || line !== SPAWN_READY_LINE) {
        finish(Effect.fail(sandboxError("OMP sandbox process did not start.")));
        return;
      }
      settled = true;
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
      stream.pause();
      if (rest.byteLength > 0) stream.unshift(rest);
      resume(Effect.void);
    };
    const onError = () => {
      finish(Effect.fail(sandboxError("OMP sandbox process did not start.")));
    };
    const onEnd = () => {
      finish(Effect.fail(sandboxError("OMP sandbox process did not start.")));
    };
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
    return Effect.sync(() => {
      if (settled === true) return;
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    });
  });

const readStreamBytes = (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Effect.Effect<Uint8Array, OmpDockerSandboxError> =>
  Effect.callback<Uint8Array, OmpDockerSandboxError>((resume) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const pump = (): void => {
      void reader.read().then(
        (result) => {
          if (result.done === true) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            resume(Effect.succeed(bytes));
            return;
          }
          const value = result.value;
          if (value === undefined) {
            pump();
            return;
          }
          if (size + value.byteLength > maxBytes) {
            resume(Effect.fail(sandboxError("OMP sandbox write exceeds byte limit.")));
            return;
          }
          chunks.push(value);
          size += value.byteLength;
          pump();
        },
        (error) => {
          resume(Effect.fail(sandboxError("OMP sandbox read failed.", error)));
        },
      );
    };
    pump();
    return Effect.sync(() => {
      void reader.cancel();
    });
  });

const collectUtf8 = (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Effect.Effect<string, OmpDockerSandboxError> =>
  readStreamBytes(stream, maxBytes).pipe(
    Effect.map((bytes) => Buffer.from(bytes).toString("utf8")),
  );

const followPull = (
  docker: DockerClient,
  stream: NodeJS.ReadableStream,
): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.callback<void, OmpDockerSandboxError>((resume) => {
    docker.modem.followProgress(stream, (error) => {
      if (error !== null && error !== undefined) {
        resume(Effect.fail(sandboxError("OMP Docker image pull failed.", error)));
        return;
      }
      resume(Effect.void);
    });
  });

const authFailure = (
  message: string,
  cause: unknown,
): Effect.Effect<never, HarnessSandboxAuthenticationError> =>
  Effect.fail(
    new HarnessSandboxAuthenticationError({
      message,
      sandboxProviderId: OMP_SANDBOX_PROVIDER_ID,
      cause,
    }),
  );

const ensureImage = (docker: DockerClient, image: string): Effect.Effect<void, OmpDockerFailure> =>
  fromDocker(() => docker.getImage(image).inspect()).pipe(
    Effect.asVoid,
    Effect.matchEffect({
      onSuccess: (): Effect.Effect<void, OmpDockerFailure> => Effect.void,
      onFailure: (error): Effect.Effect<void, OmpDockerFailure> => {
        if (isDockerAuthError(error) === true) {
          return authFailure("OMP Docker image inspect was not authorized.", error);
        }
        if (dockerStatus(error) !== 404 && isIgnorableDockerError(error) === false) {
          return sandboxError("OMP Docker image inspect failed.", error);
        }
        return fromDocker((signal) => docker.pull(image, { abortSignal: signal })).pipe(
          Effect.flatMap((pullStream) => followPull(docker, pullStream)),
          Effect.matchEffect({
            onSuccess: (): Effect.Effect<void, OmpDockerFailure> => Effect.void,
            onFailure: (pullError): Effect.Effect<void, OmpDockerFailure> => {
              if (isDockerAuthError(pullError) === true) {
                return authFailure("OMP Docker image pull was not authorized.", pullError);
              }
              const named = image.includes("@") ? image.slice(0, image.indexOf("@")) : image;
              return sandboxError(`OMP sandbox failed to pull ${named}.`, pullError);
            },
          }),
        );
      },
    }),
  );

const waitForExecExit = (exec: DockerExec): Effect.Effect<number, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    for (;;) {
      const info = yield* fromDocker(() => exec.inspect());
      if (info.Running === false) return info.ExitCode ?? 1;
      yield* Effect.sleep(Duration.millis(EXEC_EXIT_POLL_MS));
    }
  });

const collectStarted = (
  started: StartedExec,
  stdoutLimit: number,
  stderrLimit: number,
): Effect.Effect<{ stdout: Buffer; stderr: Buffer; exitCode: number }, OmpDockerSandboxError> =>
  Effect.all(
    [
      collectPassThrough(started.stdout, stdoutLimit),
      collectPassThrough(started.stderr, stderrLimit),
      waitForExecExit(started.exec),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode })),
    Effect.ensuring(
      Effect.sync(() => {
        started.stream.destroy();
      }),
    ),
  );

const attemptCleanup = (
  effect: Effect.Effect<void, OmpDockerSandboxError>,
): Effect.Effect<boolean, never> =>
  effect.pipe(
    Effect.match({
      onSuccess: () => true,
      onFailure: (error) => isIgnorableDockerError(error),
    }),
  );

const attachDemux = (
  docker: DockerClient,
  stream: Duplex,
): { readonly stdout: PassThrough; readonly stderr: PassThrough } => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(stream, stdout, stderr);
  const finish = () => {
    stdout.end();
    stderr.end();
  };
  stream.once("end", finish);
  stream.once("close", finish);
  stream.once("error", (error: Error) => {
    stdout.destroy(error);
    stderr.destroy(error);
  });
  return { stdout, stderr };
};

const forceRemoveContainer = (
  container: DockerContainer,
): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const removed = yield* attemptCleanup(
      fromDocker((signal) =>
        container.remove({
          force: true,
          v: true,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(CLEANUP_REQUEST_MS)]),
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(CLEANUP_REQUEST_MS),
          orElse: () => Effect.fail(sandboxError("OMP sandbox cleanup failed.")),
        }),
      ),
    );
    if (removed === false) {
      return yield* sandboxError("OMP sandbox cleanup failed.");
    }
  });

const removeOwnedNetwork = (network: DockerNetwork): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const removed = yield* attemptCleanup(
      fromDocker((signal) =>
        network.remove({
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(CLEANUP_REQUEST_MS)]),
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(CLEANUP_REQUEST_MS),
          orElse: () => Effect.fail(sandboxError("OMP sandbox cleanup failed.")),
        }),
      ),
    );
    if (removed === false) {
      return yield* sandboxError("OMP sandbox cleanup failed.");
    }
  });

class OwnedSessionResources {
  container: DockerContainer | undefined;
  ownedNetwork: DockerNetwork | undefined;
  lost = false;
  private readonly spawns = new Set<SpawnHandle>();
  private inFlight: Promise<void> | undefined;
  private finished = false;
  private dirty = false;

  markLost(): void {
    this.lost = true;
  }

  claimContainer(container: DockerContainer): void {
    this.container ??= container;
    this.dirty = true;
    if (this.lost === true) this.scheduleLateCleanup();
  }

  claimOwnedNetwork(network: DockerNetwork): void {
    this.ownedNetwork ??= network;
    this.dirty = true;
    if (this.lost === true) this.scheduleLateCleanup();
  }

  trackSpawn(handle: SpawnHandle): void {
    this.spawns.add(handle);
  }

  forgetSpawn(handle: SpawnHandle): void {
    this.spawns.delete(handle);
  }

  dispose(): Effect.Effect<void, OmpDockerSandboxError> {
    this.lost = true;
    return Effect.tryPromise({
      try: () => this.beginCleanup(),
      catch: (error) =>
        error instanceof OmpDockerSandboxError
          ? error
          : sandboxError("OMP sandbox cleanup failed."),
    });
  }

  disposeBounded(): Effect.Effect<void, never> {
    this.lost = true;
    return Effect.race(
      this.dispose().pipe(Effect.ignore),
      Effect.sleep(Duration.millis(CLEANUP_WAIT_MS)),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          void this.beginCleanup().catch(ignoreError);
        }),
      ),
      Effect.asVoid,
    );
  }

  private scheduleLateCleanup(): void {
    this.lost = true;
    this.finished = false;
    this.dirty = true;
    void this.beginCleanup().catch(ignoreError);
  }

  private beginCleanup(): Promise<void> {
    if (this.finished === true && this.dirty === false && this.inFlight === undefined) {
      return Promise.resolve();
    }
    if (this.inFlight !== undefined) return this.inFlight;
    this.finished = false;
    const work = Effect.runPromise(this.cleanupKnown()).then(
      () => {
        if (this.inFlight !== work) return;
        this.inFlight = undefined;
        if (this.dirty === true) return this.beginCleanup();
        this.finished = true;
      },
      (error: unknown) => {
        if (this.inFlight === work) this.inFlight = undefined;
        throw error;
      },
    );
    this.inFlight = work;
    return work;
  }

  private cleanupKnown(): Effect.Effect<void, OmpDockerSandboxError> {
    const self = this;
    return Effect.gen(function* () {
      self.dirty = false;
      const container = self.container;
      const ownedNetwork = self.ownedNetwork;
      let failed = false;
      for (const handle of self.spawns) {
        handle.abortTeardown?.();
        handle.abortTeardown = undefined;
        handle.stream.destroy();
        handle.killed = true;
        self.spawns.delete(handle);
      }
      if (container !== undefined) {
        const removed = yield* attemptCleanup(forceRemoveContainer(container));
        if (removed === false) failed = true;
      }
      if (ownedNetwork !== undefined) {
        const removed = yield* attemptCleanup(removeOwnedNetwork(ownedNetwork));
        if (removed === false) failed = true;
      }
      if (failed === true) {
        return yield* sandboxError("OMP sandbox cleanup failed.");
      }
    });
  }
}

const startExec = (
  docker: DockerClient,
  container: DockerContainer,
  command: readonly string[],
  stdin: Uint8Array,
): Effect.Effect<StartedExec, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const exec = yield* fromDocker((signal) =>
      container.exec({
        Cmd: [...command],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        abortSignal: signal,
      }),
    );
    const stream = yield* fromDocker((signal) =>
      exec.start({
        hijack: true,
        stdin: true,
        Tty: false,
        abortSignal: signal,
      }),
    );
    const { stdout, stderr } = attachDemux(docker, stream);
    stream.write(stdin);
    stream.end();
    return { exec, stream, stdout, stderr };
  });

const helperRpc = (
  docker: DockerClient,
  container: DockerContainer,
  request: Record<string, unknown>,
): Effect.Effect<unknown, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const body = yield* encodeUnknownJson(request).pipe(
      Effect.mapError((error) => sandboxError("OMP sandbox helper request is invalid.", error)),
    );
    const started = yield* startExec(
      docker,
      container,
      ["node", HELPER_PATH],
      Buffer.from(body, "utf8"),
    );
    const collected = yield* collectStarted(started, MAX_FILE_BYTES * 2, 65_536);
    if (collected.exitCode !== 0) {
      return yield* sandboxError("OMP sandbox helper failed.");
    }
    return yield* decodeUnknownJson(collected.stdout.toString("utf8")).pipe(
      Effect.mapError(() => sandboxError("OMP sandbox helper returned invalid JSON.")),
    );
  });

const killSpawn = (
  docker: DockerClient,
  container: DockerContainer,
  token: string,
): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const body = yield* encodeUnknownJson({ token }).pipe(
      Effect.mapError(() => sandboxError("OMP sandbox kill request is invalid.")),
    );
    const started = yield* startExec(
      docker,
      container,
      ["node", HELPER_PATH, "kill"],
      Buffer.from(body, "utf8"),
    );
    const collected = yield* collectStarted(started, 4096, 4096);
    if (collected.exitCode !== 0) {
      return yield* sandboxError("OMP sandbox process kill failed.");
    }
    const result = yield* decodeHelperWrite(collected.stdout.toString("utf8")).pipe(
      Effect.mapError(() => sandboxError("OMP sandbox process kill failed.")),
    );
    if (result.ok !== true) {
      return yield* sandboxError("OMP sandbox process kill failed.");
    }
  });

const installHelper = (
  docker: DockerClient,
  container: DockerContainer,
): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const started = yield* startExec(
      docker,
      container,
      [
        "node",
        "-e",
        "const fs = require('node:fs'); fs.mkdirSync('/eval/.omp-sandbox', { mode: 0o700 }); fs.writeFileSync(process.argv[1], fs.readFileSync(0), { flag: 'wx', mode: 0o500 });",
        HELPER_PATH,
      ],
      Buffer.from(HELPER_SOURCE, "utf8"),
    );
    const result = yield* collectStarted(started, 4096, 4096);
    if (result.exitCode !== 0) {
      return yield* sandboxError("OMP sandbox helper installation failed.");
    }
  });

const provisionPnpm = (
  docker: DockerClient,
  container: DockerContainer,
): Effect.Effect<void, OmpDockerSandboxError> =>
  Effect.gen(function* () {
    const install = yield* startExec(
      docker,
      container,
      [
        "npm",
        "install",
        "-g",
        `pnpm@${OMP_SANDBOX_PNPM_VERSION}`,
        "--prefix",
        `${OMP_SANDBOX_WORKDIR}/.local`,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
      ],
      Buffer.alloc(0),
    );
    const installed = yield* collectStarted(install, 65_536, 65_536);
    if (installed.exitCode !== 0) {
      return yield* sandboxError(
        `OMP sandbox failed to provision pnpm@${OMP_SANDBOX_PNPM_VERSION}.`,
      );
    }
    const verify = yield* startExec(docker, container, [PNPM_BIN, "--version"], Buffer.alloc(0));
    const verified = yield* collectStarted(verify, 4096, 4096);
    const version = verified.stdout.toString("utf8").trim();
    if (verified.exitCode !== 0 || version !== OMP_SANDBOX_PNPM_VERSION) {
      return yield* sandboxError(`OMP sandbox pnpm is not ${OMP_SANDBOX_PNPM_VERSION}.`);
    }
  });

const inspectPublishedPort = (
  container: DockerContainer,
  port: number,
  protocol: "http" | "https" | "ws" | undefined,
): Effect.Effect<HarnessV1PortEndpoint, OmpDockerSandboxError> =>
  fromDocker(() => container.inspect()).pipe(
    Effect.flatMap((info) => {
      if (port !== DEFAULT_OMP_SANDBOX_PORT) {
        return sandboxError(`OMP sandbox port ${port} is not published.`);
      }
      const binding = info.NetworkSettings.Ports?.[BRIDGE_PORT_KEY]?.[0];
      const hostPort = binding?.HostPort;
      const hostIp = binding?.HostIp;
      if (hostPort === undefined || hostPort.length === 0) {
        return sandboxError("OMP sandbox bridge port is not published on loopback.");
      }
      if (hostIp !== undefined && hostIp.length > 0 && hostIp !== "127.0.0.1") {
        return sandboxError("OMP sandbox bridge port is not bound to loopback.");
      }
      const scheme = protocol ?? "http";
      return Effect.succeed({ url: `${scheme}://127.0.0.1:${hostPort}` });
    }),
  );

const createOwnedNetwork = (
  docker: DockerClient,
  resources: OwnedSessionResources,
): Effect.Effect<string, OmpDockerFailure> => {
  const networkName = `omp-eval-net-${randomBytes(8).toString("hex")}`;
  return fromDocker(
    (signal) =>
      docker.createNetwork({
        Name: networkName,
        Driver: "bridge",
        CheckDuplicate: true,
        Internal: false,
        Attachable: false,
        EnableIPv6: false,
        Labels: {
          [LABEL_MANAGED]: "1",
          [`${LABEL_MANAGED}.role`]: "session",
        },
        abortSignal: signal,
      }),
    (network) => {
      resources.claimOwnedNetwork(network);
    },
  ).pipe(
    Effect.map((network) => {
      resources.claimOwnedNetwork(network);
      return network.id;
    }),
  );
};

const createOwnedContainer = (
  docker: DockerClient,
  resources: OwnedSessionResources,
  options: ValidatedSandboxOptions,
  networkMode: string,
  sessionId: string | undefined,
): Effect.Effect<DockerContainer, OmpDockerSandboxError> => {
  const containerName = `omp-eval-${randomBytes(8).toString("hex")}`;
  return fromDocker(
    (signal) =>
      docker.createContainer({
        name: containerName,
        Image: options.image,
        User: "node",
        WorkingDir: OMP_SANDBOX_WORKDIR,
        Cmd: ["node", "-e", "setInterval(()=>{}, 1<<30)"],
        Env: [...CONTAINER_ENV],
        ExposedPorts: { [BRIDGE_PORT_KEY]: {} },
        Labels: {
          [LABEL_MANAGED]: "1",
          [`${LABEL_MANAGED}.image`]: options.image.includes("@")
            ? options.image.slice(0, options.image.indexOf("@"))
            : options.image,
          ...(sessionId === undefined
            ? {}
            : { [`${LABEL_MANAGED}.session`]: sessionId.slice(0, 64) }),
        },
        HostConfig: {
          AutoRemove: false,
          NetworkMode: networkMode,
          PortBindings: {
            [BRIDGE_PORT_KEY]: [{ HostIp: "127.0.0.1", HostPort: "0" }],
          },
          Mounts: [
            {
              Target: OMP_RUNTIME_MOUNT_PATH,
              Source: options.runtimeDirectory,
              Type: "bind",
              ReadOnly: true,
              BindOptions: { Propagation: "rprivate" },
            },
          ],
          Tmpfs: {
            [OMP_SANDBOX_WORKDIR]: `rw,exec,nosuid,nodev,mode=1777,size=${EVAL_TMPFS_BYTES}`,
            "/tmp": `rw,exec,nosuid,nodev,mode=1777,size=${TMP_TMPFS_BYTES}`,
            "/home/node": `rw,nosuid,nodev,mode=1777,size=${HOME_TMPFS_BYTES}`,
          },
          ReadonlyRootfs: true,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          Privileged: false,
          PublishAllPorts: false,
          Init: true,
          Memory: MEMORY_BYTES,
          MemorySwap: MEMORY_BYTES,
          NanoCpus: NANO_CPUS,
          PidsLimit: PIDS_LIMIT,
          RestartPolicy: { Name: "no" },
          ExtraHosts: [],
          LogConfig: {
            Type: "json-file",
            Config: { "max-size": "1m", "max-file": "1" },
          },
        },
        abortSignal: signal,
      }),
    (container) => {
      resources.claimContainer(container);
    },
  ).pipe(
    Effect.map((container) => {
      resources.claimContainer(container);
      return container;
    }),
  );
};

const createSessionEffect = (
  options: ValidatedSandboxOptions,
  sessionOptions:
    | {
        sessionId?: string;
        abortSignal?: AbortSignal;
        identity?: string;
        onFirstCreate?: (
          session: SandboxSession,
          opts: { abortSignal?: AbortSignal },
        ) => Promise<void>;
      }
    | undefined,
): Effect.Effect<HarnessV1NetworkSandboxSession, OmpDockerFailure> => {
  const docker = new Dockerode({ socketPath: DOCKER_SOCKET_PATH });
  const resources = new OwnedSessionResources();
  let published = false;

  return Effect.gen(function* () {
    yield* ensureImage(docker, options.image);

    let networkMode = "bridge";
    if (options.callerNetwork !== undefined) {
      const callerNetwork = options.callerNetwork;
      yield* fromDocker(() => docker.getNetwork(callerNetwork).inspect()).pipe(
        Effect.matchEffect({
          onSuccess: (): Effect.Effect<void, OmpDockerFailure> => Effect.void,
          onFailure: (error): Effect.Effect<void, OmpDockerFailure> =>
            isDockerAuthError(error) === true
              ? authFailure("OMP Docker network inspect was not authorized.", error)
              : sandboxError("OMP Docker caller network is not available.", error),
        }),
      );
      networkMode = callerNetwork;
    } else {
      networkMode = yield* createOwnedNetwork(docker, resources);
    }

    const createdContainer = yield* createOwnedContainer(
      docker,
      resources,
      options,
      networkMode,
      sessionOptions?.sessionId,
    );
    yield* fromDocker((signal) => createdContainer.start({ abortSignal: signal }));
    yield* installHelper(docker, createdContainer);
    yield* provisionPnpm(docker, createdContainer);
    const session = createSessionSurface({ docker, container: createdContainer, resources });
    if (sessionOptions?.onFirstCreate !== undefined) {
      const onFirstCreate = sessionOptions.onFirstCreate;
      yield* fromDocker((signal) =>
        Promise.resolve(onFirstCreate(session.restricted(), { abortSignal: signal })),
      );
    }
    return session;
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        published = true;
      }),
    ),
    Effect.ensuring(
      Effect.suspend(() => {
        if (published === true) return Effect.void;
        resources.markLost();
        return resources.disposeBounded();
      }),
    ),
  );
};

/**
 * Synchronous Docker sandbox provider for official HarnessAgent/createACP.
 * Construction performs no Docker or filesystem I/O.
 *
 * `runtimeDirectory` is bind-mounted read-only at `/opt/omp-eval`.
 * The provider is non-resumable: `stop` and `destroy` are the same
 * idempotent dispose (container stop+force-remove with volumes, then
 * owned network only). HarnessAgent `cleanupAfterStartFailure` calls
 * only `stop()`, so that path must not leave a stopped container.
 */
export function createOmpDockerSandbox(options: OmpDockerSandboxOptions): HarnessV1SandboxProvider {
  const validated: ValidatedSandboxOptions = {
    runtimeDirectory: requireAbsolutePath(options.runtimeDirectory, "runtimeDirectory"),
    image: resolveImage(options.image),
    callerNetwork: options.network === undefined ? undefined : requireNetworkName(options.network),
  };

  return {
    specificationVersion: "harness-sandbox-v1",
    providerId: OMP_SANDBOX_PROVIDER_ID,
    createSession: (sessionOptions) =>
      runBoundary(createSessionEffect(validated, sessionOptions), sessionOptions?.abortSignal),
  };
}

const createSessionSurface = ({
  docker,
  container,
  resources,
}: {
  readonly docker: DockerClient;
  readonly container: DockerContainer;
  readonly resources: OwnedSessionResources;
}): HarnessV1NetworkSandboxSession => {
  let closed = false;

  const assertOpen = (): Effect.Effect<void, OmpDockerSandboxError> =>
    closed === true ? Effect.fail(sandboxError("OMP sandbox session is closed.")) : Effect.void;

  const close = (): Promise<void> => {
    closed = true;
    return Effect.runPromise(resources.dispose());
  };

  const readBinary = (path: string): Effect.Effect<Uint8Array | null, OmpDockerSandboxError> =>
    Effect.gen(function* () {
      yield* assertOpen();
      const raw = yield* helperRpc(docker, container, { op: "read", path });
      const encoded = yield* encodeUnknownJson(raw).pipe(
        Effect.mapError((error) => sandboxError("OMP sandbox read is invalid.", error)),
      );
      const result = yield* decodeHelperRead(encoded).pipe(
        Effect.mapError((error) => sandboxError("OMP sandbox read is invalid.", error)),
      );
      if (result.ok === false) {
        return yield* sandboxError("OMP sandbox read failed.");
      }
      if (result.exists !== true) return null;
      if (result.contentBase64 === undefined) {
        return yield* sandboxError("OMP sandbox read returned no content.");
      }
      return Buffer.from(result.contentBase64, "base64");
    });

  const writeBinary = (
    path: string,
    content: Uint8Array,
  ): Effect.Effect<void, OmpDockerSandboxError> =>
    Effect.gen(function* () {
      yield* assertOpen();
      if (content.byteLength > MAX_FILE_BYTES) {
        return yield* sandboxError("OMP sandbox write exceeds byte limit.");
      }
      const raw = yield* helperRpc(docker, container, {
        op: "write",
        path,
        contentBase64: Buffer.from(content).toString("base64"),
      });
      const encoded = yield* encodeUnknownJson(raw).pipe(
        Effect.mapError((error) => sandboxError("OMP sandbox write is invalid.", error)),
      );
      const result = yield* decodeHelperWrite(encoded).pipe(
        Effect.mapError((error) => sandboxError("OMP sandbox write is invalid.", error)),
      );
      if (result.ok === false) {
        return yield* sandboxError("OMP sandbox write failed.");
      }
    });

  const teardownAbort = (handle: SpawnHandle): void => {
    handle.abortTeardown?.();
    handle.abortTeardown = undefined;
  };

  const killHandle = (handle: SpawnHandle): Effect.Effect<void, OmpDockerSandboxError> =>
    Effect.suspend(() => {
      if (handle.killed === true) return Effect.void;
      handle.killed = true;
      teardownAbort(handle);
      return killSpawn(docker, container, handle.token).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            handle.stream.destroy();
            resources.forgetSpawn(handle);
          }),
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            handle.killed = false;
          }),
        ),
      );
    });

  const bindAbort = (handle: SpawnHandle, signal: AbortSignal | undefined): void => {
    if (signal === undefined) return;
    const onAbort = (): void => {
      handle.abortError = abortError(signal);
      void Effect.runPromise(killHandle(handle)).catch(ignoreError);
    };
    if (signal.aborted === true) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    handle.abortTeardown = () => {
      signal.removeEventListener("abort", onAbort);
    };
  };

  const startSpawn = (options: {
    readonly command: string;
    readonly workingDirectory?: string;
    readonly env?: Record<string, string>;
    readonly abortSignal?: AbortSignal;
  }): Effect.Effect<SpawnHandle, OmpDockerSandboxError> =>
    Effect.gen(function* () {
      yield* assertOpen();
      if (typeof options.command !== "string" || options.command.length === 0) {
        return yield* sandboxError("OMP sandbox command is invalid.");
      }
      const token = randomBytes(16).toString("hex");
      const body = yield* encodeUnknownJson({
        token,
        command: options.command,
        cwd: options.workingDirectory,
        env: options.env,
      }).pipe(Effect.mapError(() => sandboxError("OMP sandbox spawn request is invalid.")));
      const started = yield* startExec(
        docker,
        container,
        ["node", HELPER_PATH, "spawn"],
        Buffer.from(`${body}\n`, "utf8"),
      );
      const handle: SpawnHandle = {
        token,
        exec: started.exec,
        stream: started.stream,
        stdout: started.stdout,
        stderr: started.stderr,
        killed: false,
      };
      resources.trackSpawn(handle);
      yield* waitForSpawnReady(handle.stdout).pipe(
        Effect.matchEffect({
          onSuccess: () => Effect.void,
          onFailure: (error) =>
            Effect.ignore(killHandle(handle)).pipe(Effect.andThen(Effect.fail(error))),
        }),
        Effect.onInterrupt(() => Effect.ignore(killHandle(handle))),
      );
      if (options.abortSignal?.aborted === true) {
        yield* killHandle(handle);
        return yield* abortError(options.abortSignal);
      }
      bindAbort(handle, options.abortSignal);
      return handle;
    });

  const waitHandle = (
    handle: SpawnHandle,
  ): Effect.Effect<{ readonly exitCode: number }, OmpDockerSandboxError> =>
    Effect.suspend(() =>
      handle.abortError !== undefined
        ? Effect.fail(handle.abortError)
        : waitForExecExit(handle.exec).pipe(Effect.map((exitCode) => ({ exitCode }))),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          teardownAbort(handle);
          resources.forgetSpawn(handle);
        }),
      ),
    );

  const spawnProcess = (options: {
    readonly command: string;
    readonly workingDirectory?: string;
    readonly env?: Record<string, string>;
    readonly abortSignal?: AbortSignal;
  }) =>
    runBoundary(startSpawn(options), options.abortSignal).then((handle) => ({
      stdout: toWebStream(handle.stdout),
      stderr: toWebStream(handle.stderr),
      wait: () => runBoundary(waitHandle(handle), options.abortSignal),
      kill: () => Effect.runPromise(killHandle(handle)),
    }));

  const runCommand = (options: {
    readonly command: string;
    readonly workingDirectory?: string;
    readonly env?: Record<string, string>;
    readonly abortSignal?: AbortSignal;
  }) =>
    spawnProcess(options).then((processHandle) =>
      runBoundary(
        Effect.gen(function* () {
          const [stdout, stderr, result] = yield* Effect.all(
            [
              collectUtf8(processHandle.stdout, MAX_PROCESS_OUTPUT_BYTES),
              collectUtf8(processHandle.stderr, MAX_PROCESS_OUTPUT_BYTES),
              Effect.tryPromise({
                try: () => processHandle.wait(),
                catch: (error) =>
                  error instanceof OmpDockerSandboxError
                    ? error
                    : sandboxError("OMP sandbox command wait failed."),
              }),
            ],
            { concurrency: "unbounded" },
          );
          return {
            exitCode: result.exitCode,
            stdout,
            stderr,
          };
        }).pipe(
          Effect.tapError(() =>
            Effect.tryPromise({
              try: () => processHandle.kill(),
              catch: () => sandboxError("OMP sandbox command kill failed."),
            }).pipe(Effect.ignore),
          ),
        ),
        options.abortSignal,
      ),
    );

  const sandbox: SandboxSession = {
    description:
      "OMP eval Docker sandbox. Workdir /eval. Runtime /opt/omp-eval is read-only. Bridge port 4000 is published on 127.0.0.1 only.",
    readFile: ({ path, abortSignal }) =>
      runBoundary(
        readBinary(path).pipe(
          Effect.map((bytes) => {
            if (bytes === null) return null;
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes);
                controller.close();
              },
            });
          }),
        ),
        abortSignal,
      ),
    readBinaryFile: ({ path, abortSignal }) => runBoundary(readBinary(path), abortSignal),
    readTextFile: ({ path, abortSignal, encoding, startLine, endLine }) =>
      runBoundary(
        readBinary(path).pipe(
          Effect.flatMap((bytes) =>
            bytes === null
              ? Effect.succeed(null)
              : decodeText(bytes, encoding).pipe(
                  Effect.map((text) => sliceTextLines(text, startLine, endLine)),
                ),
          ),
        ),
        abortSignal,
      ),
    writeFile: ({ path, content, abortSignal }) =>
      runBoundary(
        readStreamBytes(content, MAX_FILE_BYTES).pipe(
          Effect.flatMap((bytes) => writeBinary(path, bytes)),
        ),
        abortSignal,
      ),
    writeBinaryFile: ({ path, content, abortSignal }) =>
      runBoundary(writeBinary(path, content), abortSignal),
    writeTextFile: ({ path, content, abortSignal, encoding }) =>
      runBoundary(
        encodeText(content, encoding).pipe(Effect.flatMap((bytes) => writeBinary(path, bytes))),
        abortSignal,
      ),
    spawn: spawnProcess,
    run: runCommand,
  };

  return {
    ...sandbox,
    id: container.id,
    defaultWorkingDirectory: OMP_SANDBOX_WORKDIR,
    ports: [DEFAULT_OMP_SANDBOX_PORT],
    getPortEndpoint: ({ port, protocol }) =>
      runBoundary(inspectPublishedPort(container, port, protocol)),
    getPortUrl: ({ port, protocol }) =>
      runBoundary(
        inspectPublishedPort(container, port, protocol).pipe(
          Effect.map((endpoint) => endpoint.url),
        ),
      ),
    stop: close,
    destroy: close,
    restricted: () => sandbox,
  };
};
