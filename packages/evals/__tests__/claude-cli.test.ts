import * as BunServices from "@effect/platform-bun/BunServices";
import { listCatalogToolNames } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import {
  buildClaudeCliEnvironment,
  parseClaudeCliStreamJson,
  PluginEvalClaudeCliProcessError,
  PluginEvalClaudeCliSpawnError,
  PluginEvalClaudeCliTimeoutError,
  runClaudeCliPluginEvalTrial,
  type ClaudeCliCommand,
  type ClaudeCliParseContext,
  type ClaudeCliTrialRunner,
} from "../src/claude-cli";
import type { PluginEvalCase } from "../src/contracts";

const PLUGIN_DIRECTORY = ["/tmp", "ask-gina-eval", "plugin"].join("/");
const PLUGIN_SKILLS_DIRECTORY = `${PLUGIN_DIRECTORY}/skills`;
const WORKING_DIRECTORY = ["/tmp", "ask-gina-eval", "work"].join("/");
const CONFIG_DIRECTORY = ["/tmp", "ask-gina-eval", "config"].join("/");
const SKILL_PATH = `${PLUGIN_SKILLS_DIRECTORY}/research-spot-tokens/SKILL.md`;
const HOST_SKILL_PATH = ["/home", "eval", ".claude", "skills", "find-skills", "SKILL.md"].join("/");
const TEST_API_KEY = Redacted.make("synthetic-anthropic-key");
const TEST_MCP_AUTHORIZATION = Redacted.make("gina-read-secret");

const parseContext: ClaudeCliParseContext = {
  pluginDirectory: PLUGIN_DIRECTORY,
  workingDirectory: WORKING_DIRECTORY,
  forbiddenReadRoots: [CONFIG_DIRECTORY],
};

const trialOptions = {
  runId: "run-claude-read-only",
  repetition: 1,
  availableTools: listCatalogToolNames(),
  workingDirectory: WORKING_DIRECTORY,
  executablePath: "/opt/trusted/claude",
  pluginDirectory: PLUGIN_DIRECTORY,
  mcpAuthorization: TEST_MCP_AUTHORIZATION,
  apiKey: TEST_API_KEY,
  model: "claude-sonnet-4-5",
  reasoning: "medium",
} as const;

const evalCase: PluginEvalCase = {
  id: "spot-direct-price",
  category: "direct",
  tags: ["spot"],
  manual_priority: "required",
  turns: [{ role: "user", content: "What is Ethereum trading at right now in USD?" }],
  expected: {
    skill: { kind: "exact", skill: "research-spot-tokens" },
    routing: { kind: "exact", tool: "spot.getSimplePrice" },
  },
};

const fixtureResult = {
  exitCode: 0,
  stdout: "",
  stdoutTruncated: false,
  stderrTruncated: false,
} as const;

const JsonLine = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

const nativeMcpToolName = (canonical: string): string =>
  `mcp__ask-gina__${canonical.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const NATIVE_PRICE_TOOL = nativeMcpToolName("spot.getSimplePrice");
const NATIVE_ACCOUNT_TOOL = nativeMcpToolName("gina.getAccountAddresses");

const validInit = {
  type: "system",
  subtype: "init",
  plugins: [{ name: "ask-gina", path: PLUGIN_DIRECTORY }],
  mcp_servers: [{ name: "ask-gina", status: "connected" }],
  tools: ["Skill", "Read", ...listCatalogToolNames().map(nativeMcpToolName)],
} as const;

const collectPublicStrings = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectPublicStrings);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectPublicStrings(nested)]);
  }
  return [];
};

const jsonl = (...events: readonly Record<string, unknown>[]): string =>
  `${events.map((event) => Schema.encodeUnknownSync(JsonLine)(event)).join("\n")}\n`;

const successResult = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "ETH is $1.",
  usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
} as const;

describe("Claude CLI JSONL evidence", () => {
  it.effect("records only Skill events and plugin SKILL.md reads as activation", () =>
    Effect.sync(() => {
      const parsed = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                { type: "text", text: `Available skill: ${SKILL_PATH}` },
                {
                  type: "tool_use",
                  id: "skill_1",
                  name: "Skill",
                  input: { skill: "ask-gina:research-spot-tokens" },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "skill_1", content: "loaded" }],
            },
          },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "read_1",
                  name: "Read",
                  input: { file_path: SKILL_PATH },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "read_1", content: "# Skill" }],
            },
          },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "read_host",
                  name: "Read",
                  input: { file_path: HOST_SKILL_PATH },
                },
              ],
            },
          },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "mcp_1",
                  name: NATIVE_PRICE_TOOL,
                  input: { ids: "ethereum", vs_currencies: "usd" },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "mcp_1",
                  content: { ethereum: { usd: 1 } },
                },
              ],
            },
          },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "mcp_plugin",
                  name: "mcp__plugin_ask-gina_gina__gina_getAccountAddresses",
                  input: {},
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "mcp_plugin", content: {} }],
            },
          },
          successResult,
        ),
        parseContext,
      );

      assert.deepStrictEqual(parsed.activated_skills, ["research-spot-tokens"]);
      assert.strictEqual(parsed.tool_calls.length, 1);
      assert.strictEqual(parsed.tool_calls[0]?.name, "spot.getSimplePrice");
      assert.deepStrictEqual(parsed.tool_calls[0]?.arguments, {
        ids: "ethereum",
        vs_currencies: "usd",
      });
      assert.strictEqual(parsed.unsupported_actions, 2);
      assert.strictEqual(parsed.final_answer, "ETH is $1.");
      assert.deepStrictEqual(parsed.token_usage, {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
      });
      assert.isFalse(parsed.malformed_jsonl);
      assert.isFalse(parsed.incomplete);
    }),
  );

  it.effect("omits unavailable or malformed usage without invalidating completion", () =>
    Effect.sync(() => {
      const unavailable = parseClaudeCliStreamJson(
        jsonl(validInit, {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ETH is $1.",
        }),
        parseContext,
      );
      assert.isUndefined(unavailable.token_usage);
      assert.isFalse(unavailable.malformed_jsonl);
      assert.isFalse(unavailable.incomplete);

      const validCases = [
        {
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          expected: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
        {
          usage: { input_tokens: 10, output_tokens: 4 },
          expected: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
        },
      ];
      for (const { usage, expected } of validCases) {
        const parsed = parseClaudeCliStreamJson(
          jsonl(validInit, { ...successResult, usage }),
          parseContext,
        );
        assert.deepStrictEqual(parsed.token_usage, expected);
        assert.isFalse(parsed.malformed_jsonl);
        assert.isFalse(parsed.incomplete);
      }

      const malformedCases = [
        { input_tokens: -1, output_tokens: 1, total_tokens: 0 },
        { input_tokens: 1, output_tokens: 0.5, total_tokens: 1 },
        { input_tokens: 1, output_tokens: 0, total_tokens: null },
        { input_tokens: 1, output_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
        { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
      ];
      for (const usage of malformedCases) {
        const parsed = parseClaudeCliStreamJson(
          jsonl(validInit, { ...successResult, usage }),
          parseContext,
        );
        assert.isUndefined(parsed.token_usage);
        assert.strictEqual(parsed.final_answer, "ETH is $1.");
        assert.isFalse(parsed.malformed_jsonl);
        assert.isFalse(parsed.incomplete);
      }
    }),
  );

  it.effect("does not treat injected skill-path text as activation evidence", () =>
    Effect.sync(() => {
      const parsed = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "text",
                  text: `Use ${SKILL_PATH} and /research-spot-tokens before answering.`,
                },
                { type: "thinking", thinking: "I should load research-spot-tokens" },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );

      assert.deepStrictEqual(parsed.activated_skills, []);
      assert.deepStrictEqual(parsed.tool_calls, []);
      assert.strictEqual(parsed.unsupported_actions, 0);
      assert.isUndefined(parsed.error);
    }),
  );

  it.effect("records staged plugin SKILL.md reads only after a successful result", () =>
    Effect.sync(() => {
      const pending = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "read_1", name: "Read", input: { file_path: SKILL_PATH } },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(pending.activated_skills, []);
      assert.isTrue(pending.incomplete);

      const failed = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "read_1", name: "Read", input: { file_path: SKILL_PATH } },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "read_1",
                  is_error: true,
                  content: "missing",
                },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(failed.activated_skills, []);
      assert.isFalse(failed.incomplete);

      const activated = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "read_1", name: "Read", input: { file_path: SKILL_PATH } },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "read_1", content: "# Skill" }],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(activated.activated_skills, ["research-spot-tokens"]);
      assert.isFalse(activated.incomplete);
    }),
  );

  it.effect("keeps MCP invocation order, rejects duplicate ids, and forbids config traversal", () =>
    Effect.sync(() => {
      const reordered = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "mcp_a",
                  name: NATIVE_PRICE_TOOL,
                  input: { ids: "ethereum" },
                },
                {
                  type: "tool_use",
                  id: "mcp_b",
                  name: NATIVE_ACCOUNT_TOOL,
                  input: {},
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "mcp_b", content: {} }],
            },
          },
          {
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "mcp_a", content: { ethereum: { usd: 1 } } },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.strictEqual(reordered.tool_calls[0]?.name, "spot.getSimplePrice");
      assert.strictEqual(reordered.tool_calls[0]?.sequence, 0);
      assert.strictEqual(reordered.tool_calls[1]?.name, "gina.getAccountAddresses");
      assert.strictEqual(reordered.tool_calls[1]?.sequence, 1);

      const duplicate = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "dup",
                  name: NATIVE_PRICE_TOOL,
                  input: { ids: "ethereum" },
                },
                {
                  type: "tool_use",
                  id: "dup",
                  name: NATIVE_ACCOUNT_TOOL,
                  input: {},
                },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.isTrue(duplicate.malformed_jsonl);

      const traversal = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "read_config",
                  name: "Read",
                  input: { file_path: "../config/mcp.json" },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "read_config", content: "{}" }],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.strictEqual(traversal.unsupported_actions, 1);
      assert.deepStrictEqual(traversal.activated_skills, []);
    }),
  );

  it.effect("scores Bash, WebFetch, and Write as unsupported actions", () =>
    Effect.sync(() => {
      const parsed = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "bash_1",
                  name: "Bash",
                  input: { command: "curl example.com" },
                },
                {
                  type: "tool_use",
                  id: "fetch_1",
                  name: "WebFetch",
                  input: { url: "https://example.com" },
                },
                {
                  type: "tool_use",
                  id: "write_1",
                  name: "Write",
                  input: { file_path: "/tmp/out.txt" },
                },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );

      assert.strictEqual(parsed.unsupported_actions, 3);
      assert.include(parsed.error ?? "", "outside Skill");
      assert.deepStrictEqual(parsed.activated_skills, []);
      assert.deepStrictEqual(parsed.tool_calls, []);
    }),
  );

  it.effect("treats truncated JSONL as malformed and missing result as incomplete", () =>
    Effect.sync(() => {
      const truncated = parseClaudeCliStreamJson(
        '{"type":"assistant","message":{"content":[\n',
        parseContext,
      );
      assert.isTrue(truncated.malformed_jsonl);
      assert.isTrue(truncated.incomplete);

      const missingResult = parseClaudeCliStreamJson(
        jsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "partial" }] },
        }),
        parseContext,
      );
      assert.isFalse(missingResult.malformed_jsonl);
      assert.isTrue(missingResult.incomplete);
    }),
  );

  it.effect("maps sanitized native MCP names and rejects unknown native tools", () =>
    Effect.sync(() => {
      const mapped = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "price_1",
                  name: NATIVE_PRICE_TOOL,
                  input: { ids: "ethereum", vs_currencies: "usd" },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "price_1",
                  content: { ethereum: { usd: 1 } },
                },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.strictEqual(mapped.tool_calls.length, 1);
      assert.strictEqual(mapped.tool_calls[0]?.name, "spot.getSimplePrice");
      assert.deepStrictEqual(mapped.tool_calls[0]?.arguments, {
        ids: "ethereum",
        vs_currencies: "usd",
      });
      assert.notInclude(
        collectPublicStrings(mapped).join("\n"),
        "mcp__ask-gina__spot_getSimplePrice",
      );
      assert.notInclude(collectPublicStrings(mapped).join("\n"), NATIVE_PRICE_TOOL);
      assert.isFalse(mapped.malformed_jsonl);
      assert.isFalse(mapped.incomplete);
      assert.deepStrictEqual(mapped.available_tools, listCatalogToolNames());

      const unknown = parseClaudeCliStreamJson(
        jsonl(
          validInit,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "unknown_1",
                  name: "mcp__ask-gina__spot.getSimplePrice",
                  input: { ids: "ethereum" },
                },
                {
                  type: "tool_use",
                  id: "unknown_2",
                  name: "mcp__ask-gina__not_a_catalog_tool",
                  input: {},
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "unknown_1", content: {} },
                { type: "tool_result", tool_use_id: "unknown_2", content: {} },
              ],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(unknown.tool_calls, []);
      assert.strictEqual(unknown.unsupported_actions, 2);
      assert.include(unknown.error ?? "", "outside Skill");
    }),
  );

  it.effect("accepts optional EndConversation init but not inventory drift or execution", () =>
    Effect.sync(() => {
      const initWithEndConversation = {
        ...validInit,
        tools: [...validInit.tools, "EndConversation"],
      };
      const accepted = parseClaudeCliStreamJson(
        jsonl(initWithEndConversation, successResult),
        parseContext,
      );
      assert.deepStrictEqual(accepted.available_tools, listCatalogToolNames());
      assert.isFalse(accepted.malformed_jsonl);
      assert.isFalse(accepted.incomplete);

      const rejectedInventories = [
        [...validInit.tools, "UnknownTool"],
        validInit.tools.filter((tool) => tool !== NATIVE_PRICE_TOOL),
        [...validInit.tools, "EndConversation", "EndConversation"],
      ];
      for (const tools of rejectedInventories) {
        const rejected = parseClaudeCliStreamJson(
          jsonl({ ...validInit, tools }, successResult),
          parseContext,
        );
        assert.isUndefined(rejected.available_tools);
        assert.isFalse(rejected.malformed_jsonl);
        assert.isTrue(rejected.incomplete);
      }

      const executed = parseClaudeCliStreamJson(
        jsonl(
          initWithEndConversation,
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "end_1",
                  name: "EndConversation",
                  input: {},
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "end_1", content: "ended" }],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(executed.tool_calls, []);
      assert.strictEqual(executed.unsupported_actions, 1);
      assert.include(executed.error ?? "", "outside Skill");
      assert.isFalse(executed.incomplete);
    }),
  );

  it.effect("requires a valid init catalog before actions or result", () =>
    Effect.sync(() => {
      const missingInit = parseClaudeCliStreamJson(
        jsonl(
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "price_1",
                  name: NATIVE_PRICE_TOOL,
                  input: { ids: "ethereum" },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "price_1", content: {} }],
            },
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(missingInit.tool_calls, []);
      assert.isTrue(missingInit.incomplete);
      assert.isFalse(missingInit.malformed_jsonl);
      assert.isUndefined(missingInit.error);
      assert.notInclude(Object.keys(missingInit), "available_tools");
      assert.notInclude(collectPublicStrings(missingInit).join("\n"), PLUGIN_DIRECTORY);

      const pluginError = parseClaudeCliStreamJson(
        jsonl(
          {
            ...validInit,
            plugin_errors: [{ name: "ask-gina", error: "failed to load plugin" }],
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(pluginError.tool_calls, []);
      assert.isTrue(pluginError.incomplete);
      assert.isFalse(pluginError.malformed_jsonl);
      assert.isUndefined(pluginError.error);
      assert.notInclude(Object.keys(pluginError), "available_tools");

      const serverError = parseClaudeCliStreamJson(
        jsonl(
          {
            ...validInit,
            mcp_server_errors: [{ name: "ask-gina", error: "disconnected" }],
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(serverError.tool_calls, []);
      assert.isTrue(serverError.incomplete);
      assert.isFalse(serverError.malformed_jsonl);
      assert.isUndefined(serverError.error);
      assert.notInclude(Object.keys(serverError), "available_tools");

      const incompleteCatalog = parseClaudeCliStreamJson(
        jsonl(
          {
            ...validInit,
            tools: ["Read", "Skill", NATIVE_PRICE_TOOL],
          },
          successResult,
        ),
        parseContext,
      );
      assert.deepStrictEqual(incompleteCatalog.tool_calls, []);
      assert.isTrue(incompleteCatalog.incomplete);
      assert.isFalse(incompleteCatalog.malformed_jsonl);
      assert.isUndefined(incompleteCatalog.error);
      assert.notInclude(Object.keys(incompleteCatalog), "available_tools");
    }),
  );
});

describe("Claude CLI trial adapter", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("uses isolated argv and keeps the API key in child env only", () =>
      Effect.gen(function* () {
        let captured: ClaudeCliCommand | undefined;
        const runner: ClaudeCliTrialRunner = {
          run: (command) =>
            Effect.sync(() => {
              captured = command;
              return {
                ...fixtureResult,
                stdout: jsonl(validInit, successResult),
              };
            }),
        };
        const parentEnvironment = {
          PATH: "/usr/bin:/bin",
          HOME: "/home/eval",
          LANG: "C.UTF-8",
          ANTHROPIC_API_KEY: "parent-secret",
          CLAUDE_CODE_MAX_RETRIES: "99",
          CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: "0",
          CLAUDE_CODE_RETRY_WATCHDOG: "1",
          AWS_SECRET_ACCESS_KEY: "cloud-secret",
          GITHUB_TOKEN: "github-secret",
        };

        const observation = yield* runClaudeCliPluginEvalTrial(evalCase, {
          ...trialOptions,
          parentEnvironment,
          runner,
        });
        if (captured === undefined) return yield* Effect.die("fixture runner was not invoked");

        assert.strictEqual(captured.command, trialOptions.executablePath);
        assert.include(captured.args, "-p");
        assert.include(captured.args, "--restricted");
        // Bare mode disables native Skill even when --tools explicitly includes it.
        assert.notInclude(captured.args, "--bare");
        assert.include(captured.args, "--strict-mcp-config");
        assert.include(captured.args, "--permission-prompts");
        assert.include(captured.args, "none");
        assert.include(captured.args, "--permission-mode");
        assert.include(captured.args, "dontAsk");
        assert.include(captured.args, "--no-session-persistence");
        assert.include(captured.args, "--plugin-dir");
        assert.strictEqual(
          captured.args[captured.args.indexOf("--plugin-dir") + 1],
          PLUGIN_DIRECTORY,
        );
        const allowedTools = captured.args[captured.args.indexOf("--allowedTools") + 1] ?? "";
        assert.notInclude(allowedTools, "mcp__ask-gina__*");
        assert.notInclude(allowedTools, "Skill(ask-gina:*)");
        assert.include(allowedTools, "Skill(ask-gina:research-spot-tokens)");
        assert.include(allowedTools, NATIVE_PRICE_TOOL);
        assert.notInclude(allowedTools, "mcp__ask-gina__spot.getSimplePrice");
        assert.include(captured.args, "--mcp-config");
        assert.include(captured.args, "--output-format");
        assert.include(captured.args, "stream-json");
        assert.include(captured.args, "--effort");
        assert.include(captured.args, "medium");
        assert.include(captured.args, "--max-turns");
        assert.include(captured.args, "8");
        assert.notInclude(captured.args, "synthetic-anthropic-key");
        assert.notInclude(captured.args, "gina-read-secret");
        assert.notInclude(captured.args, "parent-secret");
        assert.strictEqual(captured.environment.ANTHROPIC_API_KEY, "synthetic-anthropic-key");
        assert.strictEqual(captured.environment.CLAUDE_CODE_MAX_RETRIES, "0");
        assert.strictEqual(captured.environment.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK, "1");
        assert.strictEqual(captured.environment.MCP_DISCOVERY_CACHE, "0");
        assert.notInclude(Object.keys(captured.environment), "CLAUDE_CODE_RETRY_WATCHDOG");
        assert.notInclude(Object.keys(captured.environment), "AWS_SECRET_ACCESS_KEY");
        assert.notInclude(Object.keys(captured.environment), "GITHUB_TOKEN");
        assert.strictEqual(observation.target, "claude_cli");
        assert.strictEqual(observation.status, "completed");
        assert.deepStrictEqual(observation.available_tools, listCatalogToolNames());
        assert.notInclude(collectPublicStrings(observation).join("\n"), "synthetic-anthropic-key");
        assert.notInclude(collectPublicStrings(observation).join("\n"), NATIVE_PRICE_TOOL);
      }),
    );

    it.effect("terminates CLI options before a flag-like suite prompt", () =>
      Effect.gen(function* () {
        let captured: ClaudeCliCommand | undefined;
        const runner: ClaudeCliTrialRunner = {
          run: (command) =>
            Effect.sync(() => {
              captured = command;
              return { ...fixtureResult, stdout: jsonl(validInit, successResult) };
            }),
        };
        const flagLikeCase = {
          ...evalCase,
          turns: [{ role: "user", content: "--help" }],
        } satisfies PluginEvalCase;

        yield* runClaudeCliPluginEvalTrial(flagLikeCase, {
          ...trialOptions,
          parentEnvironment: {},
          runner,
        });
        if (captured === undefined) return yield* Effect.die("fixture runner was not invoked");

        assert.deepStrictEqual(captured.args.slice(-2), ["--", "--help"]);
      }),
    );

    it.effect("returns typed spawn and timeout failures without child payload text", () =>
      Effect.gen(function* () {
        const spawnRunner: ClaudeCliTrialRunner = {
          run: (command) =>
            Effect.fail(
              new PluginEvalClaudeCliSpawnError({
                caseId: command.caseId,
                reason: "could_not_start",
              }),
            ),
        };
        const spawnResult = yield* Effect.result(
          runClaudeCliPluginEvalTrial(evalCase, {
            ...trialOptions,
            parentEnvironment: { ANTHROPIC_API_KEY: "must-not-leak" },
            runner: spawnRunner,
          }),
        );
        assert.strictEqual(spawnResult._tag, "Failure");
        if (spawnResult._tag === "Failure") {
          assert.instanceOf(spawnResult.failure, PluginEvalClaudeCliSpawnError);
          assert.notInclude(collectPublicStrings(spawnResult.failure).join("\n"), "must-not-leak");
          assert.notInclude(
            collectPublicStrings(spawnResult.failure).join("\n"),
            "synthetic-anthropic-key",
          );
        }

        let interrupted = false;
        const timeoutRunner: ClaudeCliTrialRunner = {
          run: () =>
            Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
        };
        const timeoutResult = yield* TestClock.withLive(
          Effect.result(
            runClaudeCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              parentEnvironment: {},
              timeoutMs: 1,
              runner: timeoutRunner,
            }),
          ),
        );
        assert.strictEqual(timeoutResult._tag, "Failure");
        if (timeoutResult._tag === "Failure") {
          assert.instanceOf(timeoutResult.failure, PluginEvalClaudeCliTimeoutError);
          assert.isTrue(interrupted);
          if (timeoutResult.failure._tag === "PluginEvalClaudeCliTimeoutError") {
            assert.deepStrictEqual(
              {
                caseId: timeoutResult.failure.caseId,
                timeoutMs: timeoutResult.failure.timeoutMs,
              },
              { caseId: evalCase.id, timeoutMs: 1 },
            );
          }
          assert.notInclude(
            collectPublicStrings(timeoutResult.failure).join("\n"),
            "ANTHROPIC_API_KEY",
          );
        }
      }),
    );

    it.effect(
      "fails typed invalid-process evidence while scoring unsupported completed actions",
      () =>
        Effect.gen(function* () {
          const scenarios = [
            {
              reason: "stdout-truncated" as const,
              result: { ...fixtureResult, stdoutTruncated: true },
            },
            {
              reason: "stderr-truncated" as const,
              result: { ...fixtureResult, stderrTruncated: true },
            },
            {
              reason: "nonzero-exit" as const,
              result: { ...fixtureResult, exitCode: 7 },
            },
            {
              reason: "malformed-jsonl" as const,
              result: { ...fixtureResult, stdout: '{"type":"assistant","message":{"content":[\n' },
            },
            {
              reason: "incomplete-stream" as const,
              result: {
                ...fixtureResult,
                stdout: jsonl({
                  type: "assistant",
                  message: { content: [{ type: "text", text: "cut off" }] },
                }),
              },
            },
          ];
          for (const scenario of scenarios) {
            const result = yield* Effect.result(
              runClaudeCliPluginEvalTrial(evalCase, {
                ...trialOptions,
                parentEnvironment: {},
                runner: { run: () => Effect.succeed(scenario.result) },
              }),
            );
            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.instanceOf(result.failure, PluginEvalClaudeCliProcessError);
              if (result.failure instanceof PluginEvalClaudeCliProcessError) {
                assert.strictEqual(result.failure.reason, scenario.reason);
                assert.notInclude(collectPublicStrings(result.failure).join("\n"), "cut off");
                assert.notInclude(
                  collectPublicStrings(result.failure).join("\n"),
                  "curl example.com",
                );
              }
            }
          }

          const unsupported = yield* runClaudeCliPluginEvalTrial(evalCase, {
            ...trialOptions,
            parentEnvironment: {},
            runner: {
              run: () =>
                Effect.succeed({
                  ...fixtureResult,
                  stdout: jsonl(
                    validInit,
                    {
                      type: "assistant",
                      message: {
                        content: [
                          {
                            type: "tool_use",
                            id: "bash_1",
                            name: "Bash",
                            input: { command: "curl example.com" },
                          },
                        ],
                      },
                    },
                    successResult,
                  ),
                }),
            },
          });
          assert.strictEqual(unsupported.status, "failed");
          assert.include(unsupported.error ?? "", "outside Skill");

          const missingInitTrial = yield* Effect.result(
            runClaudeCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              parentEnvironment: {},
              runner: {
                run: () =>
                  Effect.succeed({
                    ...fixtureResult,
                    stdout: jsonl(successResult),
                  }),
              },
            }),
          );
          assert.strictEqual(missingInitTrial._tag, "Failure");
          if (missingInitTrial._tag === "Failure") {
            assert.instanceOf(missingInitTrial.failure, PluginEvalClaudeCliProcessError);
            if (missingInitTrial.failure instanceof PluginEvalClaudeCliProcessError) {
              assert.strictEqual(missingInitTrial.failure.reason, "incomplete-stream");
            }
          }

          const pluginLoadTrial = yield* Effect.result(
            runClaudeCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              parentEnvironment: {},
              runner: {
                run: () =>
                  Effect.succeed({
                    ...fixtureResult,
                    stdout: jsonl(
                      {
                        ...validInit,
                        plugin_errors: [{ name: "ask-gina", error: "failed to load plugin" }],
                      },
                      successResult,
                    ),
                  }),
              },
            }),
          );
          assert.strictEqual(pluginLoadTrial._tag, "Failure");
          if (pluginLoadTrial._tag === "Failure") {
            assert.instanceOf(pluginLoadTrial.failure, PluginEvalClaudeCliProcessError);
            if (pluginLoadTrial.failure instanceof PluginEvalClaudeCliProcessError) {
              assert.strictEqual(pluginLoadTrial.failure.reason, "incomplete-stream");
              assert.notInclude(
                collectPublicStrings(pluginLoadTrial.failure).join("\n"),
                "failed to load plugin",
              );
            }
          }
        }),
    );

    it.effect(
      "rejects noncanonical catalog evidence and invalid options before invoking the runner",
      () =>
        Effect.gen(function* () {
          let invoked = false;
          const runner: ClaudeCliTrialRunner = {
            run: () => {
              invoked = true;
              return Effect.succeed(fixtureResult);
            },
          };
          const catalogResult = yield* Effect.result(
            runClaudeCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              availableTools: listCatalogToolNames().slice(1),
              parentEnvironment: {},
              runner,
            }),
          );
          assert.isFalse(invoked);
          assert.strictEqual(catalogResult._tag, "Failure");
          if (catalogResult._tag === "Failure") {
            assert.instanceOf(catalogResult.failure, PluginEvalClaudeCliSpawnError);
            if (catalogResult.failure instanceof PluginEvalClaudeCliSpawnError) {
              assert.strictEqual(catalogResult.failure.reason, "catalog-mismatch");
            }
          }

          const maxTurnsResult = yield* Effect.result(
            runClaudeCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              maxTurns: 33,
              parentEnvironment: {},
              runner,
            }),
          );
          assert.isFalse(invoked);
          assert.strictEqual(maxTurnsResult._tag, "Failure");
          if (maxTurnsResult._tag === "Failure") {
            assert.instanceOf(maxTurnsResult.failure, PluginEvalClaudeCliSpawnError);
            if (maxTurnsResult.failure instanceof PluginEvalClaudeCliSpawnError) {
              assert.strictEqual(maxTurnsResult.failure.reason, "invalid-options");
            }
          }

          const reasoningResult = yield* Effect.result(
            runClaudeCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              reasoning: "turbo",
              parentEnvironment: {},
              runner,
            }),
          );
          assert.isFalse(invoked);
          assert.strictEqual(reasoningResult._tag, "Failure");
          if (reasoningResult._tag === "Failure") {
            assert.instanceOf(reasoningResult.failure, PluginEvalClaudeCliSpawnError);
            assert.notInclude(collectPublicStrings(reasoningResult.failure).join("\n"), "turbo");
          }
        }),
    );
  });
});

describe("Claude CLI environment allowlist", () => {
  it.effect("drops provider, cloud, registry, GitHub, SSH, proxy, and repository secrets", () =>
    Effect.sync(() => {
      const environment = buildClaudeCliEnvironment({
        PATH: "/bin",
        HOME: "/home/eval",
        SystemRoot: "C:\\Windows",
        LC_ALL: "C",
        TEMP: "C:\\Temp",
        ANTHROPIC_API_KEY: "provider",
        GOOGLE_APPLICATION_CREDENTIALS: "cloud",
        NPM_CONFIG_TOKEN: "registry",
        GH_TOKEN: "github",
        SSH_PRIVATE_KEY: "ssh",
        ALL_PROXY: "proxy",
        REPOSITORY_SECRET: "repo",
      });

      assert.deepStrictEqual(environment, {
        PATH: "/bin",
        HOME: "/home/eval",
        SystemRoot: "C:\\Windows",
        LC_ALL: "C",
        TEMP: "C:\\Temp",
      });
    }),
  );
});
