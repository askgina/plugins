import { describe, expect, test } from "vitest";
import { perpsPredictionsReport, spotComparison } from "../src/results";

describe("measured results artifacts", () => {
  test("exports the two perps and predictions runs", () => {
    expect(perpsPredictionsReport.runs).toHaveLength(2);
    expect(perpsPredictionsReport.runs.map((run) => run.runId)).toEqual([
      "perps-openai-oauth-sol-20260911T152450Z",
      "predictions-openai-oauth-sol-durable-20260911T161134Z",
    ]);
    for (const run of perpsPredictionsReport.runs) {
      expect(run.passed + run.failed + run.unscoredTimeouts).toBe(run.dispatched);
    }
  });

  test("exports both spot comparison runs and all attempts", () => {
    expect(spotComparison.runs).toHaveLength(2);
    expect(spotComparison.runs.map((run) => run.label)).toEqual(["GPT-5.5", "GPT-5.6 Sol"]);
    for (const run of spotComparison.runs) {
      expect(run.attempts.attempts).toHaveLength(12);
      expect(run.report.aggregate.overall.total).toBe(12);
    }
  });
});
