import { useEffect, useState, useSyncExternalStore } from "react";
import {
  leaderboardCampaignRows,
  recordedOutcomes,
  sortLeaderboardRows,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type ScoredFamily,
} from "../canonical/selectors";

export interface LeaderboardState {
  search: string;
  campaign: string;
  grading: "all" | "complete" | "incomplete";
  metric: LeaderboardMetric;
  direction: "asc" | "desc";
  group: "settings" | "models";
  view: "categories" | "efficiency";
  page: number;
  category: ScoredFamily;
  efficiency: "time" | "cost";
  overview: boolean;
}

export function readLeaderboardState(hash: string, initialSearch = ""): LeaderboardState {
  const params = new URLSearchParams(hash.split("?")[1]);
  const requestedMetric = params.get("metric");
  const metric =
    (["overall", "Spot", "Perps", "Predictions", "time", "cost"] as const).find(
      (entry) => entry === requestedMetric,
    ) ?? "overall";
  const page = Number(params.get("page") ?? 0);
  return {
    search: params.get("search") ?? initialSearch,
    campaign: params.get("campaign") ?? "latest",
    grading:
      params.get("grading") === "complete"
        ? "complete"
        : params.get("grading") === "incomplete"
          ? "incomplete"
          : "all",
    metric,
    direction:
      params.get("direction") === "asc"
        ? "asc"
        : params.get("direction") === "desc"
          ? "desc"
          : metric === "time" || metric === "cost"
            ? "asc"
            : "desc",
    group: params.get("group") === "models" ? "models" : "settings",
    view: params.get("view") === "efficiency" ? "efficiency" : "categories",
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
    category:
      params.get("category") === "Spot"
        ? "Spot"
        : params.get("category") === "Perps"
          ? "Perps"
          : params.get("category") === "Predictions"
            ? "Predictions"
            : metric === "Perps" || metric === "Predictions"
              ? metric
              : "Spot",
    efficiency:
      params.get("efficiency") === "cost"
        ? "cost"
        : params.get("efficiency") === "time"
          ? "time"
          : metric === "cost"
            ? "cost"
            : "time",
    overview: params.get("overview") === "open",
  };
}

export function leaderboardHash(state: LeaderboardState): string {
  const defaults = readLeaderboardState(`#/leaderboard?metric=${state.metric}`);
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults) as (keyof LeaderboardState)[]) {
    if (key === "metric" ? state.metric !== "overall" : state[key] !== defaults[key])
      params.set(key, key === "overview" ? "open" : String(state[key]));
  }
  return `#/leaderboard${params.size ? `?${params}` : ""}`;
}

export function visibleLeaderboardRows(
  rows: readonly LeaderboardModelRow[],
  state: LeaderboardState,
) {
  const query = state.search.trim().toLocaleLowerCase();
  return sortLeaderboardRows(
    leaderboardCampaignRows(rows, state.campaign).filter((row) => {
      const counts = recordedOutcomes(Object.values(row.runs));
      const complete = counts.planned > 0 && counts.graded === counts.planned;
      return (
        `${row.model.name} ${row.model.provider} ${row.configurationLabel ?? ""} ${row.campaignId ?? ""}`
          .toLocaleLowerCase()
          .includes(query) &&
        (state.grading === "all" || (state.grading === "complete" ? complete : !complete))
      );
    }),
    state.metric,
    state.direction,
  );
}

/** The input is already filtered and sorted; retain its first setting per provider. */
export function providerOverviewRows(rows: readonly LeaderboardModelRow[]): LeaderboardModelRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const provider = row.model.provider.trim().toLocaleLowerCase();
    if (seen.has(provider)) return false;
    seen.add(provider);
    return true;
  });
}

function subscribeViewport(onChange: () => void) {
  const queries = [
    window.matchMedia("(min-width: 761px)"),
    window.matchMedia("(min-width: 1100px)"),
    window.matchMedia("(min-width: 1400px)"),
  ];
  queries.forEach((query) => query.addEventListener("change", onChange));
  return () => queries.forEach((query) => query.removeEventListener("change", onChange));
}

function viewportBand() {
  return window.matchMedia("(min-width: 1400px)").matches
    ? "wide"
    : window.matchMedia("(min-width: 1100px)").matches
      ? "desktop"
      : window.matchMedia("(min-width: 761px)").matches
        ? "tablet"
        : "phone";
}

export function useLeaderboard(rows: readonly LeaderboardModelRow[], initialSearch = "") {
  const [state, setState] = useState(() =>
    readLeaderboardState(typeof window === "undefined" ? "" : window.location.hash, initialSearch),
  );
  const viewport = useSyncExternalStore(subscribeViewport, viewportBand, () => "wide");
  const pageSize = viewport === "wide" ? 10 : viewport === "desktop" ? 8 : 5;
  const shown = visibleLeaderboardRows(rows, state);
  const page = Math.min(state.page, Math.max(0, Math.ceil(shown.length / pageSize) - 1));

  useEffect(() => {
    window.history.replaceState(window.history.state, "", leaderboardHash(state));
  }, [state]);

  useEffect(() => {
    // replaceState keeps typing from remounting the page. A real hash navigation
    // must still restore controls, even when the router already has this path.
    const restore = () => {
      const path = window.location.hash.split("?")[0];
      if (path === "#/leaderboard" || path === "#/" || path === "") {
        setState(readLeaderboardState(window.location.hash));
      }
    };
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);

  useEffect(() => {
    const saved = window.history.state?.leaderboardScrollY;
    const frame =
      typeof saved === "number"
        ? requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: "instant" }))
        : undefined;
    let scrollFrame: number | undefined;
    const saveScroll = () => {
      if (scrollFrame !== undefined) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = undefined;
        if (["", "#/", "#/leaderboard"].includes(window.location.hash.split("?")[0] ?? "")) {
          window.history.replaceState(
            { ...window.history.state, leaderboardScrollY: window.scrollY },
            "",
          );
        }
      });
    };
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", saveScroll);
    };
  }, []);

  function update(patch: Partial<LeaderboardState>) {
    setState((current) => ({ ...current, page: 0, ...patch }));
  }
  function sort(metric: LeaderboardMetric) {
    update({
      metric,
      direction:
        metric === state.metric
          ? state.direction === "desc"
            ? "asc"
            : "desc"
          : metric === "time" || metric === "cost"
            ? "asc"
            : "desc",
      ...(metric === "time" || metric === "cost"
        ? { efficiency: metric }
        : metric !== "overall"
          ? { category: metric }
          : {}),
    });
  }
  return {
    state,
    update,
    sort,
    shown,
    page,
    pageSize,
    viewport,
    clear: () => update({ search: "", campaign: "latest", grading: "all", group: "settings" }),
  };
}

export type LeaderboardController = ReturnType<typeof useLeaderboard>;
