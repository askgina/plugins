import { createServer } from "node:net";

import * as BunServices from "@effect/platform-bun/BunServices";
import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1PortEndpoint,
  HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import type {
  Experimental_SandboxProcess,
  Experimental_SandboxSession,
} from "@ai-sdk/provider-utils";
import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Result,
  Scope,
  Stream,
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import type {
  ChildProcessHandle,
  ChildProcessSpawner,
} from "effect/unstable/process/ChildProcessSpawner";

export const LOCAL_HARNESS_SANDBOX_PROVIDER_ID = "askgina-local";

const PROCESS_TERM_GRACE = Duration.seconds(3);
const PROCESS_KILL_GRACE = Duration.seconds(5);
const GROUP_SETTLE_GRACE = Duration.seconds(2);
const GROUP_SETTLE_POLL = Duration.millis(50);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const TEXT_ENCODINGS: Record<string, true> = {
  "utf-8": true,
  utf8: true,
  latin1: true,
  utf16le: true,
};

export class LocalHarnessSandboxError extends Data.TaggedError("LocalHarnessSandboxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type LocalHarnessSandboxFailure = LocalHarnessSandboxError;

export interface LocalHarnessSandboxOptions {
  /**
   * Directory under which each session's disposable directory is created.
   * Placement only — this provider runs plain host processes and enforces no
   * filesystem or network confinement.
   */
  readonly rootDirectory?: string;
  /**
   * Extra environment merged over the session's minimal environment for every
   * command. Per-command `env` values take precedence over these.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Network sandbox session backed by plain host processes. Adds the session's
 * on-disk layout so callers can classify staged paths; the extra fields are
 * informational only and imply no isolation.
 *
 * Layout: `sessionDirectory/{home,work,tmp}`. `HOME` is `home/` (not equal to
 * `defaultWorkingDirectory`). Harness session workdirs compose under `work/`.
 */
export interface LocalHarnessSandboxSession extends HarnessV1NetworkSandboxSession {
  /** Unique per-session directory that owns every path below. */
  readonly sessionDirectory: string;
  /** `HOME` for spawned commands. */
  readonly homeDirectory: string;
  /** `defaultWorkingDirectory`; harness session workdirs compose under it. */
  readonly workingDirectory: string;
}

type SandboxServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner;
type SandboxSession = Experimental_SandboxSession;
type SandboxProcess = Experimental_SandboxProcess;

interface InheritedEnv {
  readonly PATH: string;
  readonly USER: string;
  readonly TERM: string;
  readonly LANG: string;
}

interface SpawnedProcess {
  readonly handle: ChildProcessHandle;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  abortError: LocalHarnessSandboxError | undefined;
  abortTeardown: (() => void) | undefined;
}

const sandboxError = (message: string, cause?: unknown): LocalHarnessSandboxError =>
  new LocalHarnessSandboxError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const abortError = (signal: AbortSignal): LocalHarnessSandboxError =>
  sandboxError("Local harness sandbox was aborted.", signal.reason);

const abortEffect = (signal: AbortSignal): Effect.Effect<never, LocalHarnessSandboxError> =>
  Effect.callback<never, LocalHarnessSandboxError>((resume) => {
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

const withAbort = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E | LocalHarnessSandboxError, R> =>
  signal === undefined ? effect : Effect.raceFirst(effect, abortEffect(signal));

const encodeText = (
  content: string,
  encoding: string | undefined,
): Effect.Effect<Uint8Array, LocalHarnessSandboxError> => {
  const label = encoding ?? "utf-8";
  if (TEXT_ENCODINGS[label] !== true) {
    return Effect.fail(
      sandboxError(`Local harness sandbox text encoding is unsupported: ${label}`),
    );
  }
  return Effect.succeed(
    Buffer.from(content, label === "utf-8" ? "utf8" : (label as BufferEncoding)),
  );
};

const decodeText = (
  bytes: Uint8Array,
  encoding: string | undefined,
): Effect.Effect<string, LocalHarnessSandboxError> => {
  const label = encoding ?? "utf-8";
  if (TEXT_ENCODINGS[label] !== true) {
    return Effect.fail(
      sandboxError(`Local harness sandbox text encoding is unsupported: ${label}`),
    );
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

const readStreamBytes = (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  overflowMessage: string,
): Effect.Effect<Uint8Array, LocalHarnessSandboxError> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => ({ reader: stream.getReader(), finished: false }),
      catch: (error) =>
        sandboxError("Local harness sandbox stream reader could not be acquired.", error),
    }),
    (resource) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const pump: Effect.Effect<Uint8Array, LocalHarnessSandboxError> = Effect.suspend(() =>
        Effect.tryPromise({
          try: () => resource.reader.read(),
          catch: (error) => {
            // An errored stream is finished: cancelling it would reject.
            resource.finished = true;
            return sandboxError("Local harness sandbox stream read failed.", error);
          },
        }).pipe(
          Effect.flatMap((result) => {
            if (result.done === true) {
              resource.finished = true;
              const bytes = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
              }
              return Effect.succeed(bytes);
            }
            const value = result.value;
            if (value === undefined) return pump;
            if (size + value.byteLength > maxBytes) {
              return Effect.fail(sandboxError(overflowMessage));
            }
            chunks.push(value);
            size += value.byteLength;
            return pump;
          }),
        ),
      );
      return pump;
    },
    (resource) =>
      Effect.sync(() => {
        // cancel closes pending reads immediately. Do not let an uncooperative
        // source's cancellation promise delay interruption or retain the lock.
        if (!resource.finished) void resource.reader.cancel().catch(() => undefined);
        resource.reader.releaseLock();
      }),
  );

// Whether any process in the group `pgid` is still alive. Raw `process.kill`
// is the only primitive that can probe a process group; Effect's spawner
// exposes no group-liveness check.
const isGroupAlive = (pgid: number): boolean => {
  if (pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
      return false;
    }
    return true;
  }
};

// Send `signal` to every process in group `pgid`. ESRCH means the group is
// already gone, which is the desired end state; any other failure is
// surfaced so cleanup never silently reports success.
const signalGroup = (
  pgid: number,
  signal: NodeJS.Signals,
): Effect.Effect<void, LocalHarnessSandboxError> =>
  Effect.suspend(() => {
    if (pgid <= 1) return Effect.void;
    try {
      process.kill(-pgid, signal);
      return Effect.void;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ESRCH"
      ) {
        return Effect.void;
      }
      return Effect.fail(
        sandboxError(`Local harness sandbox could not signal process group ${pgid}.`, error),
      );
    }
  });

// Reserve an ephemeral loopback port for the in-session bridge listener. Raw
// `node:net` is the only primitive that hands out a free TCP port.
const reserveLoopbackPort = Effect.callback<number, LocalHarnessSandboxError>((resume) => {
  const server = createServer();
  const fail = (error: unknown) => {
    resume(
      Effect.fail(sandboxError("Local harness sandbox could not reserve a loopback port.", error)),
    );
  };
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    server.close((closeError) => {
      if (closeError !== undefined && closeError !== null) {
        fail(closeError);
        return;
      }
      resume(Effect.succeed(port));
    });
  });
});

const createSessionSurface = ({
  fs,
  path,
  services,
  scope,
  sessionDirectory,
  homeDirectory,
  workingDirectory,
  tmpDirectory,
  bridgePort,
  sessionId,
  inherited,
  extraEnv,
}: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly services: Context.Context<SandboxServices>;
  readonly scope: Scope.Closeable;
  readonly sessionDirectory: string;
  readonly homeDirectory: string;
  readonly workingDirectory: string;
  readonly tmpDirectory: string;
  readonly bridgePort: number;
  readonly sessionId: string | undefined;
  readonly inherited: InheritedEnv;
  readonly extraEnv: Readonly<Record<string, string>> | undefined;
}): LocalHarnessSandboxSession => {
  // Process groups this session owns, keyed by group id. Children are spawned
  // detached so each leader starts its own group with pgid equal to its pid.
  // Membership survives leader exit and wait bookkeeping so stop/destroy can
  // reap same-group descendants that outlive their leader.
  const ownedGroups = new Set<number>();
  let closed = false;
  let stopPromise: Promise<void> | undefined;
  let destroyPromise: Promise<void> | undefined;

  const baseEnv: Record<string, string> = {
    PATH: inherited.PATH,
    HOME: homeDirectory,
    CODEX_HOME: path.join(homeDirectory, ".codex"),
    XDG_CONFIG_HOME: path.join(homeDirectory, ".config"),
    XDG_CACHE_HOME: path.join(homeDirectory, ".cache"),
    XDG_DATA_HOME: path.join(homeDirectory, ".local", "share"),
    TMPDIR: tmpDirectory,
    SHELL: "/bin/sh",
    USER: inherited.USER,
    TERM: inherited.TERM,
    LANG: inherited.LANG,
    ...(extraEnv ?? {}),
  };

  const runBoundary = <A, E>(
    effect: Effect.Effect<A, E, SandboxServices>,
    signal?: AbortSignal,
  ): Promise<A> => Effect.runPromise(withAbort(effect, signal).pipe(Effect.provide(services)));

  const assertOpen = (): Effect.Effect<void, LocalHarnessSandboxError> =>
    closed === true
      ? Effect.fail(sandboxError("Local harness sandbox session is closed."))
      : Effect.void;

  const killProcess = (proc: SpawnedProcess): Effect.Effect<void, LocalHarnessSandboxError> =>
    proc.handle.kill({ forceKillAfter: PROCESS_TERM_GRACE }).pipe(
      Effect.catch(() =>
        proc.handle.isRunning.pipe(
          Effect.flatMap((running) =>
            running === true
              ? Effect.fail(sandboxError("Local harness sandbox process could not be killed."))
              : Effect.void,
          ),
        ),
      ),
      Effect.mapError((error) =>
        error instanceof LocalHarnessSandboxError
          ? error
          : sandboxError("Local harness sandbox process could not be killed.", error),
      ),
    );

  const bindAbort = (proc: SpawnedProcess, signal: AbortSignal | undefined): void => {
    if (signal === undefined) return;
    const onAbort = (): void => {
      proc.abortError = abortError(signal);
      void Effect.runPromise(killProcess(proc)).catch(() => undefined);
    };
    if (signal.aborted === true) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    proc.abortTeardown = () => {
      signal.removeEventListener("abort", onAbort);
    };
  };

  const spawnHandle = (spawnOptions: {
    readonly command: string;
    readonly workingDirectory?: string;
    readonly env?: Record<string, string>;
    readonly abortSignal?: AbortSignal;
  }): Effect.Effect<SpawnedProcess, LocalHarnessSandboxError, SandboxServices> =>
    Effect.gen(function* () {
      yield* assertOpen();
      if (typeof spawnOptions.command !== "string" || spawnOptions.command.length === 0) {
        return yield* sandboxError("Local harness sandbox command is invalid.");
      }
      // Native acquire, group registration, already-aborted check, and abort
      // listener bind are one uninterruptible region so a pending outer
      // withAbort interruption cannot leak an unregistered child. If the
      // signal is already aborted after acquire, killProcess is awaited
      // before bindAbort so the kill is not duplicated by onAbort.
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make("/bin/sh", ["-c", spawnOptions.command], {
            cwd: spawnOptions.workingDirectory ?? workingDirectory,
            env: { ...baseEnv, ...(spawnOptions.env ?? {}) },
            extendEnv: false,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            detached: true,
            killSignal: "SIGTERM",
            forceKillAfter: PROCESS_KILL_GRACE,
          }).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.mapError((error) =>
              sandboxError("Local harness sandbox process could not be spawned.", error),
            ),
          );
          const proc: SpawnedProcess = {
            handle,
            stdout: Stream.toReadableStream<Uint8Array>()(handle.stdout),
            stderr: Stream.toReadableStream<Uint8Array>()(handle.stderr),
            abortError: undefined,
            abortTeardown: undefined,
          };
          if (typeof handle.pid === "number" && handle.pid > 1) {
            ownedGroups.add(handle.pid);
          }
          if (spawnOptions.abortSignal?.aborted === true) {
            yield* killProcess(proc);
            return yield* abortError(spawnOptions.abortSignal);
          }
          bindAbort(proc, spawnOptions.abortSignal);
          return proc;
        }),
      );
    });

  const waitProcess = (
    proc: SpawnedProcess,
  ): Effect.Effect<{ readonly exitCode: number }, LocalHarnessSandboxError> =>
    Effect.suspend(() =>
      proc.abortError !== undefined
        ? Effect.fail(proc.abortError)
        : proc.handle.exitCode.pipe(
            Effect.flatMap((exitCode) =>
              proc.abortError !== undefined
                ? Effect.fail(proc.abortError)
                : Effect.succeed({ exitCode }),
            ),
            Effect.mapError((error) =>
              proc.abortError !== undefined
                ? proc.abortError
                : sandboxError("Local harness sandbox process wait failed.", error),
            ),
          ),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          proc.abortTeardown?.();
          proc.abortTeardown = undefined;
        }),
      ),
    );

  const spawnProcess = (spawnOptions: {
    readonly command: string;
    readonly workingDirectory?: string;
    readonly env?: Record<string, string>;
    readonly abortSignal?: AbortSignal;
  }): Promise<SandboxProcess> =>
    runBoundary(spawnHandle(spawnOptions), spawnOptions.abortSignal).then((proc) => ({
      pid: proc.handle.pid,
      stdout: proc.stdout,
      stderr: proc.stderr,
      wait: () => runBoundary(waitProcess(proc), spawnOptions.abortSignal),
      kill: () => runBoundary(killProcess(proc)),
    }));

  const runCommand = (runOptions: {
    readonly command: string;
    readonly workingDirectory?: string;
    readonly env?: Record<string, string>;
    readonly abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
    runBoundary(
      spawnHandle(runOptions).pipe(
        Effect.flatMap((proc) =>
          Effect.all(
            [
              readStreamBytes(
                proc.stdout,
                MAX_PROCESS_OUTPUT_BYTES,
                "Local harness sandbox command output exceeds byte limit.",
              ).pipe(Effect.map((bytes) => Buffer.from(bytes).toString("utf8"))),
              readStreamBytes(
                proc.stderr,
                MAX_PROCESS_OUTPUT_BYTES,
                "Local harness sandbox command output exceeds byte limit.",
              ).pipe(Effect.map((bytes) => Buffer.from(bytes).toString("utf8"))),
              waitProcess(proc),
            ],
            { concurrency: "unbounded" },
          ).pipe(
            Effect.map(([stdout, stderr, result]) => ({
              exitCode: result.exitCode,
              stdout,
              stderr,
            })),
            Effect.tapError(() => Effect.ignore(killProcess(proc))),
            Effect.onInterrupt(() => Effect.ignore(killProcess(proc))),
          ),
        ),
      ),
      runOptions.abortSignal,
    );

  const readBytes = (
    filePath: string,
  ): Effect.Effect<Uint8Array | null, LocalHarnessSandboxError> =>
    assertOpen().pipe(
      Effect.andThen(fs.readFile(filePath)),
      Effect.catchTag("PlatformError", (error: PlatformError.PlatformError) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(null)
          : Effect.fail(sandboxError("Local harness sandbox read failed.", error)),
      ),
    );

  const writeBytes = (
    filePath: string,
    content: Uint8Array,
  ): Effect.Effect<void, LocalHarnessSandboxError> =>
    assertOpen().pipe(
      Effect.andThen(fs.makeDirectory(path.dirname(filePath), { recursive: true })),
      Effect.andThen(fs.writeFile(filePath, content)),
      Effect.mapError((error) =>
        error instanceof LocalHarnessSandboxError
          ? error
          : sandboxError("Local harness sandbox write failed.", error),
      ),
    );

  const awaitGroupsDead = (
    grace: Duration.Duration,
  ): Effect.Effect<void, LocalHarnessSandboxError> =>
    Effect.gen(function* () {
      const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(grace);
      for (;;) {
        for (const pgid of ownedGroups) {
          if (!isGroupAlive(pgid)) ownedGroups.delete(pgid);
        }
        if (ownedGroups.size === 0) return;
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return yield* sandboxError(
            `Local harness sandbox stop left ${ownedGroups.size} process group(s) alive.`,
          );
        }
        yield* Effect.sleep(GROUP_SETTLE_POLL);
      }
    });

  const stopEffect: Effect.Effect<void, LocalHarnessSandboxError> = Effect.gen(function* () {
    closed = true;
    // Closing the session scope runs each spawned process's release: group
    // SIGTERM, forceKillAfter escalation to SIGKILL, then leader exit. Scope
    // close alone cannot guarantee group cleanup: a leader that already
    // exited cleanly releases nothing, so every owned group is signalled and
    // reaped directly regardless of leader state.
    yield* Scope.close(scope, Exit.void);
    for (const pgid of ownedGroups) {
      yield* signalGroup(pgid, "SIGTERM");
    }
    const terminated = yield* Effect.result(awaitGroupsDead(GROUP_SETTLE_GRACE));
    if (Result.isSuccess(terminated)) return;
    for (const pgid of ownedGroups) {
      yield* signalGroup(pgid, "SIGKILL");
    }
    yield* awaitGroupsDead(PROCESS_KILL_GRACE);
  });

  const destroyEffect: Effect.Effect<void, LocalHarnessSandboxError, FileSystem.FileSystem> =
    Effect.gen(function* () {
      // The session directory is only removed after every owned process
      // group is confirmed dead; a failed stop must not strand running
      // processes without their working files.
      yield* stopEffect;
      yield* fs
        .remove(sessionDirectory, { recursive: true, force: true })
        .pipe(
          Effect.mapError((error) =>
            sandboxError("Local harness sandbox could not remove the session directory.", error),
          ),
        );
    });

  const sandbox: SandboxSession = {
    description:
      "Plain host processes with a disposable per-session home directory. " +
      "No filesystem, network, or process isolation is enforced; " +
      "sessionDirectory is placement only. Commands run via /bin/sh on the host.",
    readFile: ({ path: filePath, abortSignal }) =>
      runBoundary(
        readBytes(filePath).pipe(
          Effect.map((bytes) =>
            bytes === null
              ? null
              : new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(bytes);
                    controller.close();
                  },
                }),
          ),
        ),
        abortSignal,
      ),
    readBinaryFile: ({ path: filePath, abortSignal }) =>
      runBoundary(readBytes(filePath), abortSignal),
    readTextFile: ({ path: filePath, abortSignal, encoding, startLine, endLine }) =>
      runBoundary(
        readBytes(filePath).pipe(
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
    writeFile: ({ path: filePath, content, abortSignal }) =>
      runBoundary(
        readStreamBytes(
          content,
          MAX_FILE_BYTES,
          "Local harness sandbox write exceeds byte limit.",
        ).pipe(Effect.flatMap((bytes) => writeBytes(filePath, bytes))),
        abortSignal,
      ),
    writeBinaryFile: ({ path: filePath, content, abortSignal }) =>
      runBoundary(writeBytes(filePath, content), abortSignal),
    writeTextFile: ({ path: filePath, content, abortSignal, encoding }) =>
      runBoundary(
        encodeText(content, encoding).pipe(Effect.flatMap((bytes) => writeBytes(filePath, bytes))),
        abortSignal,
      ),
    spawn: spawnProcess,
    run: runCommand,
  };

  return {
    ...sandbox,
    id: sessionId ?? path.basename(sessionDirectory),
    defaultWorkingDirectory: workingDirectory,
    sessionDirectory,
    homeDirectory,
    workingDirectory,
    ports: [bridgePort],
    getPortEndpoint: ({ port, protocol }) =>
      runBoundary(
        Effect.suspend(() =>
          closed === true
            ? Effect.fail(sandboxError("Local harness sandbox session is closed."))
            : Effect.succeed({
                url: `${protocol ?? "http"}://127.0.0.1:${port}`,
              } satisfies HarnessV1PortEndpoint),
        ),
      ),
    getPortUrl: ({ port, protocol }) =>
      runBoundary(
        Effect.suspend(() =>
          closed === true
            ? Effect.fail(sandboxError("Local harness sandbox session is closed."))
            : Effect.succeed(`${protocol ?? "http"}://127.0.0.1:${port}`),
        ),
      ),
    stop: () => (stopPromise ??= Effect.runPromise(stopEffect)),
    destroy: () => (destroyPromise ??= runBoundary(destroyEffect)),
    restricted: () => sandbox,
  };
};

const createSessionEffect = (
  options: LocalHarnessSandboxOptions,
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
): Effect.Effect<LocalHarnessSandboxSession, LocalHarnessSandboxFailure, SandboxServices> => {
  let published = false;
  let session: LocalHarnessSandboxSession | undefined;
  let sessionDirectory: string | undefined;

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const services = yield* Effect.context<SandboxServices>();
    const inherited: InheritedEnv = {
      PATH: yield* Config.string("PATH").pipe(
        Config.withDefault("/usr/local/bin:/usr/bin:/bin"),
        Effect.orElseSucceed(() => "/usr/local/bin:/usr/bin:/bin"),
      ),
      USER: yield* Config.string("USER").pipe(
        Config.withDefault("askgina"),
        Effect.orElseSucceed(() => "askgina"),
      ),
      TERM: yield* Config.string("TERM").pipe(
        Config.withDefault("xterm-256color"),
        Effect.orElseSucceed(() => "xterm-256color"),
      ),
      LANG: yield* Config.string("LANG").pipe(
        Config.withDefault("C.UTF-8"),
        Effect.orElseSucceed(() => "C.UTF-8"),
      ),
    };

    sessionDirectory = yield* fs
      .makeTempDirectory({ directory: options.rootDirectory, prefix: "askgina-local-" })
      .pipe(
        Effect.mapError((error) =>
          sandboxError("Local harness sandbox could not create a session directory.", error),
        ),
      );
    const homeDirectory = path.join(sessionDirectory, "home");
    const workingDirectory = path.join(sessionDirectory, "work");
    const tmpDirectory = path.join(sessionDirectory, "tmp");
    yield* Effect.all(
      [
        fs.makeDirectory(path.join(homeDirectory, ".codex"), { recursive: true }),
        fs.makeDirectory(path.join(homeDirectory, ".config"), { recursive: true }),
        fs.makeDirectory(path.join(homeDirectory, ".cache"), { recursive: true }),
        fs.makeDirectory(path.join(homeDirectory, ".local", "share"), { recursive: true }),
        fs.makeDirectory(workingDirectory, { recursive: true }),
        fs.makeDirectory(tmpDirectory, { recursive: true }),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((error) =>
        sandboxError("Local harness sandbox could not create session directories.", error),
      ),
    );

    const bridgePort = yield* reserveLoopbackPort;
    const scope = yield* Scope.make("sequential");
    session = createSessionSurface({
      fs,
      path,
      services,
      scope,
      sessionDirectory,
      homeDirectory,
      workingDirectory,
      tmpDirectory,
      bridgePort,
      sessionId: sessionOptions?.sessionId,
      inherited,
      extraEnv: options.env,
    });

    if (sessionOptions?.onFirstCreate !== undefined) {
      const onFirstCreate = sessionOptions.onFirstCreate;
      const created = session;
      yield* Effect.tryPromise({
        try: () => onFirstCreate(created.restricted(), { abortSignal: sessionOptions.abortSignal }),
        catch: (error) => sandboxError("Local harness sandbox first-create hook failed.", error),
      });
    }

    published = true;
    return session;
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (published === true) return;
        const fs = yield* FileSystem.FileSystem;
        if (session !== undefined) {
          const pending = session;
          yield* Effect.tryPromise({
            try: () => pending.destroy(),
            catch: () => sandboxError("Local harness sandbox cleanup failed."),
          }).pipe(Effect.ignore);
          return;
        }
        if (sessionDirectory !== undefined) {
          yield* fs.remove(sessionDirectory, { recursive: true, force: true }).pipe(Effect.ignore);
        }
      }),
    ),
  );
};

/**
 * Synchronous local-process sandbox provider for stock HarnessAgent/createACP.
 * Construction performs no filesystem or process I/O.
 *
 * Sessions run commands as ordinary host child processes (own process group,
 * killed via the platform spawner's group signal on stop/destroy). This is a
 * runtime placement provider, not a security boundary: it enforces no
 * filesystem, network, or process isolation, so it omits the optional
 * `setNetworkPolicy`, `setPorts`, request-transformation, and `resumeSession`
 * surface — the stock contract treats those as absent capabilities.
 */
export function createLocalHarnessSandbox(
  options: LocalHarnessSandboxOptions = {},
): HarnessV1SandboxProvider {
  if (process.platform === "win32") {
    throw sandboxError(
      "Local harness sandbox requires a POSIX host; process-group cleanup is unsupported on Windows.",
    );
  }
  return {
    specificationVersion: "harness-sandbox-v1",
    providerId: LOCAL_HARNESS_SANDBOX_PROVIDER_ID,
    createSession: (sessionOptions) =>
      Effect.runPromise(
        Layer.build(BunServices.layer).pipe(
          Effect.flatMap((context) =>
            withAbort(
              createSessionEffect(options, sessionOptions),
              sessionOptions?.abortSignal,
            ).pipe(Effect.provide(context)),
          ),
          Effect.scoped,
        ),
      ),
  };
}
