import {
  CHECK_NAMES,
  type CheckDimensionSummary,
  type CheckName,
  type Evidence,
} from "./canonical";

/** A radar needs at least three evaluated axes to draw a polygon. */
export const MIN_RADAR_AXES = 3;

export const CHECK_AXIS_LABELS: Readonly<Record<CheckName, string>> = {
  routing: "Routing",
  arguments: "Arguments",
  safety: "Safety",
  completion: "Completion",
  skillActivation: "Skill activation",
};

/**
 * Pass rate over evaluated checks only: passed / (passed + failed).
 * `not_applicable` and `not_evaluated` never enter the denominator, and a
 * check with no pass/fail evidence returns null instead of a fake zero.
 */
export function evaluatedCheckRate(summary: CheckDimensionSummary): number | null {
  const evaluated = summary.passed + summary.failed;
  if (evaluated === 0) {
    return null;
  }
  return (100 * summary.passed) / evaluated;
}

export type CheckDimensionSeriesInput = {
  readonly key: string;
  readonly label: string;
  readonly dimensions: Evidence<Record<CheckName, CheckDimensionSummary>>;
};

export type CheckDimensionTableCell = {
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number | null;
  readonly notEvaluated: number | null;
  readonly ratePct: number | null;
};

export type CheckDimensionTableRow = {
  readonly check: CheckName;
  readonly label: string;
  readonly cells: Readonly<Record<string, CheckDimensionTableCell>>;
};

export type CheckDimensionRadarPoint = {
  readonly check: CheckName;
  readonly label: string;
  /** Series key -> evaluated pass rate, 0-100. Never zero-filled. */
  readonly values: Readonly<Record<string, number>>;
  /** Series key -> the counts behind the rate, for tooltips. */
  readonly samples: Readonly<Record<string, { passed: number; failed: number }>>;
};

export type CheckDimensionView =
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "ready";
      /** null when fewer than MIN_RADAR_AXES checks are evaluated on every series. */
      readonly chart: readonly CheckDimensionRadarPoint[] | null;
      /** Every check in CHECK_NAMES order; the accessible source of truth. */
      readonly table: readonly CheckDimensionTableRow[];
      /** Checks dropped from the chart because a series never evaluated them. */
      readonly omitted: readonly CheckName[];
    };

type AvailableSeries = {
  readonly key: string;
  readonly value: Record<CheckName, CheckDimensionSummary>;
};

export function buildCheckDimensionView(
  series: readonly CheckDimensionSeriesInput[],
): CheckDimensionView {
  if (series.length === 0) {
    return { kind: "unavailable", reason: "no series" };
  }

  const available: AvailableSeries[] = [];
  for (const entry of series) {
    if (entry.dimensions.availability !== "available") {
      return {
        kind: "unavailable",
        reason: `${entry.key} dimensions ${entry.dimensions.availability}`,
      };
    }
    available.push({ key: entry.key, value: entry.dimensions.value });
  }

  const table: CheckDimensionTableRow[] = CHECK_NAMES.map((check) => {
    const cells: Record<string, CheckDimensionTableCell> = {};
    for (const entry of available) {
      const summary = entry.value[check];
      cells[entry.key] = {
        passed: summary.passed,
        failed: summary.failed,
        notApplicable: summary.notApplicable,
        notEvaluated: summary.notEvaluated,
        ratePct: evaluatedCheckRate(summary),
      };
    }
    return { check, label: CHECK_AXIS_LABELS[check], cells };
  });

  // A spoke only exists when every series evaluated the check; comparing
  // against a zero the other side never produced would fabricate a shape.
  const shared = CHECK_NAMES.filter((check) =>
    available.every((entry) => evaluatedCheckRate(entry.value[check]) !== null),
  );
  const omitted = CHECK_NAMES.filter((check) => !shared.includes(check));

  if (shared.length < MIN_RADAR_AXES) {
    return { kind: "ready", chart: null, table, omitted };
  }

  const chart: CheckDimensionRadarPoint[] = [];
  for (const check of shared) {
    const values: Record<string, number> = {};
    const samples: Record<string, { passed: number; failed: number }> = {};
    let complete = true;
    for (const entry of available) {
      const summary = entry.value[check];
      const rate = evaluatedCheckRate(summary);
      if (rate === null) {
        complete = false;
        break;
      }
      values[entry.key] = rate;
      samples[entry.key] = { passed: summary.passed, failed: summary.failed };
    }
    if (complete) {
      chart.push({ check, label: CHECK_AXIS_LABELS[check], values, samples });
    }
  }

  return {
    kind: "ready",
    chart: chart.length < MIN_RADAR_AXES ? null : chart,
    table,
    omitted,
  };
}
