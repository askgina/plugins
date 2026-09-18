// Hash routing for the evals app — the single place that reads or writes
// `window.location.hash`. Routes look like `#/compare?left=…&right=…`; the
// skip link's bare `#eval-main` anchor is not a route and is ignored.

import { useEffect, useState } from "react";

export const DEFAULT_ROUTE = "/leaderboard";

export interface ParsedRoute {
  /** Path portion without the query string, e.g. `/models/gpt-5.5`. */
  readonly path: string;
  /** Non-empty path segments, e.g. `["models", "gpt-5.5"]`. */
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
}

/** Splits a route string (`/path?query`) into path, segments, and params. */
export function parseRoute(route: string): ParsedRoute {
  const [path = "", queryString = ""] = route.split("?");
  return {
    path,
    segments: path.split("/").filter((segment) => segment !== ""),
    query: new URLSearchParams(queryString),
  };
}

/**
 * Matches a route path against a table pattern. Patterns are exact segments
 * plus `:name` params (`/models/:id`). Returns the captured params, or null.
 */
export function matchPath(pattern: string, path: string): Readonly<Record<string, string>> | null {
  const patternSegments = pattern.split("/").filter((segment) => segment !== "");
  const pathSegments = path.split("/").filter((segment) => segment !== "");
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, patternSegment] of patternSegments.entries()) {
    const pathSegment = pathSegments[index]!;
    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = pathSegment;
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}

/** Navigates to a route path such as `/compare?left=a&right=b`. */
export function navigate(path: string): void {
  window.location.hash = path;
}

/**
 * The current hash route, re-rendering on `hashchange`. The bare `#eval-main`
 * skip-link anchor is ignored so it never remounts the current page.
 */
export function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || DEFAULT_ROUTE);
  useEffect(() => {
    let previousRoute = window.location.hash.slice(1) || DEFAULT_ROUTE;
    const handleRoute = () => {
      const nextRoute = window.location.hash.slice(1);
      if (nextRoute === "eval-main") return;
      setRoute(nextRoute || DEFAULT_ROUTE);
      // Task selections update the URL without throwing the reviewer back to the hero.
      const withinTasks =
        parseRoute(previousRoute).path === "/tasks" && parseRoute(nextRoute).path === "/tasks";
      previousRoute = nextRoute || DEFAULT_ROUTE;
      if (!withinTasks) window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("hashchange", handleRoute);
    return () => window.removeEventListener("hashchange", handleRoute);
  }, []);
  return route;
}
