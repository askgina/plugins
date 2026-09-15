import { describe, expect, test } from "vitest";
import {
  available,
  CHECK_NAMES,
  NOT_RETAINED,
  type CheckDimensionSummary,
  type CheckName,
} from "../src/canonical/canonical";
import {
  buildCheckDimensionView,
  CHECK_AXIS_LABELS,
  evaluatedCheckRate,
  MIN_RADAR_AXES,
  type CheckDimensionSeriesInput,
} from "../src/canonical/radar-axes";

const none: CheckDimensionSummary = {
  passed: 0,
  failed: 0,
  notApplicable: 12,
  notEvaluated: 0,
};

function counts(
  passed: number,
  failed: number,
  notApplicable: number | null = 0,
  notEvaluated: number | null = 0,
): CheckDimensionSummary {
  return { passed, failed, notApplicable, notEvaluated };
}

function dimensions(
  overrides: Partial<Record<CheckName, CheckDimensionSummary>> = {},
): Record<CheckName, CheckDimensionSummary> {
  return {
    routing: counts(10, 2),
    arguments: counts(9, 3),
    safety: counts(12, 0),
    completion: counts(8, 4),
    skillActivation: counts(11, 1),
    ...overrides,
  };
}

function series(
  key: string,
  dims: Record<CheckName, CheckDimensionSummary>,
  label = key,
): CheckDimensionSeriesInput {
  return { key, label, dimensions: available(dims) };
}

describe("evaluatedCheckRate", () => {
  test("returns null when a check was never passed or failed", () => {
    expect(evaluatedCheckRate(none)).toBeNull();
    expect(
      evaluatedCheckRate({
        passed: 0,
        failed: 0,
        notApplicable: null,
        notEvaluated: 12,
      }),
    ).toBeNull();
  });

  test("does not treat n/a or not_evaluated as failures", () => {
    expect(evaluatedCheckRate(counts(11, 1, 4, 2))).toBe((100 * 11) / 12);
  });

  test("does not round 11/12", () => {
    expect(evaluatedCheckRate(counts(11, 1))).toBe((100 * 11) / 12);
    expect(evaluatedCheckRate(counts(11, 1))).not.toBe(92);
    expect(evaluatedCheckRate(counts(11, 1))).not.toBe(91.67);
  });
});

describe("buildCheckDimensionView", () => {
  test("empty series is unavailable", () => {
    expect(buildCheckDimensionView([])).toEqual({
      kind: "unavailable",
      reason: "no series",
    });
  });

  test("unavailable evidence names the series key and availability", () => {
    const view = buildCheckDimensionView([
      { key: "left", label: "Left", dimensions: NOT_RETAINED },
    ]);
    expect(view).toEqual({
      kind: "unavailable",
      reason: "left dimensions not_retained",
    });
  });

  test("table lists every CHECK_NAMES entry in order", () => {
    const view = buildCheckDimensionView([series("run", dimensions())]);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.table.map((row) => row.check)).toEqual([...CHECK_NAMES]);
    expect(view.table.map((row) => row.label)).toEqual(
      CHECK_NAMES.map((check) => CHECK_AXIS_LABELS[check]),
    );
  });

  test("n/a-only checks stay in the table with a null rate and never plot 0", () => {
    const view = buildCheckDimensionView([series("run", dimensions({ skillActivation: none }))]);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;

    const skill = view.table.find((row) => row.check === "skillActivation")?.cells.run;
    expect(skill).toBeDefined();
    expect(skill?.ratePct).toBeNull();
    expect(skill?.passed).toBe(0);
    expect(skill?.failed).toBe(0);
    expect(skill?.notApplicable).toBe(12);

    expect(view.omitted).toEqual(["skillActivation"]);
    expect(view.chart?.map((point) => point.check)).toEqual([
      "routing",
      "arguments",
      "safety",
      "completion",
    ]);
    expect(view.chart?.some((point) => point.check === "skillActivation")).toBe(false);
    for (const point of view.chart ?? []) {
      expect(point.values.run).not.toBe(0);
      expect(Object.keys(point.values)).toEqual(["run"]);
    }
  });

  test("records the unrounded 11/12 rate on the table and chart", () => {
    const view = buildCheckDimensionView([series("run", dimensions({ routing: counts(11, 1) }))]);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    const rate = (100 * 11) / 12;
    const routing = view.table[0]?.cells.run;
    const routingPoint = view.chart?.[0];
    expect(routing?.ratePct).toBe(rate);
    expect(routingPoint?.values.run).toBe(rate);
    expect(routingPoint?.samples.run).toEqual({ passed: 11, failed: 1 });
  });

  test("compare intersection drops a spoke the other side did not evaluate", () => {
    const left = series("left", dimensions({ skillActivation: counts(5, 1) }), "Left");
    const right = series("right", dimensions({ skillActivation: none }), "Right");
    const view = buildCheckDimensionView([left, right]);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;

    expect(view.omitted).toEqual(["skillActivation"]);
    expect(view.chart?.map((point) => point.check)).not.toContain("skillActivation");
    expect(view.table.find((row) => row.check === "skillActivation")?.cells).toEqual({
      left: {
        passed: 5,
        failed: 1,
        notApplicable: 0,
        notEvaluated: 0,
        ratePct: (100 * 5) / 6,
      },
      right: {
        passed: 0,
        failed: 0,
        notApplicable: 12,
        notEvaluated: 0,
        ratePct: null,
      },
    });
    for (const point of view.chart ?? []) {
      expect(point.values).toEqual({
        left: expect.any(Number),
        right: expect.any(Number),
      });
      expect(point.values.right).not.toBe(0);
    }
  });

  test("chart is null when fewer than MIN_RADAR_AXES checks are shared", () => {
    expect(MIN_RADAR_AXES).toBe(3);
    const view = buildCheckDimensionView([
      series(
        "run",
        dimensions({
          routing: counts(10, 2),
          arguments: counts(9, 3),
          safety: none,
          completion: none,
          skillActivation: none,
        }),
      ),
    ]);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.chart).toBeNull();
    expect(view.table).toHaveLength(CHECK_NAMES.length);
    expect(view.omitted).toEqual(["safety", "completion", "skillActivation"]);
  });

  test("never 0-fills a check that the other series did not evaluate", () => {
    const view = buildCheckDimensionView([
      series("left", dimensions({ safety: none })),
      series("right", dimensions({ completion: none })),
    ]);
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.chart?.map((point) => point.check)).toEqual([
      "routing",
      "arguments",
      "skillActivation",
    ]);
    expect(view.omitted).toEqual(["safety", "completion"]);
    for (const point of view.chart ?? []) {
      expect(Object.keys(point.values).sort()).toEqual(["left", "right"]);
      expect(point.values.left).not.toBeNull();
      expect(point.values.right).not.toBeNull();
    }
    expect(view.table.find((row) => row.check === "safety")?.cells.left?.ratePct).toBeNull();
    expect(view.table.find((row) => row.check === "completion")?.cells.right?.ratePct).toBeNull();
  });
});
