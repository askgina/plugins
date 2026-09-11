import type {
  HarnessAgentAdapter,
  HarnessAgentSession,
  HarnessAgentSettings,
} from "@ai-sdk/harness/agent";
import type { ListToolsResult } from "@ai-sdk/mcp";
import type { JSONSchema7 } from "@ai-sdk/provider";
import {
  GINA_CONNECTED_TOOL_NAMES,
  GINA_DYNAMIC_WIDGET_TOOL,
  listCatalogToolNames,
  SKILL_NAMES,
} from "@askgina/contracts";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { jsonSchema, type GenerateTextResult, type StepResult, type ToolSet } from "ai";
import { DateTime, Effect, FileSystem, Layer, Path, Redacted } from "effect";
import { beforeEach, vi } from "vitest";

import { gradePluginEvalObservation } from "../src/grading";
import { loadPluginEvalSuite } from "../src/load-suite";
import { runOmpHarnessPluginEvalTrial } from "../src/omp-harness";

const fixture = vi.hoisted(() => ({ failedRead: false }));
const PRICE_TOOL = "spot.getSimplePrice";
const PRICE_ARGUMENTS = { ids: "ethereum", vs_currencies: "usd" };
const PRICE_RESULT = {
  content: [{ type: "text", text: '{"ethereum":{"usd":3200}}' }],
};
const SKILL_CONTENT = "Use canonical read-only market tools.\n";
const PRICE_SCHEMA = {
  type: "object",
  properties: {
    ids: { type: "string" },
    vs_currencies: { type: "string" },
  },
  required: ["ids", "vs_currencies"],
  additionalProperties: false,
} satisfies JSONSchema7;

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(() =>
    Promise.resolve({
      listTools: (): Promise<ListToolsResult> =>
        Promise.resolve({
          tools: GINA_CONNECTED_TOOL_NAMES.map((name) => ({
            name,
            inputSchema: name === PRICE_TOOL ? PRICE_SCHEMA : { type: "object" },
          })),
        }),
      toolsFromDefinitions: (definitions: ListToolsResult): ToolSet => {
        assert.notInclude(
          definitions.tools.map(({ name }) => name),
          GINA_DYNAMIC_WIDGET_TOOL,
        );
        return Object.fromEntries(
          definitions.tools.map(({ name }) => [
            name,
            {
              inputSchema: jsonSchema(name === PRICE_TOOL ? PRICE_SCHEMA : { type: "object" }),
              execute: () =>
                name === PRICE_TOOL
                  ? Promise.resolve(PRICE_RESULT)
                  : Promise.reject(new Error(`Unexpected fixture tool: ${name}`)),
            },
          ]),
        );
      },
      close: () => Promise.resolve(),
    }),
  ),
}));

vi.mock("@ai-sdk/harness-acp", () => ({
  createACP: vi.fn(() => ({})),
}));

type AgentSettings = HarnessAgentSettings<HarnessAgentAdapter, ToolSet>;
type GenerationEvidence = Pick<
  GenerateTextResult<ToolSet, Record<string, unknown>, never>,
  "text" | "finishReason" | "usage" | "steps"
>;

// Use actual SDK field types without casting partial objects to StepResult.
const sdkStep = (
  stepNumber: number,
  content: StepResult<ToolSet>["content"],
): StepResult<ToolSet> => {
  const toolCalls = content.filter((part) => part.type === "tool-call");
  const toolResults = content.filter((part) => part.type === "tool-result");
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  return {
    callId: "fixture-generation",
    stepNumber,
    model: { provider: "fixture", modelId: "fixture-model" },
    toolsContext: {},
    runtimeContext: {},
    content,
    text,
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls,
    staticToolCalls: toolCalls.filter((call) => call.dynamic !== true),
    dynamicToolCalls: toolCalls.filter((call) => call.dynamic === true),
    toolResults,
    staticToolResults: toolResults.filter((result) => result.dynamic !== true),
    dynamicToolResults: toolResults.filter((result) => result.dynamic === true),
    finishReason: text.length === 0 ? "tool-calls" : "stop",
    rawFinishReason: undefined,
    usage: {
      inputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 0,
    },
    performance: {
      effectiveOutputTokensPerSecond: 0,
      outputTokensPerSecond: undefined,
      inputTokensPerSecond: undefined,
      effectiveTotalTokensPerSecond: 0,
      stepTimeMs: 0,
      responseTimeMs: 0,
      toolExecutionMs: {},
      timeToFirstOutputMs: undefined,
    },
    warnings: [],
    request: {},
    response: {
      messages: [],
      id: `fixture-response-${stepNumber}`,
      timestamp: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-10T00:00:00.000Z")),
      modelId: "fixture-model",
    },
    providerMetadata: undefined,
  };
};

vi.mock("@ai-sdk/harness/agent", () => ({
  HarnessAgent: class {
    readonly settings: AgentSettings;
    readonly tools: ToolSet;

    constructor(settings: AgentSettings) {
      if (settings.tools === undefined) throw new Error("Missing model-facing host tools");
      assert.notProperty(settings.tools, GINA_DYNAMIC_WIDGET_TOOL);
      assert.sameMembers(Object.keys(settings.tools), [...listCatalogToolNames()]);
      this.settings = settings;
      this.tools = settings.tools;
    }

    createSession(options: { readonly abortSignal?: AbortSignal }) {
      const sandbox = this.settings.sandbox;
      if (sandbox === undefined) throw new Error("Missing filesystem sandbox");
      // Register the real sandbox cleanup; never install or spawn the ACP process.
      return Promise.resolve(sandbox.createSession(options)).then(
        (session) =>
          ({
            destroy: () => Promise.resolve(session.destroy()),
          }) satisfies Pick<HarnessAgentSession, "destroy">,
      );
    }

    generate(): Promise<GenerationEvidence> {
      const readCall = {
        type: "tool-call",
        toolCallId: "native-skill-read",
        toolName: "read",
        input: { path: "skill://research-spot-tokens" },
        providerExecuted: true,
      } satisfies StepResult<ToolSet>["toolCalls"][number];
      const readOutcome: StepResult<ToolSet>["content"][number] = fixture.failedRead
        ? { ...readCall, type: "tool-error", error: new Error("Fixture skill read failed") }
        : { ...readCall, type: "tool-result", output: SKILL_CONTENT };
      const priceCall = {
        type: "tool-call",
        toolCallId: "host-price-call",
        toolName: PRICE_TOOL,
        input: PRICE_ARGUMENTS,
        providerExecuted: false,
      } satisfies StepResult<ToolSet>["toolCalls"][number];
      const price = this.tools[PRICE_TOOL];
      if (price?.execute === undefined) throw new Error("Missing executable price host tool");
      return Promise.resolve(
        price.execute(PRICE_ARGUMENTS, {
          toolCallId: priceCall.toolCallId,
          messages: [],
          context: {},
        }),
      ).then((output) => {
        const steps = [
          sdkStep(0, [readCall, readOutcome]),
          sdkStep(1, [priceCall, { ...priceCall, type: "tool-result", output }]),
          sdkStep(2, [{ type: "text", text: "Ethereum is $3,200 USD." }]),
        ];
        const finalStep = steps[2];
        if (finalStep === undefined) throw new Error("Missing final SDK step");
        return {
          text: finalStep.text,
          finishReason: finalStep.finishReason,
          usage: finalStep.usage,
          steps,
        };
      });
    }
  },
}));

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

const runPriceTrial = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "omp-read-evidence-" });
  const agentDirectory = path.join(runtimeDirectory, "native-profile");
  yield* fs.makeDirectory(agentDirectory);
  for (const name of SKILL_NAMES) {
    const directory = path.join(runtimeDirectory, "skills", name);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Canonical skill fixture.\n---\n${SKILL_CONTENT}`,
    );
  }
  const suite = yield* loadPluginEvalSuite(
    path.join(process.cwd(), "plugins/ask-gina/evals/model/v1/families/spot.yaml"),
  );
  const evalCase = suite.cases.find((candidate) => candidate.id === "spot-simple-price");
  if (evalCase === undefined) return yield* Effect.die("Missing spot-simple-price suite case");
  const observation = yield* runOmpHarnessPluginEvalTrial(evalCase, {
    runId: "omp-read-evidence",
    repetition: 1,
    availableTools: GINA_CONNECTED_TOOL_NAMES,
    runtimeDirectory,
    auth: { mode: "native", provider: "fixture", agentDirectory },
    model: "fixture-model",
    reasoning: "off",
    mcpAuthorization: Redacted.make("synthetic-mcp-authorization"),
    timeoutMs: 30_000,
  });
  const score = yield* gradePluginEvalObservation(evalCase, observation);
  return { observation, score };
});

describe("OMP harness native read evidence", () => {
  beforeEach(() => {
    fixture.failedRead = false;
  });

  it.layer(TestPlatformLayer)((it) => {
    it.effect("grades a native skill read followed by Gina price as one canonical tool call", () =>
      Effect.gen(function* () {
        const { observation, score } = yield* runPriceTrial;

        assert.strictEqual(score.routing.score, 1);
        assert.strictEqual(score.arguments.score, 1);
        assert.isTrue(score.overall_pass);
        assert.strictEqual(observation.status, "completed");
        assert.deepStrictEqual(observation.activated_skills, ["research-spot-tokens"]);
      }),
    );

    it.effect(
      "keeps a failed native skill read incomplete without contaminating Gina routing",
      () =>
        Effect.gen(function* () {
          fixture.failedRead = true;
          const { observation, score } = yield* runPriceTrial;

          assert.strictEqual(observation.status, "failed");
          assert.deepStrictEqual(observation.activated_skills, []);
          assert.strictEqual(score.completion.score, 0);
          assert.isFalse(score.overall_pass);
          assert.strictEqual(score.routing.score, 1);
          assert.strictEqual(score.arguments.score, 1);
        }),
    );
  });
});
