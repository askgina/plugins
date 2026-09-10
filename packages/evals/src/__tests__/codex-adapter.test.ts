import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxProvider } from "@ai-sdk/harness";
import {
  createCodex,
  type CodexHarnessSettings,
  type CodexNativeAuthLease,
  type CodexNativeAuthStore,
} from "@ai-sdk/harness-codex";
import { assert, describe, it } from "@effect/vitest";
import { Data, Effect } from "effect";
import { vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Consumer-visible createCodex/HarnessAgent boundary regressions.
 *
 * Fake sandbox transport and deferred native leases observe process/env/state
 * only. They do not prove kernel isolation, all-process store exclusivity, or
 * an external host lock backend.
 */

const SANDBOX_ID = "evals-fake-codex-sandbox";
const SANDBOX_ROOT = "/sandbox";
const SANDBOX_HOME = "/sandbox/home";
const SYNTHETIC_PERSONAL_HOME = "/synthetic-personal";
const LEASE_CODEX_HOME = "/lease/codex-home";
const READABLE_PATHS = ["/eval"] as const;
const AMBIENT_OPENAI_KEY = "ambient-openai-key-not-for-native";
const AMBIENT_CODEX_KEY = "ambient-codex-key-not-for-native";
const AMBIENT_GATEWAY_KEY = "ambient-gateway-key-not-for-native";
const FORCED_API_KEY = "forced-native-apikey";
const STARTUP_TIMEOUT_MS = 1_000;

type SpawnRecord = {
  readonly command: string;
  readonly env: Readonly<Record<string, string>> | undefined;
};

type NativeCleanupFailureStage = "sandbox-settlement" | "lease-release";

type LeaseTracker = {
  acquires: number;
  releases: number;
  cleanupFailures: NativeCleanupFailureStage[];
};

const nativeResumeState = {
  type: "resume-session" as const,
  specificationVersion: "harness-v1" as const,
  harnessId: "codex",
  data: {
    threadId: "native-thread",
    bridge: {
      port: 9400,
      token: "native-detach-token",
      lastSeenEventId: 3,
    },
  },
};

const closedByteStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

const readyByteStream = (port: number): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`{"type":"bridge-ready","port":${String(port)}}\n`),
      );
    },
  });

const envHasSecret = (
  env: Readonly<Record<string, string>> | undefined,
  secret: string,
): boolean => {
  if (env === undefined) return false;
  return Object.values(env).some((value) => value.includes(secret));
};

const createLeaseTracker = (): {
  readonly state: LeaseTracker;
  readonly lease: CodexNativeAuthLease;
} => {
  const state: LeaseTracker = { acquires: 0, releases: 0, cleanupFailures: [] };
  return {
    state,
    lease: {
      codexHome: LEASE_CODEX_HOME,
      release: () => {
        state.releases += 1;
        return Promise.resolve();
      },
    },
  };
};

const createImmediateStore = (
  lease: CodexNativeAuthLease,
  state: LeaseTracker,
): CodexNativeAuthStore => ({
  acquire: () => {
    state.acquires += 1;
    return Promise.resolve(lease);
  },
  onCleanupFailure: (stage: NativeCleanupFailureStage) => {
    state.cleanupFailures.push(stage);
  },
});

const nativeFailureMessage = (result: {
  readonly _tag: string;
  readonly failure?: { readonly cause?: unknown };
}): string => {
  if (result._tag !== "Failure") return "";
  const cause = result.failure?.cause;
  return cause instanceof Error ? cause.message : String(cause ?? "");
};

const fakeBridgeProcessExits = new Set<() => void>();

const exitFakeBridgeProcesses = (): void => {
  for (const exit of fakeBridgeProcessExits) {
    exit();
  }
  fakeBridgeProcessExits.clear();
};

const createFakeSandbox = (options?: {
  readonly stop?: () => Promise<void>;
  readonly onSpawn?: () => void;
  readonly onStop?: () => void;
  readonly home?: string;
  readonly readyPort?: number;
  readonly transformationCapable?: boolean;
}) => {
  const files = new Map<string, string>();
  const spawns: SpawnRecord[] = [];
  const reads: string[] = [];
  const runs: string[] = [];
  const requestTransformations: unknown[] = [];
  let stopCalls = 0;
  const home = options?.home ?? SANDBOX_HOME;

  const run = (request: { readonly command: string }) => {
    runs.push(request.command);
    if (request.command.includes("$HOME")) {
      return Promise.resolve({ exitCode: 0, stdout: home, stderr: "" });
    }
    if (request.command.trim() === "pwd") {
      return Promise.resolve({ exitCode: 0, stdout: SANDBOX_ROOT, stderr: "" });
    }
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };

  const spawn = (request: {
    readonly command: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => {
    spawns.push({
      command: request.command,
      env: request.env === undefined ? undefined : { ...request.env },
    });
    options?.onSpawn?.();
    const killed = Promise.withResolvers<void>();
    const exit = (): void => {
      killed.resolve();
    };
    fakeBridgeProcessExits.add(exit);
    return Promise.resolve({
      stdout:
        options?.readyPort === undefined ? closedByteStream() : readyByteStream(options.readyPort),
      stderr: closedByteStream(),
      kill: () => {
        fakeBridgeProcessExits.delete(exit);
        killed.resolve();
        return Promise.resolve();
      },
      wait: () => killed.promise,
    });
  };

  const writeTextFile = (request: { readonly path: string; readonly content: string }) => {
    files.set(request.path, request.content);
    return Promise.resolve();
  };

  const readTextFile = (request: { readonly path: string }) => {
    reads.push(request.path);
    return Promise.resolve(files.get(request.path) ?? null);
  };

  const io = {
    description: SANDBOX_ID,
    run,
    spawn,
    writeTextFile,
    readTextFile,
    writeFile: writeTextFile,
    readFile: readTextFile,
    writeBinaryFile: () => Promise.resolve(undefined),
    readBinaryFile: () => Promise.resolve(new Uint8Array()),
  };

  const settleStop = (): Promise<void> => {
    stopCalls += 1;
    options?.onStop?.();
    const stop = options?.stop;
    if (stop === undefined) {
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(() => stop())
      .then(() => undefined);
  };

  const session = {
    ...io,
    id: SANDBOX_ID,
    defaultWorkingDirectory: SANDBOX_ROOT,
    ports: [9400],
    getPortEndpoint: () => Promise.resolve({ url: "unix:///sandbox/cli-shim/relay.sock" }),
    getPortUrl: () => Promise.resolve("unix:///sandbox/cli-shim/relay.sock"),
    stop: settleStop,
    destroy: settleStop,
    restricted: () => io,
    ...(options?.transformationCapable === true
      ? {
          addRequestTransformations: (transformations: ReadonlyArray<unknown>) => {
            requestTransformations.push(...transformations);
            return Promise.resolve();
          },
        }
      : {}),
  } as unknown as HarnessV1NetworkSandboxSession;

  const provider: HarnessV1SandboxProvider = {
    specificationVersion: "harness-sandbox-v1",
    providerId: "evals-fake-codex-sandbox",
    createSession: (sessionOptions) => {
      const onFirstCreate = sessionOptions?.onFirstCreate;
      if (onFirstCreate === undefined) {
        return Promise.resolve(session);
      }
      return Promise.resolve()
        .then(() =>
          onFirstCreate(session.restricted(), {
            abortSignal: sessionOptions?.abortSignal,
          }),
        )
        .then(() => session);
    },
    resumeSession: () => Promise.resolve(session),
  };

  return {
    provider,
    session,
    spawns,
    reads,
    runs,
    requestTransformations,
    stopCalls: () => stopCalls,
  };
};

type FakeBridge = {
  readonly inbound: Record<string, unknown>[];
  readonly start: Promise<Record<string, unknown>>;
  readonly port: Promise<number>;
  readonly close: () => Promise<void>;
};

const listenFakeBridge = (options?: { readonly holdTurn?: boolean }): FakeBridge => {
  const inbound: Record<string, unknown>[] = [];
  const start = Promise.withResolvers<Record<string, unknown>>();
  const bound = Promise.withResolvers<number>();
  const connections = new Set<WebSocket>();
  const closed = Promise.withResolvers<void>();
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let listening = false;
  let closing = false;
  let firstError: Error | undefined;

  const sendJson = (socket: WebSocket, value: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(value));
    }
  };

  const captureError = (error: Error): void => {
    if (firstError === undefined) {
      firstError = error;
    }
  };

  wss.on("error", (error: Error) => {
    if (listening === false) {
      bound.reject(error);
      return;
    }
    if (closing === false) {
      captureError(error);
    }
  });
  wss.on("listening", () => {
    listening = true;
    const address = wss.address();
    if (address === null || typeof address === "string") {
      bound.reject(new Error("fake bridge did not bind a TCP port"));
      return;
    }
    bound.resolve(address.port);
  });
  wss.on("connection", (socket: WebSocket) => {
    connections.add(socket);
    socket.on("error", (error: Error) => {
      if (closing === false) {
        captureError(error);
      }
    });
    socket.on("close", () => {
      connections.delete(socket);
    });
    sendJson(socket, { type: "bridge-hello", state: "idle", lastSeq: 0 });
    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[] | string) => {
      const text =
        typeof raw === "string"
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString("utf8")
            : Buffer.concat(Array.isArray(raw) ? raw : [Buffer.from(new Uint8Array(raw))]).toString(
                "utf8",
              );
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch (cause) {
        captureError(cause instanceof Error ? cause : new Error(String(cause)));
        return;
      }
      inbound.push(parsed);
      if (parsed.type === "start") {
        start.resolve(parsed);
        sendJson(socket, { type: "stream-start", seq: 1 });
        if (options?.holdTurn === true) {
          return;
        }
        sendJson(socket, { type: "text-start", id: "t0", seq: 2 });
        sendJson(socket, { type: "text-delta", id: "t0", delta: "ok", seq: 3 });
        sendJson(socket, { type: "text-end", id: "t0", seq: 4 });
        sendJson(socket, {
          type: "finish",
          finishReason: { unified: "stop" },
          totalUsage: { inputTokens: {}, outputTokens: {} },
          seq: 5,
        });
        return;
      }
      if (parsed.type === "stop") {
        sendJson(socket, { type: "bridge-stop", data: {} });
        exitFakeBridgeProcesses();
        socket.close();
        return;
      }
      if (parsed.type === "destroy") {
        exitFakeBridgeProcesses();
        socket.close();
        return;
      }
    });
  });

  const already = wss.address();
  if (already !== null && typeof already !== "string") {
    listening = true;
    bound.resolve(already.port);
  }

  return {
    inbound,
    start: start.promise,
    port: bound.promise,
    close: () => {
      closing = true;
      for (const socket of connections) {
        socket.terminate();
      }
      connections.clear();
      const onError = (error: Error) => {
        captureError(error);
      };
      wss.once("error", onError);
      wss.close((error?: Error) => {
        wss.off("error", onError);
        if (error !== undefined) {
          captureError(error);
        }
        if (firstError !== undefined) {
          closed.reject(firstError);
          return;
        }
        closed.resolve();
      });
      return closed.promise;
    },
  };
};

const withFakeBridge = <A, E>(
  run: (bridge: FakeBridge & { readonly boundPort: number }) => Effect.Effect<A, E>,
  options?: { readonly holdTurn?: boolean },
) => {
  const bridge = listenFakeBridge(options);
  return Effect.acquireRelease(
    Effect.promise(() => bridge.port),
    () => Effect.promise(() => bridge.close()),
  ).pipe(Effect.flatMap((boundPort) => run({ ...bridge, boundPort })));
};

const nativeSettings = (input: {
  readonly store?: CodexNativeAuthStore;
  readonly extra?: Omit<CodexHarnessSettings, "restricted">;
}): CodexHarnessSettings =>
  ({
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    ...input.extra,
    restricted: {
      readablePaths: READABLE_PATHS,
      ...(input.store === undefined ? {} : { nativeAuthStore: input.store }),
    },
  }) as CodexHarnessSettings;

const createNativeAgent = (input: {
  readonly store?: CodexNativeAuthStore;
  readonly sandbox: HarnessV1SandboxProvider;
  readonly extra?: Omit<CodexHarnessSettings, "restricted">;
}) =>
  new HarnessAgent({
    harness: createCodex(nativeSettings(input)),
    sandbox: input.sandbox,
  });

class NativeSessionFailure extends Data.TaggedError("NativeSessionFailure")<{
  readonly cause: unknown;
}> {}

const sessionFailure = (run: () => Promise<unknown>) =>
  Effect.result(
    Effect.tryPromise({
      try: run,
      catch: (cause) => new NativeSessionFailure({ cause }),
    }),
  );

const startNativeAdapterSession = (input: {
  readonly store: CodexNativeAuthStore;
  readonly sandbox: HarnessV1NetworkSandboxSession;
  readonly sessionId: string;
  readonly extra?: Omit<CodexHarnessSettings, "restricted">;
  readonly abortSignal?: AbortSignal;
}) =>
  createCodex(nativeSettings({ store: input.store, extra: input.extra })).doStart(
    Object.assign(
      {
        sessionId: input.sessionId,
        sandboxSession: input.sandbox,
        sessionWorkDir: `${SANDBOX_ROOT}/${input.sessionId}`,
        permissionMode: "allow-all" as const,
      },
      input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal },
      { lifecyclePreflightSupported: true as const },
    ),
  );

describe("native Codex adapter boundaries", () => {
  it.effect(
    "HarnessAgent native construction drives createSession through official createCodex",
    () =>
      withFakeBridge((bridge) =>
        Effect.gen(function* () {
          const fake = createFakeSandbox({ readyPort: bridge.boundPort });
          const { state, lease } = createLeaseTracker();
          const agent = createNativeAgent({
            store: createImmediateStore(lease, state),
            sandbox: fake.provider,
            extra: {
              port: bridge.boundPort,
              portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
            },
          });
          assert.strictEqual(agent.harnessId, "codex");
          const session = yield* Effect.tryPromise(() =>
            agent.createSession({ sessionId: "native-control" }),
          );
          assert.strictEqual(session.sessionId, "native-control");
          assert.ok(fake.spawns.length > 0);
          assert.strictEqual(fake.spawns[0]?.env?.CODEX_HOME, LEASE_CODEX_HOME);
          assert.strictEqual(state.acquires, 1);
          assert.strictEqual(state.releases, 0);
          yield* Effect.promise(() => session.destroy());
        }),
      ),
  );

  it.effect("busy native acquire starts zero processes", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox();
      const store: CodexNativeAuthStore = {
        acquire: () =>
          Promise.reject(Object.assign(new Error("native auth store busy"), { reason: "busy" })),
        onCleanupFailure: () => {},
      };
      const agent = createNativeAgent({ store, sandbox: fake.provider });
      const result = yield* sessionFailure(() => agent.createSession({ sessionId: "native-busy" }));
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
    }),
  );

  it.effect("abort during pending acquire cleans late lease and does not start", () => {
    const abort = new AbortController();
    return Effect.gen(function* () {
      const fake = createFakeSandbox();
      const { state, lease } = createLeaseTracker();
      const acquireStarted = Promise.withResolvers<void>();
      const pending = Promise.withResolvers<CodexNativeAuthLease>();
      const store: CodexNativeAuthStore = {
        acquire: () => {
          state.acquires += 1;
          acquireStarted.resolve();
          return pending.promise;
        },
        onCleanupFailure: (stage: NativeCleanupFailureStage) => {
          state.cleanupFailures.push(stage);
        },
      };
      const agent = createNativeAgent({ store, sandbox: fake.provider });
      const sessionPromise = agent.createSession({
        sessionId: "native-abort-pending",
        abortSignal: abort.signal,
      });
      yield* Effect.promise(() => acquireStarted.promise);
      abort.abort();
      pending.resolve(lease);
      const result = yield* sessionFailure(() => sessionPromise);
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
      assert.strictEqual(state.releases, 1);
    });
  });

  it.effect("stop pending does not release lease", () =>
    Effect.gen(function* () {
      const stopGate = Promise.withResolvers<void>();
      const stopStarted = Promise.withResolvers<void>();
      const fake = createFakeSandbox({
        stop: () => stopGate.promise,
        onStop: () => {
          stopStarted.resolve();
        },
      });
      const { state, lease } = createLeaseTracker();
      const agent = createNativeAgent({
        store: createImmediateStore(lease, state),
        sandbox: fake.provider,
      });
      const sessionPromise = agent.createSession({ sessionId: "native-stop-pending" });
      yield* Effect.promise(() => stopStarted.promise);
      assert.ok(fake.spawns.length > 0);
      assert.strictEqual(state.releases, 0);
      stopGate.resolve();
      const result = yield* sessionFailure(() => sessionPromise);
      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("stop failure does not release lease", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox({
        stop: () =>
          Promise.resolve().then(() => {
            throw new Error("sandbox stop failed");
          }),
      });
      const { state, lease } = createLeaseTracker();
      const agent = createNativeAgent({
        store: createImmediateStore(lease, state),
        sandbox: fake.provider,
      });
      const result = yield* sessionFailure(() =>
        agent.createSession({ sessionId: "native-stop-fail" }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.ok(fake.spawns.length > 0);
      assert.ok(fake.stopCalls() > 0);
      assert.strictEqual(state.releases, 0);
      assert.deepStrictEqual(state.cleanupFailures, ["sandbox-settlement"]);
    }),
  );

  it.effect("managed native config cannot be weakened", () =>
    withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        const { state, lease } = createLeaseTracker();
        const extra = {
          port: bridge.boundPort,
          portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
          webSearch: true,
          codexConfig: {
            sandbox_mode: "danger-full-access",
            approval_policy: "never",
            web_search: "enabled",
            model_reasoning_summary: "detailed",
          },
        } as const;
        const adapterSession = yield* Effect.tryPromise(() =>
          startNativeAdapterSession({
            store: createImmediateStore(lease, state),
            sandbox: fake.session,
            sessionId: "native-config",
            extra,
          }),
        );
        const control = yield* Effect.tryPromise(() =>
          adapterSession.doPromptTurn({
            prompt: "ping",
            skills: [],
            tools: [],
            emit: () => undefined,
          }),
        );
        const start = yield* Effect.promise(() => bridge.start);
        yield* Effect.promise(() => control.done);
        assert.ok(fake.spawns.length > 0);
        assert.strictEqual(fake.spawns[0]?.env?.CODEX_HOME, LEASE_CODEX_HOME);
        assert.notStrictEqual(fake.spawns[0]?.env?.CODEX_HOME, `${SANDBOX_HOME}/.codex`);
        assert.strictEqual(start.webSearch, false);
        assert.strictEqual(start.resumeThreadId, undefined);
        const restricted = start.restricted as
          | { readonly codexHome?: string; readonly nativeAuth?: boolean }
          | undefined;
        assert.strictEqual(restricted?.nativeAuth, true);
        assert.strictEqual(restricted?.codexHome, LEASE_CODEX_HOME);
        const config = start.codexConfig as Record<string, unknown> | undefined;
        assert.ok(config?.sandbox_mode === undefined);
        assert.ok(config?.approval_policy === undefined);
        assert.ok(config?.web_search === undefined);
        assert.strictEqual(config?.model_reasoning_summary, "detailed");
        assert.ok(config?.harmless_overlay === undefined);
      }),
    ),
  );

  it.effect("ambient API keys never reach native spawn", () => {
    vi.stubEnv("OPENAI_API_KEY", AMBIENT_OPENAI_KEY);
    vi.stubEnv("CODEX_API_KEY", AMBIENT_CODEX_KEY);
    vi.stubEnv("AI_GATEWAY_API_KEY", AMBIENT_GATEWAY_KEY);
    return Effect.gen(function* () {
      const fake = createFakeSandbox();
      const { state, lease } = createLeaseTracker();
      const agent = createNativeAgent({
        store: createImmediateStore(lease, state),
        sandbox: fake.provider,
      });
      const result = yield* sessionFailure(() =>
        agent.createSession({ sessionId: "native-ambient-env" }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.ok(fake.spawns.length > 0);
      const spawn = fake.spawns[0];
      assert.ok(spawn !== undefined);
      assert.strictEqual(spawn.env?.CODEX_HOME, LEASE_CODEX_HOME);
      assert.ok(spawn.env?.OPENAI_API_KEY === undefined);
      assert.ok(spawn.env?.CODEX_API_KEY === undefined);
      assert.ok(spawn.env?.AI_GATEWAY_API_KEY === undefined);
      assert.ok(envHasSecret(spawn.env, AMBIENT_OPENAI_KEY) === false);
      assert.ok(envHasSecret(spawn.env, AMBIENT_CODEX_KEY) === false);
      assert.ok(envHasSecret(spawn.env, AMBIENT_GATEWAY_KEY) === false);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.unstubAllEnvs();
        }),
      ),
    );
  });

  it.effect("missing-key fresh-home never starts or reads personal auth", () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("CODEX_API_KEY", undefined);
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
    return Effect.gen(function* () {
      const fake = createFakeSandbox({ home: SYNTHETIC_PERSONAL_HOME });
      const agent = createNativeAgent({ sandbox: fake.provider });
      const result = yield* sessionFailure(() =>
        agent.createSession({ sessionId: "api-mode-no-keys" }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
      assert.ok(fake.reads.every((path) => path.startsWith(SYNTHETIC_PERSONAL_HOME) === false));
      assert.ok(fake.runs.every((command) => command.includes(SYNTHETIC_PERSONAL_HOME) === false));
      assert.ok(fake.runs.every((command) => command.includes("auth.json") === false));
      assert.ok(
        fake.runs.every(
          (command) => command.includes(`${SYNTHETIC_PERSONAL_HOME}/.codex`) === false,
        ),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.unstubAllEnvs();
        }),
      ),
    );
  });

  it.effect("native path rejects api-key forcing settings before spawn", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox();
      const { state, lease } = createLeaseTracker();
      const construct = yield* sessionFailure(() =>
        Promise.resolve(
          createCodex({
            startupTimeoutMs: STARTUP_TIMEOUT_MS,
            auth: { OPENAI_API_KEY: FORCED_API_KEY },
            restricted: {
              readablePaths: READABLE_PATHS,
              nativeAuthStore: createImmediateStore(lease, state),
            },
          } as CodexHarnessSettings),
        ),
      );
      if (construct._tag === "Failure") {
        assert.strictEqual(fake.spawns.length, 0);
        return;
      }
      const agent = createNativeAgent({
        store: createImmediateStore(lease, state),
        sandbox: fake.provider,
        extra: { auth: { OPENAI_API_KEY: FORCED_API_KEY } },
      });
      const result = yield* sessionFailure(() =>
        agent.createSession({ sessionId: "native-reject-apikey" }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
    }),
  );

  it.effect("rejected native resume retains owner lifecycle", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox();
      const { state, lease } = createLeaseTracker();
      const agent = createNativeAgent({
        store: createImmediateStore(lease, state),
        sandbox: fake.provider,
      });
      const result = yield* sessionFailure(() =>
        agent.createSession({
          sessionId: "native-resume",
          resumeFrom: nativeResumeState,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
      assert.ok(fake.stopCalls() > 0);
      assert.strictEqual(state.releases, state.acquires);
    }),
  );

  it.effect("rejected native detach retains owner lifecycle", () =>
    withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        const { state, lease } = createLeaseTracker();
        const adapterSession = yield* Effect.tryPromise(() =>
          startNativeAdapterSession({
            store: createImmediateStore(lease, state),
            sandbox: fake.session,
            sessionId: "native-detach",
            extra: {
              port: bridge.boundPort,
              portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
            },
          }),
        );
        assert.ok(fake.spawns.length > 0);
        assert.strictEqual(state.releases, 0);
        const detached = yield* sessionFailure(() => Promise.resolve(adapterSession.doDetach()));
        assert.strictEqual(detached._tag, "Failure");
        const suspended = yield* sessionFailure(() =>
          Promise.resolve(adapterSession.doSuspendTurn()),
        );
        assert.strictEqual(suspended._tag, "Failure");
        assert.strictEqual(fake.stopCalls(), 0);
        assert.strictEqual(state.releases, 0);
        const control = yield* Effect.tryPromise(() =>
          adapterSession.doPromptTurn({
            prompt: "ping",
            skills: [],
            tools: [],
            emit: () => undefined,
          }),
        );
        yield* Effect.promise(() => control.done);
        assert.strictEqual(fake.stopCalls(), 0);
        assert.strictEqual(state.releases, 0);
        yield* Effect.promise(() => fake.session.stop());
        assert.ok(fake.stopCalls() > 0);
        assert.strictEqual(state.releases, 1);
        yield* Effect.promise(() => fake.session.destroy());
        assert.strictEqual(state.releases, 1);
      }),
    ),
  );

  it.effect("owned HarnessAgent detach reject then explicit destroy releases once", () =>
    withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        const { state, lease } = createLeaseTracker();
        const agent = createNativeAgent({
          store: createImmediateStore(lease, state),
          sandbox: fake.provider,
          extra: {
            port: bridge.boundPort,
            portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
          },
        });
        const session = yield* Effect.tryPromise(() =>
          agent.createSession({ sessionId: "native-ha-owned-detach" }),
        );
        const detached = yield* sessionFailure(() => session.detach());
        assert.strictEqual(detached._tag, "Failure");
        const suspended = yield* sessionFailure(() => session.suspendTurn());
        assert.strictEqual(suspended._tag, "Failure");
        assert.strictEqual(fake.stopCalls(), 0);
        assert.strictEqual(state.releases, 0);
        yield* Effect.promise(() => session.destroy());
        assert.strictEqual(state.releases, 1);
        yield* Effect.promise(() => session.destroy());
        assert.strictEqual(state.releases, 1);
      }),
    ),
  );

  it.effect("borrowed HarnessAgent detach reject then explicit destroy releases once", () =>
    withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        const { state, lease } = createLeaseTracker();
        const agent = createNativeAgent({
          store: createImmediateStore(lease, state),
          sandbox: fake.provider,
          extra: {
            port: bridge.boundPort,
            portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
          },
        });
        const session = yield* Effect.tryPromise(() =>
          agent.createSession({
            sessionId: "native-ha-borrowed-detach",
            sandboxSession: fake.session,
          }),
        );
        const detached = yield* sessionFailure(() => session.detach());
        assert.strictEqual(detached._tag, "Failure");
        assert.strictEqual(fake.stopCalls(), 0);
        assert.strictEqual(state.releases, 0);
        yield* Effect.promise(() => session.destroy());
        assert.strictEqual(fake.stopCalls(), 0);
        assert.strictEqual(state.releases, 0);
        yield* Effect.promise(() => fake.session.destroy());
        assert.ok(fake.stopCalls() > 0);
        assert.strictEqual(state.releases, 1);
        yield* Effect.promise(() => fake.session.destroy());
        assert.strictEqual(state.releases, 1);
      }),
    ),
  );

  it.effect("owned HarnessAgent active-turn detach suspend stop reject then destroy once", () =>
    withFakeBridge(
      (bridge) =>
        Effect.gen(function* () {
          const fake = createFakeSandbox({ readyPort: bridge.boundPort });
          const { state, lease } = createLeaseTracker();
          const agent = createNativeAgent({
            store: createImmediateStore(lease, state),
            sandbox: fake.provider,
            extra: {
              port: bridge.boundPort,
              portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
            },
          });
          const session = yield* Effect.tryPromise(() =>
            agent.createSession({ sessionId: "native-ha-owned-active" }),
          );
          yield* Effect.tryPromise(() => agent.stream({ session, prompt: "ping" }));
          const detached = yield* sessionFailure(() => session.detach());
          assert.strictEqual(detached._tag, "Failure");
          const suspended = yield* sessionFailure(() => session.suspendTurn());
          assert.strictEqual(suspended._tag, "Failure");
          const stopped = yield* sessionFailure(() => session.stop());
          assert.strictEqual(stopped._tag, "Failure");
          assert.strictEqual(fake.stopCalls(), 0);
          assert.strictEqual(state.releases, 0);
          yield* Effect.promise(() => session.destroy());
          assert.strictEqual(state.releases, 1);
          yield* Effect.promise(() => session.destroy());
          assert.strictEqual(state.releases, 1);
        }),
      { holdTurn: true },
    ),
  );

  it.effect("borrowed HarnessAgent active-turn stop reject then explicit destroy once", () =>
    withFakeBridge(
      (bridge) =>
        Effect.gen(function* () {
          const fake = createFakeSandbox({ readyPort: bridge.boundPort });
          const { state, lease } = createLeaseTracker();
          const agent = createNativeAgent({
            store: createImmediateStore(lease, state),
            sandbox: fake.provider,
            extra: {
              port: bridge.boundPort,
              portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
            },
          });
          const session = yield* Effect.tryPromise(() =>
            agent.createSession({
              sessionId: "native-ha-borrowed-active",
              sandboxSession: fake.session,
            }),
          );
          yield* Effect.tryPromise(() => agent.stream({ session, prompt: "ping" }));
          const detached = yield* sessionFailure(() => session.detach());
          assert.strictEqual(detached._tag, "Failure");
          const suspended = yield* sessionFailure(() => session.suspendTurn());
          assert.strictEqual(suspended._tag, "Failure");
          const stopped = yield* sessionFailure(() => session.stop());
          assert.strictEqual(stopped._tag, "Failure");
          assert.strictEqual(fake.stopCalls(), 0);
          assert.strictEqual(state.releases, 0);
          yield* Effect.promise(() => session.destroy());
          assert.strictEqual(fake.stopCalls(), 0);
          assert.strictEqual(state.releases, 0);
          yield* Effect.promise(() => fake.session.destroy());
          assert.ok(fake.stopCalls() > 0);
          assert.strictEqual(state.releases, 1);
          yield* Effect.promise(() => fake.session.destroy());
          assert.strictEqual(state.releases, 1);
        }),
      { holdTurn: true },
    ),
  );

  it.effect("native doStart without lifecycle preflight never acquires", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox();
      let acquireCalls = 0;
      const store: CodexNativeAuthStore = {
        acquire: () => {
          acquireCalls += 1;
          throw new Error("must-not-acquire");
        },
        onCleanupFailure: () => {},
      };
      const result = yield* sessionFailure(() =>
        Promise.resolve(
          createCodex(nativeSettings({ store })).doStart({
            sessionId: "native-no-preflight",
            sandboxSession: fake.session,
            sessionWorkDir: `${SANDBOX_ROOT}/native-no-preflight`,
            permissionMode: "allow-all",
          }),
        ),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(acquireCalls, 0);
      assert.strictEqual(fake.spawns.length, 0);
    }),
  );

  it.effect("synchronous acquire failures are redacted", () =>
    Effect.gen(function* () {
      const sensitive = "secret-fs-path-/home/user/.codex/auth.json";
      const fake = createFakeSandbox();
      let acquireCalls = 0;
      const store: CodexNativeAuthStore = {
        acquire: () => {
          acquireCalls += 1;
          throw new Error(`ENOENT ${sensitive}`);
        },
        onCleanupFailure: () => {},
      };
      const result = yield* sessionFailure(() =>
        Promise.resolve(
          startNativeAdapterSession({
            store,
            sandbox: fake.session,
            sessionId: "native-sync-acquire",
          }),
        ),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(acquireCalls, 1);
      assert.strictEqual(fake.spawns.length, 0);
      const message = nativeFailureMessage(result);
      assert.strictEqual(message, "Native Codex auth store is unavailable.");
      assert.ok(message.includes(sensitive) === false);
    }),
  );

  it.effect("pre-acquire abort microtask does not invoke the store", () => {
    const abort = new AbortController();
    const fake = createFakeSandbox();
    let acquireCalls = 0;
    const store: CodexNativeAuthStore = {
      acquire: () => {
        acquireCalls += 1;
        throw new Error("must-not-acquire");
      },
      onCleanupFailure: () => {},
    };
    const startPromise = startNativeAdapterSession({
      store,
      sandbox: fake.session,
      sessionId: "native-pre-acquire-abort",
      abortSignal: abort.signal,
    });
    abort.abort();
    return Effect.gen(function* () {
      const result = yield* sessionFailure(() => Promise.resolve(startPromise));
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(acquireCalls, 0);
      assert.strictEqual(fake.spawns.length, 0);
    });
  });

  it.effect("synchronous release failure is once-only across stop then destroy", () =>
    withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        let releases = 0;
        const stages: NativeCleanupFailureStage[] = [];
        const lease: CodexNativeAuthLease = {
          codexHome: LEASE_CODEX_HOME,
          release: () => {
            releases += 1;
            throw new Error("sync-release-secret");
          },
        };
        const store: CodexNativeAuthStore = {
          acquire: () => Promise.resolve(lease),
          onCleanupFailure: (stage: NativeCleanupFailureStage) => {
            stages.push(stage);
          },
        };
        const agent = createNativeAgent({
          store,
          sandbox: fake.provider,
          extra: {
            port: bridge.boundPort,
            portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
          },
        });
        yield* Effect.tryPromise(() => agent.createSession({ sessionId: "native-sync-release" }));
        const stopResult = yield* sessionFailure(() => Promise.resolve(fake.session.stop()));
        assert.strictEqual(stopResult._tag, "Failure");
        assert.strictEqual(
          nativeFailureMessage(stopResult),
          "Native Codex auth store could not be released.",
        );
        assert.ok(nativeFailureMessage(stopResult).includes("sync-release-secret") === false);
        const destroyResult = yield* sessionFailure(() => Promise.resolve(fake.session.destroy()));
        assert.strictEqual(destroyResult._tag, "Failure");
        assert.strictEqual(releases, 1);
        assert.deepStrictEqual(stages, ["lease-release"]);
      }),
    ),
  );

  it.effect("late failed release notifies without unhandled rejection", () => {
    const abort = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    return Effect.gen(function* () {
      const fake = createFakeSandbox();
      const acquireStarted = Promise.withResolvers<void>();
      const pending = Promise.withResolvers<CodexNativeAuthLease>();
      const notified = Promise.withResolvers<void>();
      const stages: NativeCleanupFailureStage[] = [];
      let releases = 0;
      const lease: CodexNativeAuthLease = {
        codexHome: LEASE_CODEX_HOME,
        release: () => {
          releases += 1;
          throw new Error("late-release-secret");
        },
      };
      const store: CodexNativeAuthStore = {
        acquire: () => {
          acquireStarted.resolve();
          return pending.promise;
        },
        onCleanupFailure: (stage: NativeCleanupFailureStage) => {
          stages.push(stage);
          notified.resolve();
          throw new Error("reporter-raw-secret");
        },
      };
      const sessionPromise = startNativeAdapterSession({
        store,
        sandbox: fake.session,
        sessionId: "native-late-release",
        abortSignal: abort.signal,
      });
      yield* Effect.promise(() => acquireStarted.promise);
      abort.abort();
      const result = yield* sessionFailure(() => Promise.resolve(sessionPromise));
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(releases, 0);
      yield* Effect.promise(() => fake.session.stop());
      pending.resolve(lease);
      yield* Effect.promise(() => notified.promise);
      const afterNotify = Promise.withResolvers<void>();
      setImmediate(afterNotify.resolve);
      yield* Effect.promise(() => afterNotify.promise);
      assert.strictEqual(releases, 1);
      assert.deepStrictEqual(stages, ["lease-release"]);
      assert.ok(nativeFailureMessage(result).includes("late-release-secret") === false);
      assert.strictEqual(unhandled.length, 0);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          process.off("unhandledRejection", onUnhandled);
        }),
      ),
    );
  });

  it.effect("HarnessAgent destroy still notifies lease-release when the hook is swallowed", () =>
    withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        const notified = Promise.withResolvers<void>();
        const hangingReporter = Promise.withResolvers<void>();
        const stages: NativeCleanupFailureStage[] = [];
        let releases = 0;
        const lease: CodexNativeAuthLease = {
          codexHome: LEASE_CODEX_HOME,
          release: () => {
            releases += 1;
            return Promise.reject(new Error("harness-release-secret"));
          },
        };
        const store: CodexNativeAuthStore = {
          acquire: () => Promise.resolve(lease),
          onCleanupFailure: (stage: NativeCleanupFailureStage) => {
            stages.push(stage);
            notified.resolve();
            return hangingReporter.promise;
          },
        };
        const agent = createNativeAgent({
          store,
          sandbox: fake.provider,
          extra: {
            port: bridge.boundPort,
            portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
          },
        });
        const session = yield* Effect.tryPromise(() =>
          agent.createSession({ sessionId: "native-harness-cleanup" }),
        );
        yield* Effect.promise(() => session.destroy());
        yield* Effect.promise(() => notified.promise);
        hangingReporter.resolve();
        assert.strictEqual(releases, 1);
        assert.deepStrictEqual(stages, ["lease-release"]);
      }),
    ),
  );

  it.effect("async reporter rejection uses sanitized warning and does not alter cleanup", () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    return withFakeBridge((bridge) =>
      Effect.gen(function* () {
        const fake = createFakeSandbox({ readyPort: bridge.boundPort });
        let releases = 0;
        const lease: CodexNativeAuthLease = {
          codexHome: LEASE_CODEX_HOME,
          release: () => {
            releases += 1;
            return Promise.reject(new Error("async-reporter-secret"));
          },
        };
        const store: CodexNativeAuthStore = {
          acquire: () => Promise.resolve(lease),
          onCleanupFailure: () => Promise.reject(new Error("async-reporter-secret")),
        };
        yield* Effect.tryPromise(() =>
          Promise.resolve(
            startNativeAdapterSession({
              store,
              sandbox: fake.session,
              sessionId: "native-async-reporter",
              extra: {
                port: bridge.boundPort,
                portEndpoint: { url: `ws://127.0.0.1:${String(bridge.boundPort)}` },
              },
            }),
          ),
        );
        const destroyResult = yield* sessionFailure(() => Promise.resolve(fake.session.destroy()));
        assert.strictEqual(destroyResult._tag, "Failure");
        assert.strictEqual(releases, 1);
        const afterWarn = Promise.withResolvers<void>();
        setImmediate(afterWarn.resolve);
        yield* Effect.promise(() => afterWarn.promise);
        assert.strictEqual(unhandled.length, 0);
        assert.ok(warnings.length > 0);
        assert.strictEqual(
          warnings[0]?.[0],
          "Native Codex auth store cleanup failure could not be reported.",
        );
        const warningStrings = warnings
          .flat()
          .filter((value): value is string => typeof value === "string");
        assert.ok(
          warningStrings.every((value) => value.includes("async-reporter-secret") === false),
        );
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          console.warn = originalWarn;
          process.off("unhandledRejection", onUnhandled);
        }),
      ),
    );
  });

  it.effect("unknown restricted config keys are rejected before spawn", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox();
      const { state, lease } = createLeaseTracker();
      const result = yield* sessionFailure(() =>
        Promise.resolve(
          startNativeAdapterSession({
            store: createImmediateStore(lease, state),
            sandbox: fake.session,
            sessionId: "native-unknown-config",
            extra: {
              codexConfig: {
                harmless_overlay: "keep",
              },
            },
          }),
        ),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
    }),
  );

  it.effect("empty forwarded key is rejected before spawn", () =>
    Effect.gen(function* () {
      const emptyFake = createFakeSandbox();
      const emptyAgent = new HarnessAgent({
        harness: createCodex({
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          auth: { CODEX_API_KEY: "restricted-forwarded-key" },
          credentialForwarding: () => "",
          restricted: { readablePaths: READABLE_PATHS },
        } as CodexHarnessSettings),
        sandbox: emptyFake.provider,
      });
      const emptyResult = yield* sessionFailure(() =>
        emptyAgent.createSession({ sessionId: "empty-forwarded-key" }),
      );
      assert.strictEqual(emptyResult._tag, "Failure");
      assert.strictEqual(emptyFake.spawns.length, 0);

      const whitespaceFake = createFakeSandbox();
      const whitespaceAgent = new HarnessAgent({
        harness: createCodex({
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          auth: { CODEX_API_KEY: "restricted-forwarded-key" },
          credentialForwarding: () => "   ",
          restricted: { readablePaths: READABLE_PATHS },
        } as CodexHarnessSettings),
        sandbox: whitespaceFake.provider,
      });
      const whitespaceResult = yield* sessionFailure(() =>
        whitespaceAgent.createSession({ sessionId: "whitespace-forwarded-key" }),
      );
      assert.strictEqual(whitespaceResult._tag, "Failure");
      assert.strictEqual(whitespaceFake.spawns.length, 0);
    }),
  );

  it.effect("gateway forwarding that blanks only CODEX_API_KEY is rejected before spawn", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox();
      const agent = new HarnessAgent({
        harness: createCodex({
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          auth: { AI_GATEWAY_API_KEY: "restricted-gateway-key" },
          credentialForwarding: ({ environmentVariableName, credential }) =>
            environmentVariableName === "CODEX_API_KEY" ? "" : credential,
          restricted: { readablePaths: READABLE_PATHS },
        } as CodexHarnessSettings),
        sandbox: fake.provider,
      });
      const result = yield* sessionFailure(() =>
        agent.createSession({ sessionId: "gateway-blank-codex-key" }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.spawns.length, 0);
    }),
  );

  it.effect("borrowed whitespace CODEX_API_KEY forwarding is rejected before transformations", () =>
    Effect.gen(function* () {
      const fake = createFakeSandbox({ transformationCapable: true });
      const agent = new HarnessAgent({
        harness: createCodex({
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          auth: { CODEX_API_KEY: "restricted-forwarded-key" },
          credentialForwarding: ({ environmentVariableName, credential }) =>
            environmentVariableName === "CODEX_API_KEY" ? "   " : credential,
          restricted: { readablePaths: READABLE_PATHS },
        } as CodexHarnessSettings),
        sandbox: fake.provider,
      });
      const result = yield* sessionFailure(() =>
        agent.createSession({
          sessionId: "borrowed-whitespace-codex-key",
          sandboxSession: fake.session,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(fake.requestTransformations.length, 0);
      assert.strictEqual(fake.spawns.length, 0);
      assert.strictEqual(fake.stopCalls(), 0);
    }),
  );
});
