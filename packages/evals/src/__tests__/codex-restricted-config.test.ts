import { assert, describe, it } from "@effect/vitest";

import { buildRestrictedCodexConfig } from "../../node_modules/@ai-sdk/harness-codex/src/bridge/restricted";

const RESTRICTED = {
  codexHome: "/lease/codex-home",
  readablePaths: ["/eval"],
  nativeAuth: true,
} as const;

const EXTRA_READ_ROOTS = ["/sandbox"] as const;

const build = (baseConfig: Record<string, unknown>, nativeAuth = true) =>
  buildRestrictedCodexConfig({
    baseConfig,
    restricted: { ...RESTRICTED, nativeAuth },
    extraReadRoots: EXTRA_READ_ROOTS,
  });

const expectRejected = (run: () => unknown): void => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error);
};

describe("restricted Codex caller configuration", () => {
  it("rejects dotted MCP namespaces before a child config is returned", () => {
    expectRejected(() => build({ "mcp_servers.extra.url": "https://example.invalid/mcp" }));
  });

  it("rejects quoted MCP and TOML-shaped keys", () => {
    expectRejected(() => build({ '"mcp_servers"': { url: "https://example.invalid/mcp" } }));
    expectRejected(() => build({ "'mcp_servers.extra'": "https://example.invalid/mcp" }));
    expectRejected(() => build({ 'mcp_servers."extra".url': "https://example.invalid/mcp" }));
  });

  it("rejects MCP, provider, auth, hook, plugin, feature, and sandbox keys", () => {
    expectRejected(() => build({ mcp_servers: { extra: { url: "https://example.invalid/mcp" } } }));
    expectRejected(() => build({ model_provider: "openai" }));
    expectRejected(() => build({ model_providers: { openai: { api_key: "x" } } }));
    expectRejected(() => build({ preferred_auth_method: "apikey" }));
    expectRejected(() => build({ hooks: { after: [] } }));
    expectRejected(() => build({ plugins: { extra: true } }));
    expectRejected(() => build({ features: { apps: true } }));
    expectRejected(() => build({ sandbox_mode: "danger-full-access" }));
  });

  it("rejects invalid values on approved reasoning and output keys", () => {
    expectRejected(() => build({ model_verbosity: "debug" }));
    expectRejected(() => build({ model_reasoning_summary: "enabled" }));
    expectRejected(() => build({ model_verbosity: { nested: "https://example.invalid/mcp" } }));
  });

  it("rejects dotted MCP for non-native restricted sessions", () => {
    expectRejected(() => build({ "mcp_servers.extra.url": "https://example.invalid/mcp" }, false));
  });

  it("keeps approved verbosity and forces detailed reasoning summary", () => {
    const { config } = build({
      model_verbosity: "low",
      model_reasoning_summary: "concise",
    });
    assert.strictEqual(config.model_verbosity, "low");
    assert.strictEqual(config.model_reasoning_summary, "detailed");
    assert.strictEqual(config.approval_policy, "never");
    assert.strictEqual(config.web_search, "disabled");
    assert.ok(!Object.hasOwn(config, "mcp_servers"));
    assert.ok(!Object.hasOwn(config, "model_provider"));
    assert.ok(!Object.hasOwn(config, "mcp_servers.extra.url"));
  });
});
