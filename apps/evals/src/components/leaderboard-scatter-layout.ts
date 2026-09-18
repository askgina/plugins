import type { LeaderboardModelRow } from "../canonical/selectors";

export interface ScatterPoint {
  row: LeaderboardModelRow;
  key: string;
  value: number;
  score: number;
  x: number;
  y: number;
}

const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const reasoning = (point: ScatterPoint) =>
  Object.values(point.row.runs)[0]?.configuration.reasoning ?? "";

/** Preserve route/cohort boundaries while allowing the declared effort to vary. */
function seriesKey(point: ScatterPoint): string {
  return JSON.stringify([
    point.row.model.id,
    point.row.campaignId,
    Object.values(point.row.runs)
      .sort((a, b) => a.family.localeCompare(b.family))
      .map((run) => [
        run.family,
        run.campaignId,
        run.cohort.cohortId,
        run.cohort.suiteId,
        run.cohort.suiteVersion,
        run.cohort.fixtureVersion,
        run.cohort.catalogSha,
        run.cohort.target,
        run.cohort.accountClass,
        run.cohort.repetitions,
        run.cohort.evidenceCategory,
        run.timeoutMs,
        run.configuration.model,
        run.configuration.candidate
          .split("-")
          .filter((part) => part !== run.configuration.reasoning)
          .join("-"),
      ]),
  ]);
}

export function scatterSeries(points: readonly ScatterPoint[]) {
  const groups = new Map<string, ScatterPoint[]>();
  for (const point of points) {
    const key = seriesKey(point);
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => {
    const ordered = [...group].sort(
      (a, b) => efforts.indexOf(reasoning(a)) - efforts.indexOf(reasoning(b)),
    );
    // A missing or ambiguous effort must not look like a measured continuation.
    const segments = ordered.flatMap((point, index) => {
      const next = ordered[index + 1];
      const rank = efforts.indexOf(reasoning(point));
      return next &&
        rank >= 0 &&
        efforts.indexOf(reasoning(next)) === rank + 1 &&
        ordered.filter((other) => reasoning(other) === reasoning(point)).length === 1 &&
        ordered.filter((other) => reasoning(other) === reasoning(next)).length === 1
        ? [[point, next] as const]
        : [];
    });
    return { key, points: ordered, segments };
  });
}

export function scatterDomain(values: readonly number[], score = false) {
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const span = high - low || Math.max(high * 0.2, score ? 0.2 : 1);
  const rawStep = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = score
    ? high - low > 0.6
      ? 0.2
      : 0.1
    : (rawStep / magnitude <= 1
        ? 1
        : rawStep / magnitude <= 2
          ? 2
          : rawStep / magnitude <= 5
            ? 5
            : 10) * magnitude;
  const min = Math.max(0, Math.floor((low - span * 0.025) / step) * step);
  const max = Math.min(score ? 1 : Infinity, Math.ceil((high + span * 0.025) / step) * step);
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) =>
    Number((min + index * step).toPrecision(12)),
  );
  return { min, max, step, ticks };
}

function segmentCrossesLabel(
  from: ScatterPoint,
  to: ScatterPoint,
  box: readonly [number, number, number, number],
) {
  let start = 0;
  let end = 1;
  for (const [origin, delta, min, max] of [
    [from.x, to.x - from.x, box[0] - 2, box[2] + 2],
    [from.y, to.y - from.y, box[1] - 2, box[3] + 2],
  ] as const) {
    if (delta === 0) {
      if (origin < min || origin > max) return false;
    } else {
      const a = (min - origin) / delta;
      const b = (max - origin) / delta;
      start = Math.max(start, Math.min(a, b));
      end = Math.min(end, Math.max(a, b));
      if (start > end) return false;
    }
  }
  return true;
}

export function scatterLabels(
  series: ReturnType<typeof scatterSeries>,
  bounds: { left: number; right: number; top: number; bottom: number },
  compact: boolean,
) {
  const occupied: Array<readonly [number, number, number, number]> = [];
  const points = series.flatMap((group) => group.points);
  const segments = series.flatMap((group) => group.segments);
  return [...series]
    .sort(
      (a, b) =>
        Math.max(...b.points.map((p) => p.score)) - Math.max(...a.points.map((p) => p.score)),
    )
    .map((group) => {
      const model = group.points[0]!.row.model;
      const name = compact ? model.name.replace(/^(?:Claude |GPT-[\d.]+ )/u, "") : model.name;
      const textWidth = name.length * (compact ? 5.5 : 6.2);
      const anchors = [...group.points].sort((a, b) => b.x - a.x);
      const candidates = anchors.flatMap((point) =>
        [-10, 19, -28, 37, -46, 55, -64, 73].flatMap((dy) =>
          [10, 22, 34].flatMap((dx) => [
            { point, x: point.x + dx, y: point.y + dy },
            { point, x: point.x - textWidth - dx, y: point.y + dy },
          ]),
        ),
      );
      const placed = candidates.find(({ x, y }) => {
        const box = [x - 3, y - 11, x + textWidth + 3, y + 3] as const;
        return (
          box[0]! >= bounds.left &&
          box[2]! <= bounds.right &&
          box[1]! >= bounds.top &&
          box[3]! <= bounds.bottom &&
          !occupied.some(
            (other) =>
              box[0]! < other[2] + 3 &&
              box[2]! > other[0] - 3 &&
              box[1]! < other[3] + 3 &&
              box[3]! > other[1] - 3,
          ) &&
          !points.some(
            (other) =>
              other.x >= box[0]! - 5 &&
              other.x <= box[2]! + 5 &&
              other.y >= box[1]! - 5 &&
              other.y <= box[3]! + 5,
          ) &&
          !segments.some(([from, to]) => segmentCrossesLabel(from, to, box))
        );
      }) ?? {
        point: anchors[0]!,
        x: Math.max(bounds.left, Math.min(bounds.right - textWidth, anchors[0]!.x + 10)),
        y: Math.max(bounds.top + 12, Math.min(bounds.bottom - 4, anchors[0]!.y - 10)),
      };
      occupied.push([placed.x, placed.y - 11, placed.x + textWidth, placed.y + 3]);
      return { ...placed, key: group.key, name, color: model.color, textWidth };
    });
}
