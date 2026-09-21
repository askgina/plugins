# Perps price evidence revision — 21 September 2026

`perps-price-evidence-v1` repairs three task/fixture contradictions across every
model with retained public evidence. It reviews both previous passes and failures.
No inference was rerun, model output edited, or desired ranking encoded.

## Price-assertion hardening (`perps-price-evidence-v2`)

The second revision fixes the answer parser's demonstrated false positives and
false negatives. It accepts asset names such as Bitcoin, USD/USDC before or after
the number, ordinary prose assertions, and coin/metric or field/value tables.
Assertions retain their own coin, metric, polarity and explicit venue. A denied
correct price cannot satisfy the task; a denied wrong price followed by a correct
assertion can. Contradictory prices in subsequent sentences or lines, including
explicit price follow-ups without the ticker, fail. Explicit venue declarations
also apply when they appear below the quote.

Timestamps, volume, funding, unrelated oracle values, venue disclaimers and
suggested trading levels do not become mark-price assertions merely because they
contain numbers. Rounding still uses half a unit at the displayed precision.
Unsupported scaled/scientific prices and ambiguous price cells fail with a
manual-review diagnostic rather than being accepted through a matching prefix.

This remains a bounded deterministic parser, not a general semantic judge. It
does not resolve arbitrary pronouns or infer that a later correction retracts an
earlier affirmative claim; contradictory affirmative prices fail conservatively.
Unseen wording can still require review. The separate native-grader/evidence-replay
gap described below is unchanged.

All 382 retained campaign-row attempts were replayed with the same evidence and
skip population. No price-grounding outcomes or verdicts changed from v1, so this
patch does not change the leaderboard rankings. The receipt is versioned and now
hashes the extracted claim parser too. Original results, transcripts, timing and
costs remain byte-for-byte unchanged; the v1 receipt remains in Git history.
The search receipt changes only its shared grading-revision source fingerprint.

Regression cases exercise the audit counterexamples and additional alias,
currency, negation, uncertainty, venue, sign, numeric-format, table and HIP-3
context cases. The all-provider replay is a compatibility check, not an
independent validation set or evidence of general model quality.

V2 verification: 58 focused price/search/revision tests pass, along with lint,
root and eval-app typechecks, formatting, import checks, both receipt replays and
the public-artifact guard. The broader eval package/app suite has 392 passing and
16 failing tests on this macOS host. The same 16 failures reproduce against clean
main (`6d8746c`): two Codex executable-descriptor tests, thirteen OMP harness tests,
and one case-sensitive publication-path test. Tests use the configured Bun runner
and a canonical `/private/tmp` temporary directory.

## Contract

- `perps-single-price` requests the canonical BTC mark. Accept a markets or
  authenticated asset-data read carrying the mark, with at most one call to each
  relevant read (markets, asset data, single midpoint). A midpoint alone fails.
- `perps-multiple-prices` requests BTC/ETH/SOL marks together. Require one markets
  snapshot containing all three. One optional batch midpoint read is allowed;
  repeated single-asset reads or multiple market snapshots do not meet the
  combined-read contract. Midpoints do not substitute for marks.
- `perps-hip3-price` requests CL on xyz. Require a successful venue-scoped markets
  result confirming the exact ticker, accepting the returned `xyz:CL` identity.
  One optional midpoint read may precede or follow the lookup; the lookup must be
  available before the final answer. Validate `coin: CL` on the price call and
  `providerId: hip3:xyz` on both calls. An ORCL or CRCL match is not CL confirmation.
- The publication replay checks each quoted coin, metric, venue and numeric price
  against the visible result, allowing rounding to the precision actually quoted.
  Table columns and coin rows are bound independently: a matching midpoint/oracle
  in another column, or another coin's price, cannot rescue a wrong mark.
- Restriction, completion, and skill-activation checks retain their recorded
  outcomes. A corrected route cannot turn a service/tool failure into a pass.
  Timing, token counts, costs, and selected execution identities are unchanged.

The native deterministic grader and publication replay share the corrected call
and argument contract. Numeric answer grounding is an additional publication
replay check over retained transcripts; native observation records do not retain
tool-result bodies for this check. General answer quality, relevance, and other
task families remain outside this correction.

## Evidence and population

Of 450 recorded slots for these cases, 382 completed campaign-row attempts have
replayable public transcripts (314 distinct underlying trials). The receipt lists
32 incomplete executions and 36 older completed records without public transcripts
as skipped, with their original statuses preserved. All ranked current settings
have their completed price tasks reviewed; the older skipped settings were already
ineligible for overall rankings.

The replay verifies each transcript's indexed SHA-256, byte length, source-summary
identity, path, complete capture, and exact frozen user prompt. Muse's separate
function-call and call IDs are correlated using the actual result ID. No identity
is inferred from nearby prose. For native head/tail truncation, only complete JSON
market objects in the visible leading text are read; nothing is reconstructed
across an elision. All requested values must still be visible in the same snapshot.

The deterministic receipt records original/new checks and verdicts, grounding
outcomes, source/transcript hashes, and skipped identities. It contains no new
private data. Source result JSON and all transcript bytes remain unchanged.

- 118 campaign-row failures become passes: 109 distinct underlying trials.
- 243 campaign-row passes become failures: 185 distinct underlying trials.
- 21 reviewed failures remain failures.
- Astra xhigh/max regain all 18 reviewed price-task passes. xhigh still has a
  separate provider-error gap and stays unranked at 104/105 graded.
- Grok low loses eight false passes and gains its one supported mark answer:
  Perps changes from 40/54 to 33/54; Overall becomes 79.3%.
- Astra high becomes 86.6%, low/medium 85.8%, and max 80.4%. These are the recorded
  task-conformance scores with the narrow price check, not general model rankings.
- Fable's midpoint-only answers also lose passes. This correction does not
  substantiate a claim that Fable must rank second.

## Reproduction and review

Run `bun tools/regrade-eval-perps.ts --check` or `bun run evals:check-grading`.
The latter also verifies the earlier search revision. Original canonical records
remain separately available. Tasks → Checks shows the original verdict, original
routing/arguments and separate Price grounding outcome; Methodology links both
machine-readable receipts.

Regression coverage checks wrong metrics, swapped table rows/columns, rounding,
wrong coins/venues, missing/failed HIP-3 confirmation, both valid call orders,
truncated visible objects, and unchanged completion failures. Integration checks
bind every revision to its original attempt and preserve all costs and evidence.
The public guard approves each receipt by its exact reviewed digest. Rollback is
reverting the new receipt/application and fixture/grader changes; source evidence
requires no restoration.
