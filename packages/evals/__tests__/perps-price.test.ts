import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { gradePluginEvalObservation } from "../src/grading";
import {
  ASSET,
  MARKETS,
  PRICE,
  PRICES,
  checkPriceAnswer,
  gradePerpsPriceCalls,
  pricePayload,
  type PriceCall,
} from "../src/perps-price";

const market = (coin: string, markPrice: number, providerId = "hyperliquid") => ({
  coin,
  markPrice,
  providerId,
});
const markets = (
  rows = [market("BTC", 81093), market("ETH", 2633.9), market("SOL", 110.19)],
  args = {},
): PriceCall => ({ name: MARKETS, arguments: args, result: { success: true, markets: rows } });
const price = (coin = "BTC", mid = 81094, providerId = "hyperliquid"): PriceCall => ({
  name: PRICE,
  arguments: { coin, ...(providerId === "hyperliquid" ? {} : { providerContext: { providerId } }) },
  result: { success: true, coin, mid, venue: { providerId } },
});

describe("Perps price contract", () => {
  test("mark requests require mark-bearing reads, accepting canonical asset data as well as markets", () => {
    expect(gradePerpsPriceCalls([price()], "single_mark").routing.score).toBe(0);
    expect(gradePerpsPriceCalls([markets()], "single_mark").routing.score).toBe(1);
    expect(gradePerpsPriceCalls([price(), markets()], "single_mark").routing.score).toBe(1);
    expect(
      gradePerpsPriceCalls([{ name: ASSET, arguments: { coin: "BTC" } }], "single_mark").routing
        .score,
    ).toBe(1);
    expect(gradePerpsPriceCalls([markets(), markets()], "single_mark").routing.score).toBe(0);
    expect(
      gradePerpsPriceCalls(
        [markets(), { name: "perps.getHyperliquidAccount", arguments: {} }],
        "single_mark",
      ).routing.score,
    ).toBe(0);
    expect(gradePerpsPriceCalls([price("ETH"), markets()], "single_mark").arguments.score).toBe(0);
    expect(
      gradePerpsPriceCalls(
        [markets([], { providerContext: { providerId: "hip3:xyz" } })],
        "single_mark",
      ).arguments.score,
    ).toBe(0);
  });
  test("multi-asset marks need one combined snapshot and cannot use midpoints", () => {
    const batch = { name: PRICES, arguments: { coins: ["BTC", "ETH", "SOL"] } };
    expect(gradePerpsPriceCalls([batch], "multiple_marks").routing.score).toBe(0);
    expect(gradePerpsPriceCalls([batch, markets()], "multiple_marks").routing.score).toBe(1);
    expect(gradePerpsPriceCalls([markets(), price()], "multiple_marks").routing.score).toBe(0);
    const answer =
      "| Coin | Mark | Mid |\n|---|---|---|\n| BTC | $81,093 | $81,094 |\n| ETH | $2,633.90 | $2,634 |\n| SOL | $110.19 | $110.2 |";
    expect(checkPriceAnswer([markets()], "multiple_marks", answer).score).toBe(1);
    expect(
      checkPriceAnswer(
        [markets()],
        "multiple_marks",
        answer.replace("$81,093 | $81,094", "$81,094 | $81,093"),
      ).score,
    ).toBe(0);
    expect(
      checkPriceAnswer(
        [markets()],
        "multiple_marks",
        answer.replace("| BTC |", "| ETH |").replace("| ETH | $2,633", "| BTC | $2,633"),
      ).score,
    ).toBe(0);
    expect(
      checkPriceAnswer([markets([market("BTC", 81093)])], "multiple_marks", answer).score,
    ).toBe(0);
  });
  test("checks requested marks, rounding, contradictory values and unrelated oracle numbers", () => {
    expect(checkPriceAnswer([markets()], "single_mark", "BTC mark: $81,093").score).toBe(1);
    expect(
      checkPriceAnswer([markets()], "single_mark", "BTC mark: $81,094; oracle: $81,093").score,
    ).toBe(0);
    expect(
      checkPriceAnswer([markets()], "single_mark", "BTC mark: $81,094. BTC mark: $81,093.").score,
    ).toBe(0);
    expect(
      checkPriceAnswer([markets()], "single_mark", "BTC mid: $81,093. This is not a mark quote.")
        .score,
    ).toBe(0);
    expect(
      checkPriceAnswer([markets([market("BTC", 81093.3)])], "single_mark", "BTC mark: $81,093")
        .score,
    ).toBe(1);
    expect(
      checkPriceAnswer([markets([market("BTC", 81093.3)])], "single_mark", "BTC mark: $81,093.00")
        .score,
    ).toBe(0);
    expect(checkPriceAnswer([markets()], "single_mark", "").score).toBe(0);
  });
  test.each([
    "The mark price of Bitcoin is $81,093.",
    "BTC mark is USD 81,093.",
    "Bitcoin's mark price is USDC 81,093.",
    "Bitcoin (BTC) mark price is 81,093 USD.",
    "The current mark price is 81093.",
    "On Hyperliquid, Bitcoin's mark is $81,093.",
    "BTC mark is not $1; the mark is $81,093.",
    "BTC mark is $81,093, not $1.",
    "BTC mark (not midpoint) is $81,093.",
    "BTC mark is not $1 but $81,093.",
    "BTC mark: $81,093. Use ~$81,090 as a rough trading level.",
    "BTC mark: $81,093. Volume: $1. Leverage: 20x.",
    "BTC mark: $81,093 on Hyperliquid, not Coinbase.",
  ])("accepts equivalent grounded assertions: %s", (answer) => {
    expect(checkPriceAnswer([markets()], "single_mark", answer).score).toBe(1);
  });
  test.each([
    "BTC mark is not $81,093.",
    "Bitcoin's mark isn't USD 81,093.",
    "BTC mark: $81,093.\nActually the mark is $1.",
    "BTC mark: $81,093.\nActually it's $1.",
    "BTC mark: $81,093.\nPrice is USD 1.",
    "BTC mark: $81,093. Actually the mark is $1.",
    "BTC mark: $81,093. The mark is not $81,093.",
    "BTC mark: $81,093 on Coinbase.",
    "On Binance, Bitcoin's mark price is $81,093.",
    "Coinbase BTC mark: $81,093.",
    "Venue: Coinbase\nBTC mark: $81,093.",
    "BTC mark: $81,093.\nVenue: Coinbase",
    "BTC mark might be $81,093.",
    "If BTC mark were $81,093, I would buy.",
    "I cannot confirm BTC mark is $81,093.",
    "ETH mark: $81,093.",
    "BTC mark: -$81,093.",
    "BTC mark (not midpoint) is $81,093 on Coinbase.",
    "BTC mark: $81,093.\n- Venue: Coinbase",
    "BTC mark: $81,093 is incorrect.",
    "DOGE mark: $81,093.",
    "The mark price of Dogecoin is $81,093.",
    "BTC mark: $81,093k.",
    "BTC mark: $81,093e3.",
    "BTC mark: $81,093.\nBTC mark: $81,093%.",
    "BTC mark: $81,093.\nBTC mark: -81,093 USD.",
  ])("rejects denied, contradictory, hypothetical or misattributed assertions: %s", (answer) => {
    expect(checkPriceAnswer([markets()], "single_mark", answer).score).toBe(0);
  });
  test("binds aliases and separate prose clauses to the correct asset and metric", () => {
    const answer =
      "Bitcoin mark is USD 81,093; Ethereum mark is USDC 2,633.90; Solana mark is $110.19.";
    expect(checkPriceAnswer([markets()], "multiple_marks", answer).score).toBe(1);
    expect(
      checkPriceAnswer([markets()], "multiple_marks", answer.replace("2,633.90", "81,093")).score,
    ).toBe(0);
    expect(
      checkPriceAnswer([markets()], "multiple_marks", answer + "\nActually Ethereum mark is $1.")
        .score,
    ).toBe(0);
    const table =
      "| Coin | Mark | Mid | Venue |\n|---|---|---|---|\n| Bitcoin | USD 81,093 | $1 | Hyperliquid |\n| Ethereum | USDC 2,633.90 | $2 | Hyperliquid |\n| Solana | 110.19 USD | $3 | Hyperliquid |";
    expect(checkPriceAnswer([markets()], "multiple_marks", table).score).toBe(1);
    expect(
      checkPriceAnswer([markets()], "multiple_marks", table.replace("$1 |", "unavailable |")).score,
    ).toBe(1);
    expect(
      checkPriceAnswer([markets()], "multiple_marks", table.replace("Hyperliquid", "Coinbase"))
        .score,
    ).toBe(0);
    expect(
      checkPriceAnswer(
        [markets()],
        "multiple_marks",
        table.replace("Hyperliquid", "Hyperliquid / Coinbase"),
      ).score,
    ).toBe(0);
    expect(
      checkPriceAnswer([markets()], "multiple_marks", table.replace("USD 81,093", "not $81,093"))
        .score,
    ).toBe(0);
    expect(
      checkPriceAnswer(
        [markets()],
        "multiple_marks",
        table + "\n| Bitcoin | $1 | $81,093 | Hyperliquid |",
      ).score,
    ).toBe(0);
  });
  test("requires HIP-3 confirmation in either order and binds the price arguments to the price call", () => {
    const lookup = markets([market("xyz:CL", 97.504, "hip3:xyz")], {
      query: "CL",
      providerContext: { providerId: "hip3:xyz" },
    });
    const quote = price("CL", 97.507, "hip3:xyz");
    for (const calls of [
      [lookup, quote],
      [quote, lookup],
    ]) {
      expect(gradePerpsPriceCalls(calls, "hip3_price").routing.score).toBe(1);
      expect(gradePerpsPriceCalls(calls, "hip3_price").arguments.score).toBe(1);
      expect(checkPriceAnswer(calls, "hip3_price", "CL on xyz: $97.507 midpoint").score).toBe(1);
    }
    expect(gradePerpsPriceCalls([quote], "hip3_price").routing.score).toBe(0);
    expect(checkPriceAnswer([quote], "hip3_price", "CL on xyz: $97.507 midpoint").score).toBe(0);
    expect(
      checkPriceAnswer(
        [markets([market("xyz:ORCL", 97.504, "hip3:xyz")]), quote],
        "hip3_price",
        "CL on xyz: $97.507 midpoint",
      ).score,
    ).toBe(0);
    expect(
      checkPriceAnswer(
        [{ ...lookup, result: { isError: true } }, quote],
        "hip3_price",
        "CL on xyz: $97.507 midpoint",
      ).score,
    ).toBe(0);
  });
  test("keeps HIP-3 midpoint assertions separate from timestamps, oracle values and field tables", () => {
    const calls = [
      markets([market("xyz:CL", 97.504, "hip3:xyz")], {
        providerContext: { providerId: "hip3:xyz" },
      }),
      price("CL", 97.507, "hip3:xyz"),
    ];
    for (const answer of [
      "CL (WTI crude) on xyz (HIP-3): $97.507 USD midpoint, updated at 19:40:11 UTC.",
      "CL is $97.507 USD at the latest fetched midpoint on xyz (TradeXYZ), Hyperliquid HIP-3.",
      "CL on xyz's HIP-3 venue is $97.507 USD, based on the latest midpoint.",
      "CL on xyz: $97.507 midpoint.\nMark: $97.504\nOracle: $1",
      "CL on xyz: $97.507 midpoint.\n| Field | Value |\n|---|---|\n| Venue | TradeXYZ (hip3:xyz) |\n| Market | xyz:CL-USD |\n| Mid | USD 97.507 |\n| Mark | $97.504 |\n| Oracle | $1 |\n| Open interest | 1,234 CL |",
    ])
      expect(checkPriceAnswer(calls, "hip3_price", answer).score, answer).toBe(1);
    expect(checkPriceAnswer(calls, "hip3_price", "CL on Coinbase: $97.507 midpoint").score).toBe(0);
    expect(
      checkPriceAnswer(
        calls,
        "hip3_price",
        "CL midpoint: $97.507\n| Field | Value |\n|---|---|\n| Mid | $97.507 |\n| Venue | Coinbase |",
      ).score,
    ).toBe(0);
    expect(
      checkPriceAnswer(
        calls,
        "hip3_price",
        "CL on xyz: $97.507 midpoint.\nActually the midpoint is $1.",
      ).score,
    ).toBe(0);
  });
  test("reads complete visible objects in native truncation without joining across the omitted region", () => {
    const prefix =
      '{"success":true,"markets":[' +
      JSON.stringify(market("BTC", 81093)) +
      ',{"coin":"ETH","markPrice":';
    const encoded = JSON.stringify(prefix).slice(0, -1);
    const truncated =
      '{"content":[{"type":"text","text":' + encoded + "\n[…1000B elided…]\nmalformed tail";
    expect(pricePayload(truncated)?.["markets"]).toEqual([market("BTC", 81093)]);
    const calls = [{ ...markets(), result: truncated }];
    expect(checkPriceAnswer(calls, "single_mark", "BTC mark: $81,093").score).toBe(1);
    expect(
      checkPriceAnswer(
        calls,
        "multiple_marks",
        "BTC mark: $81,093; ETH mark: $2,633.9; SOL mark: $110.19",
      ).score,
    ).toBe(0);
    expect(
      pricePayload(
        '{"isError":true,"structuredContent":{"payload":{"success":true,"markets":[]}}}',
      ),
    ).toBeUndefined();
  });
  test("the native grader uses the corrected call and argument contract without erasing completion errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const evalCase = {
          id: "perps-hip3-price",
          category: "direct" as const,
          tags: [],
          manual_priority: "required" as const,
          turns: [{ role: "user" as const, content: "CL on xyz" }],
          expected: { routing: { kind: "perps_price" as const, mode: "hip3_price" as const } },
        };
        const tool_calls = [
          markets([], { query: "CL", providerContext: { providerId: "hip3:xyz" } }),
          price("CL", 97.507, "hip3:xyz"),
        ].map((call, sequence) => ({
          sequence,
          name: call.name,
          arguments: call.arguments as { coin?: string; providerContext?: { providerId: string } },
        }));
        const observation = {
          version: 1 as const,
          run_id: "test",
          case_id: evalCase.id,
          target: "fixture" as const,
          model: "fixture",
          repetition: 1,
          started_at: "2026-09-21T00:00:00Z",
          status: "completed" as const,
          duration_ms: 1,
          tool_calls,
        };
        const score = yield* gradePluginEvalObservation(evalCase, observation);
        expect(score.routing.score).toBe(1);
        expect(score.arguments.score).toBe(1);
        const failed = yield* gradePluginEvalObservation(evalCase, {
          ...observation,
          tool_calls: [{ ...tool_calls[0]!, error: { message: "Tool failed" } }, tool_calls[1]!],
        });
        expect(failed.overall_pass).toBe(false);
        expect(failed.completion.score).toBe(0);
      }),
    ));
});
