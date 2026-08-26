import * as BunServices from "@effect/platform-bun/BunServices";
import { listCatalogToolNames } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Redacted, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";

import {
  attestCodexExecutable,
  buildCodexCliEnvironment,
  type AttestedCodexExecutable,
  type CodexCliCommand,
  type CodexCliTrialRunner,
  extractAskGinaActivatedSkills,
  parseCodexExecJsonl,
  PluginEvalCodexCliExecutableError,
  PluginEvalCodexCliProcessError,
  PluginEvalCodexCliSpawnError,
  PluginEvalCodexCliTimeoutError,
  runCodexCliPluginEvalTrial,
} from "../src/codex-cli.js";
import { collectBoundedUtf8Output } from "../src/bounded-output.js";
import type { PluginEvalCase } from "../src/contracts.js";

const ASK_GINA_SKILL_PATH =
  "/home/eval/.codex/plugins/cache/personal/ask-gina/0.1.0/skills/research-spot-tokens/SKILL.md";
const ASK_GINA_PLUGIN_SKILL_ROOT = "/home/eval/.codex/plugins/cache/personal/ask-gina/0.1.0/skills";
const HOST_SKILL_PATH = "/home/eval/.agents/skills/find-skills/SKILL.md";
const TEST_API_KEY = Redacted.make("synthetic-openai-key");
const WORKING_DIRECTORY = ["", "tmp", "ask-gina-eval", "work"].join("/");
const CODEX_HOME = ["", "tmp", "ask-gina-eval", "home"].join("/");
const TEST_EXECUTABLE: AttestedCodexExecutable = {
  path: "/opt/trusted/codex",
  sha256: "a".repeat(64),
  dev: 1,
  ino: 2,
  mode: 0o755,
  size: 100n,
};

const trialOptions = {
  runId: "run-read-only",
  repetition: 1,
  availableTools: listCatalogToolNames(),
  workingDirectory: WORKING_DIRECTORY,
  openAiApiKey: TEST_API_KEY,
  executable: TEST_EXECUTABLE,
  codexHome: CODEX_HOME,
  pluginId: "ask-gina@ask-gina-plugins",
  pluginSkillRoot: ASK_GINA_PLUGIN_SKILL_ROOT,
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
const JsonString = Schema.fromJsonString(Schema.String);
const encodeJsonString = Schema.encodeSync(JsonString);

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

describe("Codex CLI JSONL evidence", () => {
  it.effect("records only Ask Gina skill-path reads and completed Gina tool calls", () =>
    Effect.sync(() => {
      assert.strictEqual(
        extractAskGinaActivatedSkills(ASK_GINA_SKILL_PATH),
        "research-spot-tokens",
      );
      assert.isUndefined(extractAskGinaActivatedSkills(HOST_SKILL_PATH));

      const parsed = parseCodexExecJsonl(
        jsonl(
          {
            type: "item.started",
            item: {
              type: "command_execution",
              command: `sed -n '1,200p' ${ASK_GINA_SKILL_PATH}`,
            },
          },
          {
            type: "item.completed",
            item: {
              type: "command_execution",
              command: `sed -n '1,200p' ${ASK_GINA_SKILL_PATH}`,
            },
          },
          {
            type: "item.completed",
            item: {
              type: "command_execution",
              command: `cat "${ASK_GINA_SKILL_PATH}"`,
            },
          },
          {
            type: "item.completed",
            item: {
              type: "command_execution",
              command: `cat ${HOST_SKILL_PATH}`,
            },
          },
          {
            type: "item.completed",
            item: {
              type: "mcp_tool_call",
              server: "gina",
              tool: "spot.getSimplePrice",
              arguments: { ids: "ethereum", vs_currencies: "usd" },
              result: { ethereum: { usd: 1 } },
              error: null,
              status: "completed",
            },
          },
          {
            type: "item.completed",
            item: {
              type: "mcp_tool_call",
              server: "ask-gina",
              tool: "gina.getAccountAddresses",
              arguments: {},
              result: {},
              status: "completed",
            },
          },
          {
            type: "item.completed",
            item: {
              type: "mcp_tool_call",
              server: "attacker",
              tool: "spot.getSimplePrice",
              arguments: { ids: "ethereum", vs_currencies: "usd" },
              result: { ethereum: { usd: 1 } },
              status: "completed",
            },
          },
          {
            type: "item.completed",
            item: { type: "agent_message", text: "ETH is $1." },
          },
          {
            type: "turn.completed",
            usage: { input_tokens: 10, output_tokens: 4 },
          },
        ),
        ASK_GINA_PLUGIN_SKILL_ROOT,
      );

      assert.deepStrictEqual(parsed.activated_skills, ["research-spot-tokens"]);
      assert.strictEqual(parsed.tool_calls.length, 2);
      assert.strictEqual(parsed.unsupported_actions, 2);
      assert.strictEqual(parsed.tool_calls[0]?.name, "spot.getSimplePrice");
      assert.isUndefined(parsed.tool_calls[0]?.error);
      assert.deepStrictEqual(parsed.tool_calls[0]?.arguments, {
        ids: "ethereum",
        vs_currencies: "usd",
      });
      assert.strictEqual(parsed.tool_calls[1]?.name, "gina.getAccountAddresses");
      assert.strictEqual(parsed.final_answer, "ETH is $1.");
      assert.deepStrictEqual(parsed.token_usage, {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
      });
    }),
  );

  it.effect("bounds streamed output by bytes while draining later chunks", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();
      let drainedAfterLimit = false;
      const bounded = yield* collectBoundedUtf8Output(
        Stream.make(encoder.encode("abc"), encoder.encode("def")).pipe(
          Stream.concat(
            Stream.fromEffect(
              Effect.sync(() => {
                drainedAfterLimit = true;
                return encoder.encode("ghi");
              }),
            ),
          ),
        ),
        5,
      );

      assert.strictEqual(bounded.byteLength, 5);
      assert.strictEqual(bounded.text, "abcde");
      assert.isTrue(bounded.truncated);
      assert.isTrue(drainedAfterLimit);
    }),
  );
  it.effect("does not treat an advertised skill path as activation evidence", () =>
    Effect.sync(() => {
      const parsed = parseCodexExecJsonl(
        jsonl({
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: `Available skill: ${ASK_GINA_SKILL_PATH}` }],
          },
        }),
        ASK_GINA_PLUGIN_SKILL_ROOT,
      );

      assert.deepStrictEqual(parsed.activated_skills, []);
    }),
  );
});

describe("Codex CLI trial adapter", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("rejects forbidden and substituted Codex executables", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "codex-attestation-test-" });
        const firstPath = `${root}/codex-first`;
        const secondPath = `${root}/codex-second`;
        const linkPath = `${root}/codex`;
        const firstBytes = Uint8Array.of(0x7f, 0x45, 0x4c, 0x46, 1, 2, 3);
        const secondBytes = Uint8Array.of(0x7f, 0x45, 0x4c, 0x46, 4, 5, 6);
        const firstSha256 = "22b943d127b7b41a8abae568e088d3faa73b822d5cc84439059c0b1f13ba5f02";
        yield* Effect.all([
          fs.writeFile(firstPath, firstBytes),
          fs.writeFile(secondPath, secondBytes),
        ]);
        yield* Effect.all([fs.chmod(firstPath, 0o755), fs.chmod(secondPath, 0o755)]);
        yield* fs.symlink(firstPath, linkPath);

        const attested = yield* attestCodexExecutable({
          executablePath: linkPath,
          expectedSha256: firstSha256,
        });
        assert.strictEqual(attested.path, firstPath);

        const forbidden = yield* Effect.result(
          attestCodexExecutable({
            executablePath: firstPath,
            expectedSha256: firstSha256,
            forbiddenRoots: [root],
          }),
        );
        assert.strictEqual(forbidden._tag, "Failure");
        if (forbidden._tag === "Failure") {
          assert.instanceOf(forbidden.failure, PluginEvalCodexCliExecutableError);
          assert.strictEqual(forbidden.failure.reason, "forbidden-path");
        }

        yield* fs.remove(linkPath);
        yield* fs.symlink(secondPath, linkPath);
        const substituted = yield* Effect.result(
          attestCodexExecutable({
            executablePath: linkPath,
            expectedSha256: firstSha256,
          }),
        );
        assert.strictEqual(substituted._tag, "Failure");
        if (substituted._tag === "Failure") {
          assert.instanceOf(substituted.failure, PluginEvalCodexCliExecutableError);
          assert.strictEqual(substituted.failure.reason, "digest-mismatch");
        }
        yield* fs.writeFile(firstPath, secondBytes);
        const replacedBeforeSpawn = yield* Effect.result(
          runCodexCliPluginEvalTrial(evalCase, {
            ...trialOptions,
            workingDirectory: root,
            codexHome: root,
            executable: attested,
            parentEnvironment: {},
          }),
        );
        assert.strictEqual(replacedBeforeSpawn._tag, "Failure");
        if (replacedBeforeSpawn._tag === "Failure") {
          assert.instanceOf(replacedBeforeSpawn.failure, PluginEvalCodexCliExecutableError);
          assert.strictEqual(replacedBeforeSpawn.failure.reason, "digest-mismatch");
        }
      }),
    );

    it.effect("uses read-only argv and passes only the allowlisted environment", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(CODEX_HOME, { recursive: true });
        yield* fs.writeFileString(
          `${CODEX_HOME}/config.toml`,
          '[mcp_servers.attacker]\nenabled = true\n[mcp_servers.gina]\nenabled = true\nmcp_servers.dotted.url = "https://example.invalid/mcp"\n',
          { flag: "w", mode: 0o600 },
        );
        let captured: CodexCliCommand | undefined;
        const runner: CodexCliTrialRunner = {
          run: (command) =>
            Effect.sync(() => {
              captured = command;
              return fixtureResult;
            }),
        };
        const parentEnvironment = {
          PATH: "/usr/bin:/bin",
          HOME: "/home/eval",
          CODEX_HOME: "/home/eval/.codex-eval",
          LANG: "C.UTF-8",
          TERM: "xterm-256color",
          TMPDIR: "/tmp",
          XDG_CONFIG_HOME: "/home/eval/.config",
          CI: "true",
          OPENAI_API_KEY: "provider-secret",
          AWS_SECRET_ACCESS_KEY: "cloud-secret",
          GITHUB_TOKEN: "github-secret",
          SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
          HTTPS_PROXY: "http://proxy-secret",
          NPM_TOKEN: "registry-secret",
          DATABASE_URL: "repo-secret",
        };
        const observedTools = [...listCatalogToolNames()].reverse();

        const observation = yield* runCodexCliPluginEvalTrial(evalCase, {
          ...trialOptions,
          availableTools: observedTools,
          parentEnvironment,
          runner,
        });
        if (captured === undefined) return yield* Effect.die("fixture runner was not invoked");

        assert.strictEqual(captured.command, TEST_EXECUTABLE.path);
        assert.deepStrictEqual(captured.executable, TEST_EXECUTABLE);
        assert.strictEqual(captured.workingDirectory, WORKING_DIRECTORY);
        assert.deepStrictEqual(captured.args.slice(0, 3), ["--profile", "ask-gina-eval", "exec"]);
        assert.notInclude(captured.args, "-s");
        assert.strictEqual(captured.stdin, "pipe");
        assert.strictEqual(captured.input, evalCase.turns[0]?.content);
        assert.notInclude(captured.args, evalCase.turns[0]?.content ?? "");
        assert.isFalse(captured.args.some((argument) => argument.startsWith("mcp_servers.")));
        assert.include(captured.args, 'plugins."ask-gina@ask-gina-plugins".enabled=true');
        assert.include(captured.args, 'approval_policy="never"');
        assert.notInclude(captured.args, "--ignore-user-config");
        assert.include(captured.args, "--ignore-rules");
        assert.include(captured.args, "--strict-config");
        const shellPolicy = captured.args.find((argument) =>
          argument.startsWith("shell_environment_policy.include_only="),
        );
        assert.isDefined(shellPolicy);
        assert.notInclude(shellPolicy ?? "", "OPENAI_API_KEY");
        assert.notInclude(shellPolicy ?? "", "HOME");
        assert.notInclude(shellPolicy ?? "", "XDG_CONFIG_HOME");
        assert.include(captured.args, 'shell_environment_policy.exclude=["OPENAI_API_KEY"]');
        const profile = yield* fs.readFileString(`${CODEX_HOME}/ask-gina-eval.config.toml`);
        assert.include(profile, 'approval_policy = "never"');
        assert.include(profile, 'web_search = "disabled"');
        assert.include(profile, "[features]\napps = false");
        assert.include(profile, '":minimal" = "read"');
        assert.include(profile, `${encodeJsonString(WORKING_DIRECTORY)} = "read"`);
        assert.include(profile, `${encodeJsonString(ASK_GINA_PLUGIN_SKILL_ROOT)} = "read"`);
        assert.include(profile, `${encodeJsonString(CODEX_HOME)} = "deny"`);
        assert.include(profile, '[mcp_servers."dotted"]\nenabled = false');
        assert.include(profile, '[mcp_servers."gina"]\nenabled = false');
        assert.include(
          profile,
          `[plugins.${encodeJsonString(trialOptions.pluginId)}.mcp_servers.gina]`,
        );
        assert.include(
          profile,
          `enabled_tools = [${observedTools.map((tool) => encodeJsonString(tool)).join(", ")}]`,
        );
        assert.deepStrictEqual(captured.environment, {
          PATH: "/usr/bin:/bin",
          HOME: CODEX_HOME,
          CODEX_HOME,
          USERPROFILE: CODEX_HOME,
          LANG: "C.UTF-8",
          TERM: "xterm-256color",
          TMPDIR: "/tmp",
          XDG_CONFIG_HOME: CODEX_HOME,
          XDG_CACHE_HOME: CODEX_HOME,
          XDG_DATA_HOME: CODEX_HOME,
          CI: "true",
          OPENAI_API_KEY: "synthetic-openai-key",
        });
        assert.strictEqual(observation.status, "completed");
        assert.deepStrictEqual(observation.available_tools, observedTools);
        const publicEnvironment = collectPublicStrings(captured.environment).join("\n");
        assert.notInclude(publicEnvironment, "provider-secret");
        assert.notInclude(publicEnvironment, "cloud-secret");
      }),
    );

    it.effect("returns typed spawn and timeout failures without child payload text", () =>
      Effect.gen(function* () {
        const spawnRunner: CodexCliTrialRunner = {
          run: (command) =>
            Effect.fail(
              new PluginEvalCodexCliSpawnError({
                caseId: command.caseId,
                reason: "could_not_start",
              }),
            ),
        };
        const spawnResult = yield* Effect.result(
          runCodexCliPluginEvalTrial(evalCase, {
            ...trialOptions,
            runId: "run-spawn-failure",
            parentEnvironment: { OPENAI_API_KEY: "must-not-leak" },
            runner: spawnRunner,
          }),
        );
        assert.strictEqual(spawnResult._tag, "Failure");
        if (spawnResult._tag === "Failure") {
          assert.instanceOf(spawnResult.failure, PluginEvalCodexCliSpawnError);
          assert.notInclude(collectPublicStrings(spawnResult.failure).join("\n"), "must-not-leak");
        }

        let interrupted = false;
        const timeoutRunner: CodexCliTrialRunner = {
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
            runCodexCliPluginEvalTrial(evalCase, {
              ...trialOptions,
              runId: "run-timeout",
              parentEnvironment: {},
              timeoutMs: 1,
              runner: timeoutRunner,
            }),
          ),
        );
        assert.strictEqual(timeoutResult._tag, "Failure");
        if (timeoutResult._tag === "Failure") {
          assert.instanceOf(timeoutResult.failure, PluginEvalCodexCliTimeoutError);
          assert.isTrue(interrupted);
          if (timeoutResult.failure._tag === "PluginEvalCodexCliTimeoutError") {
            assert.deepStrictEqual(
              {
                caseId: timeoutResult.failure.caseId,
                timeoutMs: timeoutResult.failure.timeoutMs,
              },
              { caseId: evalCase.id, timeoutMs: 1 },
            );
          }
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
              result: { ...fixtureResult, stdout: "not-json\n" },
            },
          ];
          for (const scenario of scenarios) {
            const result = yield* Effect.result(
              runCodexCliPluginEvalTrial(evalCase, {
                ...trialOptions,
                parentEnvironment: {},
                runner: { run: () => Effect.succeed(scenario.result) },
              }),
            );
            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.instanceOf(result.failure, PluginEvalCodexCliProcessError);
              if (result.failure instanceof PluginEvalCodexCliProcessError) {
                assert.strictEqual(result.failure.reason, scenario.reason);
              }
            }
          }

          const unsupported = yield* runCodexCliPluginEvalTrial(evalCase, {
            ...trialOptions,
            parentEnvironment: {},
            runner: {
              run: () =>
                Effect.succeed({
                  ...fixtureResult,
                  stdout: jsonl({
                    type: "item.completed",
                    item: { type: "command_execution", command: "curl example.com" },
                  }),
                }),
            },
          });
          assert.strictEqual(unsupported.status, "failed");
          assert.include(unsupported.error ?? "", "outside the MCP catalog");
        }),
    );

    it.effect("rejects noncanonical catalog evidence before invoking the runner", () =>
      Effect.gen(function* () {
        let invoked = false;
        const result = yield* Effect.result(
          runCodexCliPluginEvalTrial(evalCase, {
            ...trialOptions,
            availableTools: listCatalogToolNames().slice(1),
            parentEnvironment: {},
            runner: {
              run: () => {
                invoked = true;
                return Effect.succeed(fixtureResult);
              },
            },
          }),
        );
        assert.isFalse(invoked);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, PluginEvalCodexCliSpawnError);
          if (result.failure instanceof PluginEvalCodexCliSpawnError) {
            assert.strictEqual(result.failure.reason, "catalog-mismatch");
          }
        }
      }),
    );
  });
});

describe("Codex CLI environment allowlist", () => {
  it.effect("drops provider, cloud, registry, GitHub, SSH, proxy, and repository secrets", () =>
    Effect.sync(() => {
      const environment = buildCodexCliEnvironment({
        PATH: "/bin",
        HOME: "/home/eval",
        SystemRoot: "C:\\Windows",
        LC_ALL: "C",
        TEMP: "C:\\Temp",
        GINA_TOKEN: "provider",
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
