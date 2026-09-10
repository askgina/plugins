import { PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { ALPHA_GINA_READ_SERVER_URL, isAllowedGinaReadServerUrl } from "../src/server-url";

describe("allowed Gina read server URLs", () => {
  it.effect("accepts only the exact production and alpha Gina MCP URLs", () =>
    Effect.sync(() => {
      assert.isTrue(isAllowedGinaReadServerUrl(PRODUCTION_MCP_URL));
      assert.isTrue(isAllowedGinaReadServerUrl(ALPHA_GINA_READ_SERVER_URL));
    }),
  );

  it.effect("rejects userinfo, query, hash, port, slash, encoding, and local hosts", () =>
    Effect.sync(() => {
      const rejected = [
        `${PRODUCTION_MCP_URL}/`,
        `${ALPHA_GINA_READ_SERVER_URL}/`,
        "https://askgina.ai:443/ai/gina/mcp",
        "https://alpha.askgina.ai:443/ai/gina/mcp",
        "https://askgina.ai/ai/gina/mcp?",
        "https://askgina.ai/ai/gina/mcp?x=1",
        "https://askgina.ai/ai/gina/mcp#",
        "https://askgina.ai/ai/gina/mcp#frag",
        ["https://user", "@askgina.ai/ai/gina/mcp"].join(""),
        ["https://user", ":pass@askgina.ai/ai/gina/mcp"].join(""),
        "http://askgina.ai/ai/gina/mcp",
        "https://AskGina.ai/ai/gina/mcp",
        "https://askgina.ai/ai/gina/%6dcp",
        "https://askgina.ai/ai/gina/mcp%2F",
        "https://askgina.ai/ai/gina/mcp ",
        " https://askgina.ai/ai/gina/mcp",
        ["https:/", "/localhost/ai/gina/mcp"].join(""),
        ["http:/", "/127.0.0.1/ai/gina/mcp"].join(""),
        ["https:/", "/127.0.0.1/ai/gina/mcp"].join(""),
        "https://preview.askgina.ai/ai/gina/mcp",
        "",
      ];
      for (const value of rejected) {
        assert.isFalse(isAllowedGinaReadServerUrl(value));
      }
    }),
  );
});
