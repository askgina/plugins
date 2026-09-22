type Metric = "mark" | "mid" | "oracle";
export interface PriceClaim {
  readonly coin: string;
  readonly metric: Metric;
  readonly token: string;
  readonly denied: boolean;
  readonly uncertain: boolean;
  readonly venues: readonly string[];
}

const assets = [
  { coin: "BTC", pattern: /\b(?:BTC|Bitcoin)\b/i },
  { coin: "ETH", pattern: /\b(?:ETH|Ethereum|Ether)\b/i },
  { coin: "SOL", pattern: /\b(?:SOL|Solana)\b/i },
  { coin: "CL", pattern: /\b(?:CL|WTI(?: crude(?: oil)?)?)\b/i },
] as const;
const coinsIn = (text: string) => assets.filter((a) => a.pattern.test(text)).map((a) => a.coin);
const metricOf = (text: string): Metric | undefined => {
  // Parenthetical exclusions describe what a quote is NOT, not its metric.
  const positive = text.replace(/\([^)]*\bnot\b[^)]*\)/gi, "");
  const word = [...positive.matchAll(/\b(mark|mid(?:point)?|oracle)(?:s|\s+prices?)?\b/gi)]
    .at(-1)?.[1]
    ?.toLowerCase();
  return word?.startsWith("mid") === true
    ? "mid"
    : word === "mark" || word === "oracle"
      ? word
      : undefined;
};
const denied = (text: string) =>
  /\b(?:not|never|no longer|isn't|isn’t|isnt|wasn't|wasn’t)\b/i.test(
    text.replace(/\([^)]*\bnot\b[^)]*\)/gi, ""),
  );
const uncertain = (text: string) =>
  /\b(?:if|might|may|could|would|perhaps|maybe|cannot|can't|can’t|unable|unconfirmed|hypothetical)\b/i.test(
    text,
  );
const normalizeVenue = (text: string) => {
  if (/\b(?:xyz|tradexyz)\b/i.test(text)) return "hip3:xyz";
  if (/\bhyperliquid\b/i.test(text)) return "hyperliquid";
  return text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .trim();
};
const venuesIn = (text: string): string[] => {
  // Scope venue attributions to the affirmative portion of the clause. A
  // disclaimer such as "not a CME quote" must not relabel a Hyperliquid price.
  const positive = text
    .replace(/\([^)]*\bnot\b[^)]*\)/gi, "")
    .split(/\b(?:not|rather than)\b/i)[0]!;
  const venues = [
    ...positive.matchAll(
      /\b(?:hyperliquid|(?:hip3:)?xyz|tradexyz|coinbase|binance|kraken|bybit|okx|dydx|CME)\b/gi,
    ),
  ].map((m) => normalizeVenue(m[0]));
  for (const match of positive.matchAll(
    /\b(?:on|from|at|venue\s*[:=]|exchange\s*[:=])\s+(?:(?:the|canonical|native)\s+)*([a-z][a-z0-9:'’.-]*)/gi,
  )) {
    const name = match[1]!;
    // These introduce a metric, timestamp or read, rather than an exchange.
    if (
      /^(?:mark|mid|midpoint|bid|ask|time|snapshot|markets?|asset|same|one|single|perps|getHyperliquid|HIP-3|latest|current|venue|builder)/i.test(
        name,
      )
    )
      continue;
    venues.push(normalizeVenue(name.replace(/[.,:]$/, "")));
  }
  const unique = [...new Set(venues)];
  // xyz is a Hyperliquid HIP-3 venue; naming the parent does not contradict it.
  return unique.includes("hip3:xyz") ? unique.filter((v) => v !== "hyperliquid") : unique;
};
const numbersIn = (text: string) => [
  ...text.matchAll(/(-?\s*(?:(?:\$|\bUSDC?\b)\s*)?-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(USDC?)\b)?/gi),
];
const numericToken = (text: string) => text.replace(/USD[C]?|[$\s]/gi, "");
const cellsIn = (line: string) =>
  line.trim().startsWith("|")
    ? line
        .trim()
        .slice(1)
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim())
    : [];

/** Bounded, deterministic claim extraction, not a general natural-language judge.
 * Keep assertion context local: table columns, prose clauses and explicit price
 * follow-ups. Currency by itself must not turn volume, dates or leverage into a
 * price. Unsupported/ambiguous price cells fail closed instead of disappearing.
 */
export function extractPriceClaims(input: {
  readonly answer: string;
  readonly coins: readonly string[];
  readonly defaultMetric?: "mark" | "mid";
}): { readonly claims: readonly PriceClaim[]; readonly ambiguous: boolean } {
  const lines = input.answer.replace(/[*`_]/g, "").replaceAll("−", "-").split(/\n/);
  const claims: PriceClaim[] = [];
  let ambiguous = false;
  let sectionMetric: Metric | undefined;
  let sectionVenues: string[] = [];
  let previousCoin: string | undefined;
  let previousMetric: Metric | undefined;
  let tableMetrics: (Metric | undefined)[] = [];
  let tableVenueColumn = -1;
  let fieldTable = false;
  // A standalone venue declaration applies to the answer even when it follows
  // the price (a common retained-answer layout).
  const declaredVenues = lines.flatMap((line) => {
    const cells = cellsIn(line);
    if (cells.length === 2 && /^(?:venue|exchange)$/i.test(cells[0]!))
      return venuesIn(cells.join(": "));
    return /^\s*[-•]?\s*(?:venue|exchange)\s*[:=]/i.test(line) ? venuesIn(line) : [];
  });
  for (const originalLine of lines) {
    let line = originalLine;
    const cells = cellsIn(line);
    const mentioned = coinsIn(line);
    if (cells.length > 0) {
      if (
        cells.length === 2 &&
        /^(?:field|metric)$/i.test(cells[0]!) &&
        /^value$/i.test(cells[1]!)
      ) {
        fieldTable = true;
        tableMetrics = [];
        continue;
      }
      if (fieldTable) {
        if (/^(?:venue|exchange)$/i.test(cells[0]!) && cells[1] !== undefined)
          sectionVenues = venuesIn(cells.join(": "));
        if (cells.length !== 2 || metricOf(cells[0]!) === undefined) continue;
        line = cells.join(": ");
      } else if (
        mentioned.length === 0 &&
        cells.some((c) => metricOf(c) !== undefined || /^price\b/i.test(c))
      ) {
        tableMetrics = cells.map(
          (c) =>
            metricOf(c) ??
            (/^price\b/i.test(c) ? (sectionMetric ?? input.defaultMetric) : undefined),
        );
        tableVenueColumn = cells.findIndex((c) => /^(?:venue|exchange)$/i.test(c));
        continue;
      } else if (mentioned.length === 1 && input.coins.includes(mentioned[0]!)) {
        if (tableMetrics.length !== cells.length) {
          ambiguous = true;
          continue;
        }
        cells.forEach((cell, i) => {
          const metric = tableMetrics[i];
          if (
            metric === undefined ||
            metric === "oracle" ||
            (input.defaultMetric === undefined && metric !== "mark")
          )
            return;
          const quotes = numbersIn(cell);
          if (quotes.length !== 1) {
            ambiguous = true;
            return;
          }
          const quote = quotes[0]!;
          const remainder = cell.replace(quote[0], "").trim();
          if (!/^(?:not|is not|isn't|isn’t)?$/i.test(remainder)) ambiguous = true;
          claims.push({
            coin: mentioned[0]!,
            metric,
            token: numericToken(quote[1]!),
            denied: denied(cell),
            uncertain: uncertain(cell),
            venues: [
              ...declaredVenues,
              ...sectionVenues,
              ...(tableVenueColumn < 0 ? [] : venuesIn("Venue: " + cells[tableVenueColumn]!)),
            ],
          });
        });
        continue;
      }
      if (!fieldTable) continue;
    } else {
      fieldTable = false;
      tableMetrics = [];
      tableVenueColumn = -1;
    }
    if (line.trim().length === 0) continue;
    if (!/\d/.test(line) && !denied(line) && !uncertain(line)) {
      sectionMetric = metricOf(line) ?? sectionMetric;
      const venues = venuesIn(line);
      if (venues.length > 0) sectionVenues = venues;
    }
    // Do not split decimal points or thousands separators. Split coordinated
    // asset assertions, but retain "on Hyperliquid, BTC ..." as one clause.
    const clauses = line.split(
      /(?<=[.!?])\s+|;\s*|,\s*(?=not\s+\$)|(?<=\d|USD|USDC),\s*(?=(?:BTC|Bitcoin|ETH|Ethereum|Ether|SOL|Solana|CL)\b)|\s+(?:and|but)\s+(?=(?:\$|USD|BTC|Bitcoin|ETH|Ethereum|Ether|SOL|Solana|CL)\b)/i,
    );
    for (const clause of clauses) {
      const mentionedHere = coinsIn(clause);
      const explicitMetric = metricOf(clause);
      const followup =
        /^\s*[-•]?\s*(?:(?:actually|correction|instead)[,:]?\s*)?(?:(?:the|current|latest)\s+)*(?:price\b|mark\b|mid(?:point)?\b|it(?:['’]s| is)|that is|this is|not\b|\$|USDC?\b)/i.test(
          clause,
        ) && !/\b(?:of|for)\s+[a-z]/i.test(clause);
      const coin =
        mentionedHere.length === 1
          ? mentionedHere[0]
          : mentionedHere.length === 0 && followup
            ? (previousCoin ?? (input.coins.length === 1 ? input.coins[0] : undefined))
            : undefined;
      if (coin !== undefined) previousCoin = coin;
      const quotes = numbersIn(clause);
      let previousEnd = 0;
      for (const quote of quotes) {
        const before = clause.slice(previousEnd, quote.index);
        const after = clause.slice(quote.index! + quote[0].length);
        previousEnd = quote.index! + quote[0].length;
        // Explicit labels for other quantities terminate inherited price context.
        if (
          /\b(?:volume|funding|leverage|updatedAt|updated|timestamp|change|collateral|settlement)\b/i.test(
            before,
          ) ||
          /^\s*:\d/.test(after) ||
          // A suggested trading/round-number level is not another assertion of
          // the current mark. Keep it separate from the explicit price claims.
          /\b(?:use|target|buy|sell)\s+(?:(?:at|around|approximately)\s+)?~?\s*$/i.test(before)
        )
          continue;
        const labelled =
          /\b(?:mark|mid(?:point)?|oracle|price)(?:\s+price)?(?:\s+is|\s+at|\s*=|\s*:)?\s*$/i.test(
            before,
          );
        const currency = /\$|\bUSDC?\b/i.test(quote[0]);
        if (
          !currency &&
          !labelled &&
          !(explicitMetric !== undefined && /\b(?:is|at)\s*$/i.test(before))
        )
          continue;
        const metric =
          metricOf(before) ??
          (/^\s*(?:at\s+the\s+)?(?:mark|mid(?:point)?|oracle)\b/i.test(after)
            ? metricOf(after.split(/[,.;]/)[0]!)
            : undefined) ??
          (followup ? previousMetric : undefined) ??
          sectionMetric ??
          input.defaultMetric;
        if (coin === undefined) {
          if (metric !== undefined && followup) ambiguous = true;
          continue;
        }
        if (!input.coins.includes(coin) || metric === undefined) continue;
        // Do not turn scientific notation, scaled prices or percentages into a
        // matching numeric prefix. These formats need an explicit parser.
        if (/^(?:[kmb]\b|e[+-]?\d|\s*%)/i.test(after)) ambiguous = true;
        previousMetric = metric;
        claims.push({
          coin,
          metric,
          token: numericToken(quote[1]!),
          denied:
            denied(before) ||
            /^\s*(?:is|was)\s+(?:wrong|incorrect|false|not\s+(?:correct|accurate))\b/i.test(after),
          uncertain: uncertain(clause),
          venues: [...declaredVenues, ...sectionVenues, ...venuesIn(clause)],
        });
      }
    }
  }
  return { claims, ambiguous };
}
