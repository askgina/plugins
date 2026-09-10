import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  captureOpenRouterGenerationEvidence,
  type OpenRouterGenerationEvidence,
} from "../src/provider-evidence";

const evidenceKeys = [
  "generationId",
  "responseModel",
  "provider",
  "step",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cost",
] as const satisfies ReadonlyArray<keyof OpenRouterGenerationEvidence>;

describe("OpenRouter generation evidence capture", () => {
  it.effect("records observed adapter fields and leaves missing values null", () =>
    Effect.sync(() => {
      const observed = captureOpenRouterGenerationEvidence(
        {
          usage: {
            inputTokens: { total: 0 },
            outputTokens: { total: 0 },
            raw: {
              prompt_tokens: 11,
              completion_tokens: 4,
              total_tokens: 15,
              cost: 0.0025,
            },
          },
          providerMetadata: {
            openrouter: {
              provider: "OpenAI",
              reasoning_details: [{ type: "reasoning.text", text: "hidden-reasoning" }],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0.0025 },
            },
          },
          response: {
            id: "gen-observed-1",
            modelId: "openai/gpt-4o",
            body: { secret: "raw-provider-body" },
          },
          request: { body: { prompt: "full-prompt" } },
          content: [{ type: "text", text: "full-output" }],
        },
        1,
      );

      assert.deepStrictEqual(observed, {
        generationId: "gen-observed-1",
        responseModel: "openai/gpt-4o",
        provider: "OpenAI",
        step: 1,
        inputTokens: 11,
        outputTokens: 4,
        totalTokens: 15,
        cost: 0.0025,
      });
      assert.deepStrictEqual(Object.keys(observed), [...evidenceKeys]);
      assert.strictEqual(
        Object.values(observed).includes("hidden-reasoning") ||
          Object.values(observed).includes("raw-provider-body") ||
          Object.values(observed).includes("full-prompt") ||
          Object.values(observed).includes("full-output"),
        false,
      );
    }),
  );

  it.effect("does not treat requested model, empty provider, or defaulted usage as observed", () =>
    Effect.sync(() => {
      const unavailable = captureOpenRouterGenerationEvidence(
        {
          usage: {
            inputTokens: { total: 0 },
            outputTokens: { total: 0 },
          },
          providerMetadata: {
            openrouter: {
              provider: "",
              reasoning_details: [{ type: "reasoning.text", text: "hidden-reasoning" }],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            },
          },
          response: {
            id: "  ",
            modelId: "openai/gpt-4o",
          },
        },
        2,
      );

      assert.deepStrictEqual(unavailable, {
        generationId: null,
        responseModel: "openai/gpt-4o",
        provider: null,
        step: 2,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cost: null,
      });

      const missingResponse = captureOpenRouterGenerationEvidence({}, 1);
      assert.strictEqual(missingResponse.generationId, null);
      assert.strictEqual(missingResponse.responseModel, null);
      assert.strictEqual(missingResponse.provider, null);
      assert.strictEqual(missingResponse.inputTokens, null);
      assert.strictEqual(missingResponse.cost, null);
      assert.strictEqual(Object.values(missingResponse).includes("openai/gpt-4o"), false);
    }),
  );
});
