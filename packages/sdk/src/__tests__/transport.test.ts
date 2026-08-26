// @vitest-environment node

import { PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";
import { beforeEach, vi } from "vitest";

import { AskGinaToolError, AskGinaTransportError } from "../errors";
import { createProductionTransport, rejectIfMcpToolError } from "../transport";

type RequestOptions = {
  readonly signal?: AbortSignal;
};

type PromiseResolvers<A> = {
  readonly promise: Promise<A>;
  readonly resolve: (value: A | PromiseLike<A>) => void;
  readonly reject: (reason?: unknown) => void;
};

const withResolvers = <A>(): PromiseResolvers<A> =>
  (
    Promise as unknown as {
      readonly withResolvers: <Value>() => PromiseResolvers<Value>;
    }
  ).withResolvers<A>();
const mcpMocks = vi.hoisted(() => ({
  callTool:
    vi.fn<
      (params: unknown, resultSchema?: unknown, options?: RequestOptions) => Promise<unknown>
    >(),
  close: vi.fn<() => Promise<void>>(),
  connect: vi.fn<(transport: unknown, options?: RequestOptions) => Promise<void>>(),
  listTools:
    vi.fn<
      (
        params?: unknown,
        options?: RequestOptions,
      ) => Promise<{ tools: ReadonlyArray<{ name: string }> }>
    >(),
  transportConstructor: vi.fn<(url: URL, options: unknown) => void>(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    readonly callTool = mcpMocks.callTool;
    readonly close = mcpMocks.close;
    readonly connect = mcpMocks.connect;
    readonly listTools = mcpMocks.listTools;
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
  mcpMocks.close.mockReset().mockResolvedValue(undefined);
  mcpMocks.connect.mockReset().mockResolvedValue(undefined);
  mcpMocks.listTools.mockReset().mockResolvedValue({ tools: [] });
  mcpMocks.transportConstructor.mockReset();
});

const bearerFromTransportOptions = (): string | undefined => {
  const options = mcpMocks.transportConstructor.mock.calls[0]?.[1];
  if (typeof options !== "object" || options === null || !("requestInit" in options)) {
    return undefined;
  }
  const requestInit = options.requestInit;
  if (typeof requestInit !== "object" || requestInit === null || !("headers" in requestInit)) {
    return undefined;
  }
  const headers = requestInit.headers;
  return typeof headers === "object" && headers !== null && "Authorization" in headers
    ? String(headers.Authorization)
    : undefined;
};

const mcpToolErrorResult = {
  isError: true,
  content: [{ type: "text", text: "Error (INVALID_ARGUMENTS): bad args" }],
};

describe("rejectIfMcpToolError", () => {
  it.effect("fails AskGinaToolError with the first MCP text content message and tool", () =>
    Effect.gen(function* () {
      const error = Result.match(
        yield* Effect.result(rejectIfMcpToolError(mcpToolErrorResult, "spot.getSimplePrice")),
        {
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected AskGinaToolError"),
        },
      );
      assert.instanceOf(error, AskGinaToolError);
      assert.strictEqual(error.message, "Error (INVALID_ARGUMENTS): bad args");
      assert.strictEqual(error.tool, "spot.getSimplePrice");
    }),
  );

  it.effect("succeeds when isError is absent or false", () =>
    Effect.gen(function* () {
      const absent = { content: [{ type: "text", text: "ok" }] };
      const notError = { isError: false, content: [{ type: "text", text: "ok" }] };
      assert.strictEqual(yield* rejectIfMcpToolError(absent, "spot.getSimplePrice"), absent);
      assert.strictEqual(yield* rejectIfMcpToolError(notError, "spot.getSimplePrice"), notError);
    }),
  );

  it.effect("fails AskGinaToolError with a fallback message when MCP text is missing", () =>
    Effect.gen(function* () {
      const error = Result.match(
        yield* Effect.result(
          rejectIfMcpToolError(
            { isError: true, content: [{ type: "image", data: "x" }] },
            "spot.getSimplePrice",
          ),
        ),
        {
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected AskGinaToolError"),
        },
      );
      assert.instanceOf(error, AskGinaToolError);
      assert.strictEqual(error.message, "Ask Gina tool spot.getSimplePrice reported an error");
      assert.strictEqual(error.tool, "spot.getSimplePrice");
    }),
  );
});

describe("createProductionTransport", () => {
  it.effect("passes cancellation signals to connect and list, then closes on success", () =>
    Effect.gen(function* () {
      mcpMocks.listTools.mockResolvedValue({ tools: [{ name: "spot.getSimplePrice" }] });

      const result = yield* createProductionTransport("test-token").listTools();

      const connectSignal = mcpMocks.connect.mock.calls[0]?.[1]?.signal;
      const requestSignal = mcpMocks.listTools.mock.calls[0]?.[1]?.signal;
      assert.exists(connectSignal);
      assert.exists(requestSignal);
      assert.deepEqual(result, [{ name: "spot.getSimplePrice" }]);
      assert.strictEqual(mcpMocks.close.mock.calls.length, 1);
      assert.strictEqual(bearerFromTransportOptions(), "Bearer test-token");
      const [url, options] = mcpMocks.transportConstructor.mock.calls[0] ?? [];
      assert.strictEqual(url?.href, new URL(PRODUCTION_MCP_URL).href);
      assert.deepNestedInclude(options as object, { "requestInit.redirect": "error" });
    }),
  );

  it.effect("returns the MCP tool payload directly", () =>
    Effect.gen(function* () {
      const payload = { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
      mcpMocks.callTool.mockResolvedValue(payload);

      const result = yield* createProductionTransport("test-token").callTool(
        "spot.getSimplePrice",
        { ids: "ethereum" },
      );

      assert.strictEqual(result, payload);
      assert.strictEqual(bearerFromTransportOptions(), "Bearer test-token");
    }),
  );

  it.effect("redacts the bearer from MCP tool errors", () =>
    Effect.gen(function* () {
      mcpMocks.callTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "upstream echoed test-token" }],
      });

      const error = Result.match(
        yield* Effect.result(
          createProductionTransport("test-token").callTool("spot.getSimplePrice", {}),
        ),
        {
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected AskGinaToolError"),
        },
      );

      assert.instanceOf(error, AskGinaToolError);
      assert.strictEqual(error.message, "upstream echoed [REDACTED]");
    }),
  );

  it.effect("passes cancellation signals to connect and call, then closes on failure", () =>
    Effect.gen(function* () {
      mcpMocks.callTool.mockRejectedValue(new Error("upstream failed: test-token"));

      const error = Result.match(
        yield* Effect.result(
          createProductionTransport("test-token").callTool("spot.getSimplePrice", {
            ids: "ethereum",
          }),
        ),
        {
          onFailure: (failure) => failure,
          onSuccess: () => assert.fail("Expected AskGinaTransportError"),
        },
      );

      const connectSignal = mcpMocks.connect.mock.calls[0]?.[1]?.signal;
      const requestSignal = mcpMocks.callTool.mock.calls[0]?.[2]?.signal;
      assert.instanceOf(error, AskGinaTransportError);
      assert.notInclude(error.message, "test-token");
      assert.notInclude(String(error.cause), "test-token");
      assert.exists(connectSignal);
      assert.exists(requestSignal);
      assert.strictEqual(mcpMocks.close.mock.calls.length, 1);
    }),
  );

  it.effect("aborts and closes an interrupted list request", () =>
    Effect.gen(function* () {
      let requestSignal: AbortSignal | undefined;
      const started = withResolvers<void>();
      mcpMocks.listTools.mockImplementation((_params, options) => {
        requestSignal = options?.signal;
        started.resolve(undefined);
        const pending = withResolvers<{ tools: ReadonlyArray<{ name: string }> }>();
        requestSignal?.addEventListener("abort", () => pending.reject(requestSignal?.reason), {
          once: true,
        });
        return pending.promise;
      });

      const fiber = yield* createProductionTransport("test-token")
        .listTools()
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(fiber);

      assert.isTrue(requestSignal?.aborted);
      assert.strictEqual(mcpMocks.close.mock.calls.length, 1);
    }),
  );

  it.effect("aborts and closes an interrupted call request", () =>
    Effect.gen(function* () {
      let requestSignal: AbortSignal | undefined;
      const started = withResolvers<void>();
      mcpMocks.callTool.mockImplementation((_params, _resultSchema, options) => {
        requestSignal = options?.signal;
        started.resolve(undefined);
        const pending = withResolvers<unknown>();
        requestSignal?.addEventListener("abort", () => pending.reject(requestSignal?.reason), {
          once: true,
        });
        return pending.promise;
      });

      const fiber = yield* createProductionTransport("test-token")
        .callTool("spot.getSimplePrice", { ids: "ethereum" })
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(fiber);

      assert.isTrue(requestSignal?.aborted);
      assert.strictEqual(mcpMocks.close.mock.calls.length, 1);
    }),
  );
});
