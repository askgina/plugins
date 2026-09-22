import { describe, expect, it } from "vitest";
import { isCompletedModelArgumentFailure } from "../grok47-model-error-classification";

const tool = "perps.createHyperliquidTable";
const observation = {
  status: "failed",
  error: "OMP tool execution failed",
  tool_calls: [{ name: tool, error: { message: "MCP tool call failed" } }],
};
const score = {
  overall_pass: false,
  routing: { score: 0 },
  arguments: { score: 1 },
  completion: { score: 0 },
};
const result = (code = "INVALID_ARGUMENTS", id = "call-1") => ({
  type: "message",
  message: {
    role: "toolResult",
    toolName: "mcp__ai_sdk_harness_tools_perps_createhyperliquidtable",
    toolCallId: id,
    isError: false,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          isError: true,
          content: [{ type: "text", text: `Error (${code}): The tool call failed.` }],
        }),
      },
    ],
  },
});
const final = { type: "message", message: { role: "assistant", stopReason: "stop" } };
const classify = (records: readonly unknown[]) =>
  isCompletedModelArgumentFailure(observation, records, score);

describe("completed model argument failures", () => {
  it("grades a completed wrong-tool attempt without rewriting evidence or scores", () => {
    const records = [result(), final];
    const before = JSON.stringify({ observation, records, score });
    expect(classify(records)).toBe(true);
    expect(JSON.stringify({ observation, records, score })).toBe(before);
  });
  it("requires every repeated invalid call to have distinct matching evidence", () => {
    const repeated = {
      ...observation,
      tool_calls: [...observation.tool_calls, ...observation.tool_calls],
    };
    expect(
      isCompletedModelArgumentFailure(
        repeated,
        [result(), result("INVALID_ARGUMENTS", "call-2"), final],
        score,
      ),
    ).toBe(true);
    expect(isCompletedModelArgumentFailure(repeated, [result(), final], score)).toBe(false);
    expect(isCompletedModelArgumentFailure(repeated, [result(), result(), final], score)).toBe(
      false,
    );
    expect(classify([result(), result("INVALID_ARGUMENTS", "call-2"), final])).toBe(false);
  });
  it.each(["CONTRACT_MISMATCH", "NOT_FOUND", "UPSTREAM_FAILURE", "UNAUTHORIZED", "UNKNOWN"])(
    "leaves backend error %s ungraded",
    (code) => expect(classify([result(code), final])).toBe(false),
  );
  it("rejects incomplete, provider-error, and native process-error sessions", () => {
    expect(classify([result()])).toBe(false);
    expect(
      classify([
        result(),
        { type: "message", message: { role: "assistant", stopReason: "toolUse" } },
      ]),
    ).toBe(false);
    expect(
      classify([
        {
          type: "message",
          message: { role: "assistant", stopReason: "error", errorMessage: "Unavailable" },
        },
        result(),
        final,
      ]),
    ).toBe(false);
    const native = result();
    native.message.isError = true;
    expect(classify([native, final])).toBe(false);
    expect(classify([final, result()])).toBe(false);
  });
  it("rejects mixed backend failures and unknown or malformed error payloads", () => {
    expect(classify([result(), result("UPSTREAM_FAILURE", "call-2"), final])).toBe(false);
    const unknown = result();
    unknown.message.toolName = "unknown";
    expect(classify([unknown, final])).toBe(false);
    const malformed = result();
    malformed.message.content = [{ type: "text", text: "invalid JSON" }];
    expect(classify([malformed, final])).toBe(false);
  });
  it("does not blame the model for schema/backend drift without an independent grader failure", () => {
    expect(
      isCompletedModelArgumentFailure(observation, [result(), final], {
        ...score,
        routing: { score: 1 },
      }),
    ).toBe(false);
    expect(
      isCompletedModelArgumentFailure(observation, [result(), final], {
        ...score,
        overall_pass: true,
      }),
    ).toBe(false);
    expect(
      isCompletedModelArgumentFailure(
        { ...observation, status: "completed" },
        [result(), final],
        score,
      ),
    ).toBe(false);
    expect(
      isCompletedModelArgumentFailure({ ...observation, tool_calls: [] }, [result(), final], score),
    ).toBe(false);
  });
});
