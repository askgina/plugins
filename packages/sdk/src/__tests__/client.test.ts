// @vitest-environment node

import { PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { beforeEach, vi } from "vitest";

import { createClient, listCatalogToolNames } from "../client.js";
import { AskGinaAuthError, AskGinaToolError } from "../errors.js";
import type { AskGinaTransport } from "../transport.js";
const mcpMocks = vi.hoisted(() => ({
  callTool: vi.fn<() => Promise<unknown>>(),
  clientConstructor: vi.fn<() => void>(),
  close: vi.fn<() => Promise<void>>(),
  connect: vi.fn<() => Promise<void>>(),
  listTools: vi.fn<() => Promise<{ tools: ReadonlyArray<{ name: string }> }>>(),
  transportConstructor: vi.fn<(url: URL, options: unknown) => void>(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    readonly callTool = mcpMocks.callTool;
    readonly close = mcpMocks.close;
    readonly connect = mcpMocks.connect;
    readonly listTools = mcpMocks.listTools;

    constructor() {
      mcpMocks.clientConstructor();
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: unknown) {
      mcpMocks.transportConstructor(url, options);
    }
  },
}));

beforeEach(() => {
  mcpMocks.callTool.mockReset().mockResolvedValue({ content: [] });
  mcpMocks.clientConstructor.mockReset();
  mcpMocks.close.mockReset().mockResolvedValue(undefined);
  mcpMocks.connect.mockReset().mockResolvedValue(undefined);
  mcpMocks.listTools.mockReset().mockResolvedValue({ tools: [] });
  mcpMocks.transportConstructor.mockReset();
});

const mockTransport = (calls: {
  list?: number;
  call?: Array<{ name: string; args: Record<string, unknown> }>;
}): AskGinaTransport => ({
  listTools: () =>
    Effect.sync(() => {
      calls.list = (calls.list ?? 0) + 1;
      return [{ name: "spot.getSimplePrice" }, { name: "gina.getTaxReport" }];
    }),
  callTool: (name, args) =>
    Effect.sync(() => {
      calls.call = [...(calls.call ?? []), { name, args }];
      return { ok: true, name, args };
    }),
});

describe("Ask Gina SDK", () => {
  it.effect("uses only the canonical production URL with non-following bearer requests", () =>
    Effect.gen(function* () {
      const observedTools = [...listCatalogToolNames()].reverse().map((name) => ({ name }));
      mcpMocks.listTools.mockResolvedValue({
        tools: observedTools,
      });
      const client = createClient({ accessToken: "test-token" });

      assert.strictEqual(client.url, PRODUCTION_MCP_URL);
      const tools = yield* client.listTools();
      assert.deepStrictEqual(tools, observedTools);
      assert.isTrue(listCatalogToolNames().includes("spot.getSimplePrice"));

      const [url, options] = mcpMocks.transportConstructor.mock.calls[0] ?? [];
      assert.strictEqual(url?.href, new URL(PRODUCTION_MCP_URL).href);
      assert.deepNestedInclude(options as object, {
        "requestInit.headers.Authorization": "Bearer test-token",
        "requestInit.redirect": "error",
      });
    }),
  );
  it.effect("rejects missing tools in the raw production catalog", () =>
    Effect.gen(function* () {
      mcpMocks.listTools.mockResolvedValue({
        tools: listCatalogToolNames()
          .slice(1)
          .map((name) => ({ name })),
      });
      const error = yield* createClient({ accessToken: "test-token" })
        .listTools()
        .pipe(Effect.flip);

      assert.instanceOf(error, AskGinaToolError);
    }),
  );

  it.effect("rejects extra tools in the raw production catalog", () =>
    Effect.gen(function* () {
      mcpMocks.listTools.mockResolvedValue({
        tools: [...listCatalogToolNames().map((name) => ({ name })), { name: "gina.getTaxReport" }],
      });
      const error = yield* createClient({ accessToken: "test-token" })
        .listTools()
        .pipe(Effect.flip);

      assert.instanceOf(error, AskGinaToolError);
    }),
  );

  it("rejects attacker and userinfo URLs before constructing or dispatching MCP", () => {
    for (const attackerUrl of [
      "https://attacker.example/steal",
      "https://test-token@askgina.ai/ai/gina/mcp",
    ]) {
      let thrown: unknown;

      try {
        createClient({ accessToken: "test-token", url: attackerUrl } as never);
      } catch (error) {
        thrown = error;
      }

      assert.instanceOf(thrown, TypeError);
      assert.notInclude(String(thrown), attackerUrl);
    }

    assert.strictEqual(mcpMocks.clientConstructor.mock.calls.length, 0);
    assert.strictEqual(mcpMocks.transportConstructor.mock.calls.length, 0);
    assert.strictEqual(mcpMocks.listTools.mock.calls.length, 0);
    assert.strictEqual(mcpMocks.callTool.mock.calls.length, 0);
  });

  it.effect("uses the injected transport without constructing a bearer transport", () =>
    Effect.gen(function* () {
      const calls: { call?: Array<{ name: string; args: Record<string, unknown> }> } = {};
      const client = createClient({
        accessToken: "test-token",
        transport: mockTransport(calls),
      });
      const result = yield* client.callTool("spot.getSimplePrice", { symbol: "ETH" });
      assert.deepStrictEqual(result, {
        ok: true,
        name: "spot.getSimplePrice",
        args: { symbol: "ETH" },
      });
      assert.deepStrictEqual(calls.call, [
        { name: "spot.getSimplePrice", args: { symbol: "ETH" } },
      ]);
      assert.strictEqual(mcpMocks.clientConstructor.mock.calls.length, 0);
      assert.strictEqual(mcpMocks.transportConstructor.mock.calls.length, 0);
      assert.strictEqual(mcpMocks.listTools.mock.calls.length, 0);
      assert.strictEqual(mcpMocks.callTool.mock.calls.length, 0);
    }),
  );

  it.effect("fails closed on a missing token", () =>
    Effect.gen(function* () {
      const client = createClient({
        accessToken: "   ",
        transport: mockTransport({}),
      });
      const error = yield* client.listTools().pipe(Effect.flip);
      assert.instanceOf(error, AskGinaAuthError);
      assert.strictEqual(
        error.message,
        "Missing OAuth access token. Pass createClient({ accessToken }) or set ASK_GINA_ACCESS_TOKEN. That value is a bearer from your app or an app-signed JWT.",
      );
      assert.isFalse(error.message.includes("codex mcp login"));
    }),
  );

  it.effect("rejects unknown tools before transport", () =>
    Effect.gen(function* () {
      const calls: {
        list?: number;
        call?: Array<{ name: string; args: Record<string, unknown> }>;
      } = {};
      const client = createClient({
        accessToken: "test-token",
        transport: mockTransport(calls),
      });
      const error = Result.match(yield* Effect.result(client.callTool("gina.getTaxReport")), {
        onFailure: (failure) => failure,
        onSuccess: () => assert.fail("Expected AskGinaToolError"),
      });
      assert.instanceOf(error, AskGinaToolError);
      assert.deepStrictEqual(calls, {});
      assert.notInclude(error.message, "test-token");
    }),
  );
});
