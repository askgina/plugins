import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxProvider } from "@ai-sdk/harness";
import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Data, Deferred, Effect, FileSystem, Path, Result } from "effect";
import { vi } from "vitest";

import {
  createLocalHarnessSandbox,
  type LocalHarnessSandboxSession,
} from "../local-harness-sandbox";

class LocalSandboxTestError extends Data.TaggedError("LocalSandboxTestError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const fail = (message: string, cause?: unknown): LocalSandboxTestError =>
  new LocalSandboxTestError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const isLocalSession = (
  session: HarnessV1NetworkSandboxSession,
): session is LocalHarnessSandboxSession =>
  "homeDirectory" in session && "sessionDirectory" in session && "workingDirectory" in session;

const isGroupAlive = (pid: number): boolean => {
  if (pid <= 1) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

const openSession = (provider: HarnessV1SandboxProvider) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => provider.createSession(),
      catch: (error) => fail("createSession failed", error),
    }).pipe(
      Effect.flatMap((session) =>
        isLocalSession(session)
          ? Effect.succeed(session)
          : Effect.fail(fail("local sandbox session did not expose layout paths")),
      ),
    ),
    // `destroy` is idempotent (`destroyPromise ??=`), so a scope-close
    // re-destroy after an explicit assertion is a no-op. `orDie` keeps the
    // release errorless while still failing the test if cleanup rejects.
    (session) =>
      Effect.tryPromise({
        try: () => session.destroy(),
        catch: (error) => fail("destroy failed", error),
      }).pipe(Effect.orDie),
  );

const runCommand = (
  session: LocalHarnessSandboxSession,
  command: string,
  env?: Record<string, string>,
) =>
  Effect.tryPromise({
    try: () => session.run({ command, ...(env === undefined ? {} : { env }) }),
    catch: (error) => fail("run failed", error),
  });

describe("local harness sandbox", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("returns real command stdout and exit code", () =>
      Effect.gen(function* () {
        const session = yield* openSession(createLocalHarnessSandbox());
        const result = yield* runCommand(session, "printf 'hello-local'; exit 3");
        assert.strictEqual(result.stdout, "hello-local");
        assert.strictEqual(result.stderr, "");
        assert.strictEqual(result.exitCode, 3);
      }),
    );

    it.effect("releases a completed write stream and preserves its bytes", () =>
      Effect.gen(function* () {
        const session = yield* openSession(createLocalHarnessSandbox());
        const bytes = new Uint8Array([1, 2, 3]);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
        const destination = `${session.workingDirectory}/completed.bin`;
        yield* Effect.tryPromise({
          try: () => session.writeFile({ path: destination, content: stream }),
          catch: (error) => fail("write failed", error),
        });
        assert.strictEqual(stream.locked, false);
        const fs = yield* FileSystem.FileSystem;
        assert.deepStrictEqual(Array.from(yield* fs.readFile(destination)), [1, 2, 3]);
      }),
    );

    it.effect("releases an errored write stream without creating a file", () =>
      Effect.gen(function* () {
        const session = yield* openSession(createLocalHarnessSandbox());
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("synthetic stream failure"));
          },
        });
        const destination = `${session.workingDirectory}/errored.bin`;
        const result = yield* Effect.result(
          Effect.tryPromise({
            try: () => session.writeFile({ path: destination, content: stream }),
            catch: (error) => fail("write failed", error),
          }),
        );
        assert.ok(Result.isFailure(result));
        assert.strictEqual(stream.locked, false);
        const fs = yield* FileSystem.FileSystem;
        assert.strictEqual(yield* fs.exists(destination), false);
      }),
    );

    it.effect("cancels oversized writes even when cancellation rejects", () =>
      Effect.gen(function* () {
        const session = yield* openSession(createLocalHarnessSandbox());
        let cancellations = 0;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1));
          },
          cancel() {
            cancellations += 1;
            return Promise.reject(new Error("synthetic cancellation failure"));
          },
        });
        const destination = `${session.workingDirectory}/oversized.bin`;
        const result = yield* Effect.result(
          Effect.tryPromise({
            try: () => session.writeFile({ path: destination, content: stream }),
            catch: (error) => fail("write failed", error),
          }),
        );
        assert.ok(Result.isFailure(result));
        assert.strictEqual(cancellations, 1);
        assert.strictEqual(stream.locked, false);
        const fs = yield* FileSystem.FileSystem;
        assert.strictEqual(yield* fs.exists(destination), false);
      }),
    );

    it.effect("aborts a pending write without awaiting an uncooperative source", () => {
      const controller = new AbortController();
      return Effect.gen(function* () {
        const session = yield* openSession(createLocalHarnessSandbox());
        const cancellation = yield* Deferred.make<void>();
        const services = yield* Effect.context();
        yield* Effect.addFinalizer(() => Deferred.succeed(cancellation, undefined));
        let cancellations = 0;
        const stream = new ReadableStream<Uint8Array>(
          {
            pull() {
              controller.abort();
            },
            cancel() {
              cancellations += 1;
              return Effect.runPromiseWith(services)(Deferred.await(cancellation));
            },
          },
          { highWaterMark: 0 },
        );
        const destination = `${session.workingDirectory}/aborted.bin`;
        const result = yield* Effect.result(
          Effect.tryPromise({
            try: () =>
              session.writeFile({
                path: destination,
                content: stream,
                abortSignal: controller.signal,
              }),
            catch: (error) => fail("write failed", error),
          }),
        );
        assert.ok(Result.isFailure(result));
        assert.strictEqual(cancellations, 1);
        assert.strictEqual(stream.locked, false);
        const fs = yield* FileSystem.FileSystem;
        assert.strictEqual(yield* fs.exists(destination), false);
      });
    });

    it.effect("separates session homes and does not leak parent environment", () => {
      vi.stubEnv("ASK_GINA_SHOULD_NOT_LEAK", "parent-sentinel");
      return Effect.gen(function* () {
        const provider = createLocalHarnessSandbox({
          env: { LOCAL_SANDBOX_PROVIDER: "from-provider" },
        });
        const first = yield* openSession(provider);
        const second = yield* openSession(provider);
        const firstHome = (yield* runCommand(first, 'printf "%s" "$HOME"')).stdout;
        const secondHome = (yield* runCommand(second, 'printf "%s" "$HOME"')).stdout;
        assert.strictEqual(firstHome, first.homeDirectory);
        assert.strictEqual(secondHome, second.homeDirectory);
        assert.notStrictEqual(firstHome, secondHome);
        assert.notStrictEqual(first.workingDirectory, first.homeDirectory);

        const leaked = (yield* runCommand(first, 'printf "%s" "${ASK_GINA_SHOULD_NOT_LEAK-}"'))
          .stdout;
        assert.strictEqual(leaked, "");

        const fromProvider = (yield* runCommand(first, 'printf "%s" "$LOCAL_SANDBOX_PROVIDER"'))
          .stdout;
        assert.strictEqual(fromProvider, "from-provider");
        const fromCommand = (yield* runCommand(first, 'printf "%s" "$LOCAL_SANDBOX_PROVIDER"', {
          LOCAL_SANDBOX_PROVIDER: "from-command",
        })).stdout;
        assert.strictEqual(fromCommand, "from-command");
      }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
    });

    it.effect("aborts spawned work and destroy removes the session directory", () => {
      const controller = new AbortController();
      return Effect.gen(function* () {
        const provider = createLocalHarnessSandbox();
        const session = yield* openSession(provider);
        const proc = yield* Effect.tryPromise({
          try: () =>
            session.spawn({
              command: "sleep 30",
              abortSignal: controller.signal,
            }),
          catch: (error) => fail("spawn failed", error),
        });
        const waited = proc.wait();
        controller.abort();
        const waitResult = yield* Effect.result(
          Effect.tryPromise({
            try: () => Promise.resolve(waited),
            catch: (error) => fail("wait failed", error),
          }),
        );
        assert.ok(Result.isFailure(waitResult));

        const sessionDirectory = session.sessionDirectory;
        yield* Effect.tryPromise({
          try: () => session.destroy(),
          catch: (error) => fail("destroy failed", error),
        });

        const fs = yield* FileSystem.FileSystem;
        const remains = yield* fs.exists(sessionDirectory);
        assert.strictEqual(remains, false);
        if (proc.pid !== undefined) {
          assert.strictEqual(isGroupAlive(proc.pid), false);
        }
      });
    });

    it.effect("destroy stops same-group descendants after the leader exits", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const scratch = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ prefix: "local-harness-pgid-" }),
          (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
        );
        const pgidFile = path.join(scratch, "pgid");
        const session = yield* openSession(createLocalHarnessSandbox());
        const result = yield* runCommand(
          session,
          `sleep 300 >/dev/null 2>&1 & printf '%s' "$$" > '${pgidFile}'`,
        );
        assert.strictEqual(result.exitCode, 0);
        const pgidText = yield* fs.readFileString(pgidFile);
        const pgid = Number.parseInt(pgidText, 10);
        assert.ok(Number.isInteger(pgid) && pgid > 1);
        assert.strictEqual(isGroupAlive(pgid), true);

        const sessionDirectory = session.sessionDirectory;
        yield* Effect.tryPromise({
          try: () => session.destroy(),
          catch: (error) => fail("destroy failed", error),
        });

        assert.strictEqual(isGroupAlive(pgid), false);
        const remains = yield* fs.exists(sessionDirectory);
        assert.strictEqual(remains, false);
      }),
    );
  });
});
