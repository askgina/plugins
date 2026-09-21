import { Function } from "effect";
/** Versioned price-task contract. No model or score targets belong here. */
export type PerpsPriceMode = "single_mark" | "multiple_marks" | "hip3_price";
export const MARKETS = "perps.getHyperliquidMarkets";
export const PRICE = "perps.getHyperliquidPrice";
export const PRICES = "perps.getHyperliquidPrices";
export const ASSET = "perps.getHyperliquidAssetData";
export interface PriceCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
}
export const priceTools = (mode: PerpsPriceMode): readonly string[] =>
  mode === "multiple_marks"
    ? [MARKETS, PRICES]
    : mode === "single_mark"
      ? [MARKETS, ASSET, PRICE]
      : [MARKETS, PRICE];
const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const provider = (args: Readonly<Record<string, unknown>>) =>
  object(args["providerContext"])?.["providerId"];
const dimension = (ok: boolean, detail: string) => ({
  score: ok ? (1 as const) : (0 as const),
  details: [detail],
});

type PriceDimension = ReturnType<typeof dimension>;
type PriceCallGrade = { readonly routing: PriceDimension; readonly arguments: PriceDimension };
export const gradePerpsPriceCalls = Function.dual<
  (mode: PerpsPriceMode) => (calls: readonly PriceCall[]) => PriceCallGrade,
  (calls: readonly PriceCall[], mode: PerpsPriceMode) => PriceCallGrade
>(2, (calls, mode) => {
  const allowed = priceTools(mode);
  const names = calls.map((c) => c.name);
  const sourcePresent =
    mode === "single_mark"
      ? names.includes(MARKETS) || names.includes(ASSET)
      : names.includes(MARKETS);
  const routing =
    sourcePresent &&
    names.every((n) => allowed.includes(n)) &&
    new Set(names).size === names.length;
  const args =
    calls.length > 0 &&
    calls.every((c) => {
      const venue = provider(c.arguments);
      if (
        mode === "hip3_price"
          ? venue !== "hip3:xyz"
          : venue !== undefined && venue !== "hyperliquid"
      )
        return false;
      if (c.name === PRICE || c.name === ASSET)
        return c.arguments["coin"] === (mode === "hip3_price" ? "CL" : "BTC");
      if (c.name === PRICES) {
        const coins = c.arguments["coins"];
        return (
          Array.isArray(coins) &&
          coins.length === 3 &&
          ["BTC", "ETH", "SOL"].every((coin) => coins.includes(coin))
        );
      }
      return c.name === MARKETS;
    });
  return {
    routing: dimension(
      routing,
      mode === "hip3_price"
        ? "Require a venue-scoped markets confirmation; allow one price read in either order before answering."
        : "Require a mark-bearing read; batch marks must come from one markets snapshot. Midpoint reads alone cannot satisfy a mark request.",
    ),
    arguments: dimension(
      args,
      "Bind coin and venue constraints to each relevant call, including the confirmation lookup.",
    ),
  };
});

/** Decode only known MCP result envelopes, never arbitrary nested message text. */
export function pricePayload(value: unknown): Record<string, unknown> | undefined {
  return decodePricePayload(value, 0);
}
function decodePricePayload(value: unknown, depth: number): Record<string, unknown> | undefined {
  if (depth > 8) return undefined;
  if (typeof value === "string") {
    try {
      return decodePricePayload(JSON.parse(value), depth + 1);
    } catch {
      // Native head/tail truncation retains complete leading market objects.
      // Decode only the first text block's visible head; never join across the
      // elision or manufacture a partially captured market object.
      let text: unknown;
      if (
        /^\s*\{\s*"success"\s*:\s*true\s*,/.test(value) &&
        value.includes("<truncation_notice>")
      ) {
        text = value.split("… (")[0];
      } else {
        const head = value.split(/\n\[…\d+B elided…\]/u)[0];
        const start = head?.indexOf('"type":"text","text":');
        if (head === undefined || start === undefined || start < 0 || head === value)
          return undefined;
        let encoded = head.slice(start + '"type":"text","text":'.length);
        if ((encoded.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) encoded = encoded.slice(0, -1);
        try {
          text = JSON.parse(encoded + '"');
        } catch {
          return undefined;
        }
      }
      if (typeof text !== "string" || !/^\s*\{\s*"success"\s*:\s*true\s*,/.test(text))
        return undefined;
      const arrayStart = /"markets"\s*:\s*\[/.exec(text);
      if (arrayStart === null) return undefined;
      const markets: unknown[] = [];
      let begin = -1,
        nesting = 0,
        quoted = false,
        escaped = false;
      for (let i = arrayStart.index + arrayStart[0].length; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
          continue;
        }
        if (c === '"') quoted = true;
        else if (c === "{") {
          if (nesting++ === 0) begin = i;
        } else if (c === "}" && --nesting === 0 && begin >= 0) {
          try {
            markets.push(JSON.parse(text.slice(begin, i + 1)));
          } catch {
            return undefined;
          }
        } else if (c === "]" && nesting === 0) break;
      }
      return markets.length > 0 ? { success: true, markets } : undefined;
    }
  }
  const v = object(value);
  if (v === undefined || v["isError"] === true || v["success"] === false) return undefined;
  const structured = object(v["structuredContent"]);
  if (structured?.["payload"] !== undefined)
    return decodePricePayload(structured["payload"], depth + 1);
  if (v["success"] === true) return v;
  for (const key of ["result", "output", "content"]) {
    const nested = v[key];
    if (Array.isArray(nested)) {
      for (const block of nested) {
        const text = object(block)?.["text"];
        const payload = decodePricePayload(text, depth + 1);
        if (payload !== undefined) return payload;
      }
    } else if (nested !== undefined) {
      const payload = decodePricePayload(nested, depth + 1);
      if (payload !== undefined) return payload;
    }
  }
  return undefined;
}

/** Conservative numeric grounding for the three audited price tasks, not general answer quality. */
export const checkPriceAnswer = Function.dual<
  (mode: PerpsPriceMode, answer: string) => (calls: readonly PriceCall[]) => PriceDimension,
  (calls: readonly PriceCall[], mode: PerpsPriceMode, answer: string) => PriceDimension
>(3, (calls, mode, answer) => {
  const coins =
    mode === "multiple_marks" ? ["BTC", "ETH", "SOL"] : mode === "single_mark" ? ["BTC"] : ["CL"];
  const venue = mode === "hip3_price" ? "hip3:xyz" : "hyperliquid";
  const snapshots: { coin: string; metric: "mark" | "mid"; value: number }[] = [];
  let confirmed = false;
  for (const call of calls) {
    const payload = pricePayload(call.result);
    if (payload === undefined) continue;
    if (call.name === MARKETS && Array.isArray(payload["markets"])) {
      const markets = payload["markets"].flatMap((v) =>
        object(v) !== undefined ? [object(v)!] : [],
      );
      const matching = markets
        .map((m): Record<string, unknown> => ({
          ...m,
          coin:
            venue === "hip3:xyz" && typeof m["coin"] === "string"
              ? m["coin"].replace(/^xyz:/, "")
              : m["coin"],
        }))
        .filter((m) => m["providerId"] === venue && coins.includes(String(m["coin"])));
      if (mode === "hip3_price" && matching.some((m) => m["coin"] === "CL")) confirmed = true;
      // A multi-asset task needs one snapshot containing every requested coin.
      if (
        mode === "multiple_marks" &&
        !coins.every((coin) => matching.some((m) => m["coin"] === coin))
      )
        continue;
      for (const m of matching)
        if (typeof m["markPrice"] === "number" && Number.isFinite(m["markPrice"]))
          snapshots.push({ coin: String(m["coin"]), metric: "mark", value: m["markPrice"] });
    }
    if (
      call.name === PRICE &&
      object(payload["venue"])?.["providerId"] === venue &&
      coins.includes(String(payload["coin"])) &&
      typeof payload["mid"] === "number"
    )
      snapshots.push({ coin: String(payload["coin"]), metric: "mid", value: payload["mid"] });
    if (call.name === ASSET && mode === "single_mark") {
      const asset = object(payload["asset"]);
      const context = object(payload["context"]);
      if (payload["coin"] === "BTC" && object(payload["venue"])?.["providerId"] === venue) {
        const mark = payload["markPrice"] ?? asset?.["markPrice"] ?? context?.["markPrice"];
        if (typeof mark === "number") snapshots.push({ coin: "BTC", metric: "mark", value: mark });
      }
    }
  }
  if (mode === "hip3_price" && !confirmed)
    return dimension(false, "No successful venue-scoped markets result confirms CL on xyz.");
  if (answer.trim().length === 0) return dimension(false, "No retained final answer.");
  const clean = answer.replace(/[*`_]/g, "");
  const lines = clean.split(/\n/);
  const metricOf = (text: string): "mark" | "mid" | "oracle" | undefined => {
    const word = [...text.matchAll(/\b(mark|mid(?:point)?|oracle)(?:s|\s+prices?)?\b/gi)]
      .at(-1)?.[1]
      ?.toLowerCase();
    return word?.startsWith("mid") === true
      ? "mid"
      : word === "mark" || word === "oracle"
        ? word
        : undefined;
  };
  const claims: { coin: string; metric: "mark" | "mid"; token: string }[] = [];
  let tableMetrics: ("mark" | "mid" | "oracle" | undefined)[] = [];
  let sectionMetric: "mark" | "mid" | "oracle" | undefined;
  for (const line of lines) {
    const cells = line.trim().startsWith("|")
      ? line
          .trim()
          .slice(1)
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim())
      : [];
    const mentioned = coins.filter((coin) => new RegExp(`\\b${coin}\\b`, "i").test(line));
    if (
      cells.length > 0 &&
      mentioned.length === 0 &&
      cells.some((c) => metricOf(c) !== undefined)
    ) {
      tableMetrics = cells.map(metricOf);
      continue;
    }
    if (cells.length > 0 && tableMetrics.length === cells.length && mentioned.length === 1) {
      cells.forEach((cell, i) => {
        const metric = tableMetrics[i];
        if (metric !== "mark" && metric !== "mid") return;
        const token = cell.match(/^(?:\$\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s+(?:USD|USDC))?$/)?.[1];
        if (token !== undefined && token.length > 0)
          claims.push({ coin: mentioned[0]!, metric, token });
      });
      continue;
    }
    if (cells.length > 0) continue;
    if (line.trim().length === 0) {
      tableMetrics = [];
      continue;
    }
    if (!/\d/.test(line) && !/\bnot\b/i.test(line) && metricOf(line) !== undefined)
      sectionMetric = metricOf(line);
    const coin =
      mentioned.length === 1
        ? mentioned[0]
        : coins.length === 1 && mentioned.length === 0
          ? coins[0]
          : undefined;
    if (coin === undefined || coin.length === 0) continue;
    if (
      mentioned.length === 0 &&
      !/^\s*[-•]?\s*(?:mark(?:\s+price)?|mid(?:point)?(?:\s+price)?|price)\s*[:=]/i.test(line)
    )
      continue;
    for (const number of line.matchAll(/(?:\$\s*)?\b\d+(?:,\d{3})*(?:\.\d+)?\b/g)) {
      const before = line.slice(0, number.index);
      const after = line.slice(number.index! + number[0].length);
      // Only dollar quotes, price-labelled numbers, or values immediately
      // followed by USD/USDC are claims. Dates, leverage and volumes are not.
      const labelled = /\b(?:mark|mid(?:point)?|price)(?:\s+price)?\s*[:=]?\s*$/.test(
        before.toLowerCase(),
      );
      if (!number[0].includes("$") && !labelled && !/^\s*(?:USD|USDC)\b/.test(after)) continue;
      const metric =
        metricOf(before) ??
        (/^\s*(?:USD|USDC)?\s*(?:mark|mid(?:point)?)(?:\s|[,.)]|$)/i.test(after)
          ? metricOf(after.split(/[,.]/)[0]!)
          : undefined) ??
        sectionMetric;
      if (metric === "oracle") continue;
      if (metric === "mark" || metric === "mid")
        claims.push({ coin, metric, token: number[0].replace(/[$\s]/g, "") });
      else if (mode === "hip3_price") {
        // The HIP-3 prompt asks for price, not specifically mark or midpoint.
        claims.push({
          coin,
          metric: calls.some((c) => c.name === PRICE) ? "mid" : "mark",
          token: number[0].replace(/[$\s]/g, ""),
        });
      }
    }
  }
  for (const coin of coins) {
    const evidence = snapshots.filter(
      (s) => s.coin === coin && (mode === "hip3_price" || s.metric === "mark"),
    );
    if (evidence.length === 0)
      return dimension(
        false,
        `No retained ${mode === "hip3_price" ? "venue price" : "mark"} evidence for ${coin}.`,
      );
    const quoted = claims.filter(
      (c) => c.coin === coin && (mode === "hip3_price" || c.metric === "mark"),
    );
    if (
      quoted.length === 0 ||
      !quoted.every((c) => {
        const token = c.token.replaceAll(",", "");
        const decimalPlaces = token.split(".")[1]?.length ?? 0;
        const tolerance = 0.5 * 10 ** -decimalPlaces + 1e-8;
        return evidence.some(
          (s) => s.metric === c.metric && Math.abs(Number(token) - s.value) <= tolerance,
        );
      })
    )
      return dimension(
        false,
        `The retained answer does not establish the requested ${coin} price from its matching metric and venue.`,
      );
  }
  return dimension(
    true,
    "Requested coin/metric/venue values match the retained results, allowing rounding to the displayed precision.",
  );
});
