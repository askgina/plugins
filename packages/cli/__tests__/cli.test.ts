import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AskGinaAuthError,
  AskGinaJsonArgsError,
  AskGinaToolError,
  AskGinaTransportError,
  listCatalogToolNames,
  type AskGinaTransport,
} from "@askgina/sdk";
import { ConfigProvider, Effect } from "effect";

import { AskGinaCliExitCode, recoverAskGinaCliFailures, runAskGinaCli } from "../src/run";

const mockTransport: AskGinaTransport = {
  listTools: () => Effect.succeed(listCatalogToolNames().map((name) => ({ name }))),
  callTool: (name, args) => Effect.succeed({ name, args }),
};

const withConfigEnv =
  (env: Record<string, string>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
    );

describe("Ask Gina CLI", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("lists catalog tools through the SDK", () =>
      runAskGinaCli({
        argv: ["ask-gina", "list"],
        transport: mockTransport,
      }).pipe(
        withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "test-token" }),
        Effect.tap((code) => Effect.sync(() => assert.strictEqual(code, 0))),
      ),
    );

    it.effect("calls a tool through the SDK", () =>
      runAskGinaCli({
        argv: ["ask-gina", "call", "spot.getSimplePrice", '{"symbol":"ETH"}'],
        transport: mockTransport,
      }).pipe(
        withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "test-token" }),
        Effect.tap((code) => Effect.sync(() => assert.strictEqual(code, 0))),
      ),
    );

    it.effect("accepts ask as an alias for call", () => {
      let received: { name: string; args: Record<string, unknown> } | undefined;
      const transport: AskGinaTransport = {
        listTools: mockTransport.listTools,
        callTool: (name, args) =>
          Effect.sync(() => {
            received = { name, args };
            return { name, args };
          }),
      };
      return runAskGinaCli({
        argv: ["ask-gina", "ask", "spot.getSimplePrice", '{"symbol":"ETH"}'],
        transport,
      }).pipe(
        withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "test-token" }),
        Effect.tap((code) =>
          Effect.sync(() => {
            assert.strictEqual(code, 0);
            assert.deepStrictEqual(received, {
              name: "spot.getSimplePrice",
              args: { symbol: "ETH" },
            });
          }),
        ),
      );
    });

    it.effect("uses the environment token", () => {
      let listToolsRan = false;
      const transport: AskGinaTransport = {
        listTools: () =>
          Effect.sync(() => {
            listToolsRan = true;
            return listCatalogToolNames().map((name) => ({ name }));
          }),
        callTool: mockTransport.callTool,
      };
      return runAskGinaCli({
        argv: ["ask-gina", "list"],
        transport,
      }).pipe(
        withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "environment-token" }),
        Effect.tap((code) =>
          Effect.sync(() => {
            assert.strictEqual(code, 0);
            assert.isTrue(listToolsRan);
          }),
        ),
      );
    });

    it.effect("fails closed when no bearer is supplied", () =>
      runAskGinaCli({
        argv: ["ask-gina", "list"],
        transport: mockTransport,
      }).pipe(
        withConfigEnv({}),
        Effect.flip,
        Effect.tap((error) => Effect.sync(() => assert.instanceOf(error, AskGinaAuthError))),
      ),
    );

    it.effect("rejects the removed --token option", () => {
      let listToolsRan = false;
      const transport: AskGinaTransport = {
        listTools: () =>
          Effect.sync(() => {
            listToolsRan = true;
            return [{ name: "spot.getSimplePrice" }];
          }),
        callTool: mockTransport.callTool,
      };
      return recoverAskGinaCliFailures(
        runAskGinaCli({
          argv: ["ask-gina", "--token", "test-token", "list"],
          transport,
        }),
      ).pipe(
        withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "environment-token" }),
        Effect.tap((code) =>
          Effect.sync(() => {
            assert.strictEqual(code, AskGinaCliExitCode.Usage);
            assert.isFalse(listToolsRan);
          }),
        ),
      );
    });

    it.effect("reports malformed json-args generically without retaining input or cause", () => {
      const rawMarker = "{SENSITIVE_JSON_MARKER";
      let callToolRan = false;
      const transport: AskGinaTransport = {
        listTools: mockTransport.listTools,
        callTool: (name, args) =>
          Effect.sync(() => {
            callToolRan = true;
            return { name, args };
          }),
      };
      return Effect.gen(function* () {
        const error = yield* runAskGinaCli({
          argv: ["ask-gina", "call", "spot.getSimplePrice", rawMarker],
          transport,
        }).pipe(Effect.flip);
        assert.instanceOf(error, AskGinaJsonArgsError);
        assert.strictEqual(error.message, "json-args must be a JSON object");
        assert.notInclude(error.message, rawMarker);
        assert.notInclude(String(error), rawMarker);
        assert.strictEqual(error._tag, "AskGinaJsonArgsError");
        assert.deepStrictEqual(Object.keys(error).sort(), ["_tag", "message"]);
        assert.isFalse("cause" in error);
        assert.isFalse(callToolRan);

        const code = yield* recoverAskGinaCliFailures(Effect.fail(error));
        assert.strictEqual(code, AskGinaCliExitCode.AskGinaJsonArgsError);
      });
    });

    it.effect("rejects explicitly blank json-args before auth or transport", () => {
      let callToolRan = false;
      const transport: AskGinaTransport = {
        listTools: mockTransport.listTools,
        callTool: (name, args) =>
          Effect.sync(() => {
            callToolRan = true;
            return { name, args };
          }),
      };
      return Effect.gen(function* () {
        for (const jsonArgs of ["", "   "]) {
          const error = yield* runAskGinaCli({
            argv: ["ask-gina", "call", "spot.getSimplePrice", jsonArgs],
            transport,
          }).pipe(Effect.flip);
          assert.instanceOf(error, AskGinaJsonArgsError);
        }
        assert.isFalse(callToolRan);
      }).pipe(withConfigEnv({}));
    });

    it.effect("defaults omitted json-args to an empty object", () => {
      let receivedArgs: Record<string, unknown> | undefined;
      const transport: AskGinaTransport = {
        listTools: mockTransport.listTools,
        callTool: (_name, args) =>
          Effect.sync(() => {
            receivedArgs = args;
            return {};
          }),
      };
      return runAskGinaCli({
        argv: ["ask-gina", "call", "spot.getSimplePrice"],
        transport,
      }).pipe(
        withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "test-token" }),
        Effect.tap((code) =>
          Effect.sync(() => {
            assert.strictEqual(code, 0);
            assert.deepStrictEqual(receivedArgs, {});
          }),
        ),
      );
    });

    it.effect("rejects non-object json-args before calling a tool", () => {
      let callToolRan = false;
      const transport: AskGinaTransport = {
        listTools: mockTransport.listTools,
        callTool: (name, args) =>
          Effect.sync(() => {
            callToolRan = true;
            return { name, args };
          }),
      };
      return runAskGinaCli({
        argv: ["ask-gina", "call", "spot.getSimplePrice", "null"],
        transport,
      }).pipe(
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => {
            assert.instanceOf(error, AskGinaJsonArgsError);
            assert.isFalse(callToolRan);
          }),
        ),
      );
    });

    it.effect("maps tagged SDK failures to distinct exit codes", () =>
      Effect.gen(function* () {
        const jsonCode = yield* recoverAskGinaCliFailures(
          runAskGinaCli({
            argv: ["ask-gina", "call", "spot.getSimplePrice", "{"],
            transport: mockTransport,
          }),
        );
        const authCode = yield* recoverAskGinaCliFailures(
          runAskGinaCli({
            argv: ["ask-gina", "list"],
            transport: mockTransport,
          }).pipe(withConfigEnv({})),
        );
        const toolCode = yield* recoverAskGinaCliFailures(
          runAskGinaCli({
            argv: ["ask-gina", "call", "spot.getSimplePrice"],
            transport: {
              listTools: mockTransport.listTools,
              callTool: () => Effect.fail(new AskGinaToolError({ message: "tool failed" })),
            },
          }).pipe(withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "test-token" })),
        );
        const transportCode = yield* recoverAskGinaCliFailures(
          runAskGinaCli({
            argv: ["ask-gina", "call", "spot.getSimplePrice"],
            transport: {
              listTools: mockTransport.listTools,
              callTool: () =>
                Effect.fail(new AskGinaTransportError({ message: "transport failed" })),
            },
          }).pipe(withConfigEnv({ ASK_GINA_ACCESS_TOKEN: "test-token" })),
        );
        assert.strictEqual(jsonCode, AskGinaCliExitCode.AskGinaJsonArgsError);
        assert.strictEqual(authCode, AskGinaCliExitCode.AskGinaAuthError);
        assert.strictEqual(toolCode, AskGinaCliExitCode.AskGinaToolError);
        assert.strictEqual(transportCode, AskGinaCliExitCode.AskGinaTransportError);
      }),
    );

    it.effect("returns zero for help and version", () =>
      Effect.gen(function* () {
        for (const option of ["--help", "--version"]) {
          const code = yield* runAskGinaCli({
            argv: ["ask-gina", option],
            transport: mockTransport,
          });
          assert.strictEqual(code, 0);
        }
      }),
    );

    it.effect("prints parse failures and returns the usage exit code", () =>
      recoverAskGinaCliFailures(
        runAskGinaCli({
          argv: ["ask-gina", "--not-a-flag"],
          transport: mockTransport,
        }),
      ).pipe(
        Effect.tap((code) => Effect.sync(() => assert.strictEqual(code, AskGinaCliExitCode.Usage))),
      ),
    );
    it.effect("returns the usage exit code for an unknown command", () =>
      recoverAskGinaCliFailures(
        runAskGinaCli({
          argv: ["ask-gina", "unknown"],
          transport: mockTransport,
        }),
      ).pipe(
        Effect.tap((code) => Effect.sync(() => assert.strictEqual(code, AskGinaCliExitCode.Usage))),
      ),
    );
  });
});
