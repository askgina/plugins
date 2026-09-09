# Publicly testable Perps MCP workflows

Research for [Research publicly testable Perps MCP workflows](https://github.com/askgina/plugins/issues/68), under [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65). Public documentation reviewed on 2026-09-09.

This is an evidence inventory and candidate matrix, not an evaluation specification or permission to execute. No MCP or model calls, credentials, account access, orders, funding movements, tests, validation commands, or formatters were used. No workflow was run. The sources below establish documented capabilities, not observed production behavior.

Documented facts, illustrative candidate cases, and unresolved policy are kept separate. Inline citations mark the facts. Candidate rows and "needed evidence" statements are proposals, not claims that those observations already exist.

## Question and evidence boundary

[Research publicly testable Perps MCP workflows](https://github.com/askgina/plugins/issues/68) asks which Perps workflows and state distinctions can be evaluated without treating a plausible answer or an accepted command as the requested result. [R]

The public docs support concrete discovery and connection checks, name market and account reads, name financial actions, and give a few input examples. They do not supply a complete versioned host-tool schema, a Perps execution receipt contract, or a reproducible account-state environment. Discovery syntax can therefore be specified more precisely than trading-result assertions. [F][Q][T]

A selected tool or accepted command does not establish that the requested order filled, a stop protected a position, collateral reached the intended account, or a withdrawal settled. Some operations have only a feature description, a prompt, or a `<json>` placeholder. Those are capability evidence, not executable contracts. [F][N][P]

The two layers follow [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65): [M]

1. **Deterministic MCP contract/safety checks** evaluate declared boundaries against controlled evidence. Examples include the exposed MCP tool, discovered schemas, provider identity, argument admissibility, and whether an asserted state transition is supported by evidence.
2. **Natural-language agent task evaluations** evaluate a user's goal under identified connection and account conditions. They cover tool selection, interpretation of venue, asset, quantity, and direction, handling of missing information, and whether the final answer accurately describes the observed result.

These are separate kinds of evaluation, not consecutive execution stages or interchangeable scores. A deterministic check can validate a fixture without proving live behavior. An agent can correctly describe an unresolved order without completing a request to fill it.

This report does not reopen [Track intermittent OMP MCP-error observation loss](https://github.com/askgina/plugins/issues/63) or earlier runner and authentication work. The existing four-case Gina Read smoke is not a dedicated-venue acceptance matrix. Precise model, authentication, isolation, and pinning choices remain on [Specify cross-provider result identity and evidence semantics](https://github.com/askgina/plugins/issues/49) and [Choose runner authentication and isolation policy](https://github.com/askgina/plugins/issues/51). Safety, grading, admission, and acceptance decisions remain open; the owner has already selected all three dedicated MCPs and two evaluation layers. [M]

The word sandbox in these pages names the MCP `bash` workspace. It is not evidence of paper trading, dry-run finances, or simulated fills. [I][A]

## Cited public contract inventory

References in the text identify documented facts. Absence means absent from the reviewed pages, not proven absent from the product. Documentation URLs are mutable. This report does not claim an immutable schema snapshot.

| Ref | Public source | Evidence used |
| --- | --- | --- |
| [M] | [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65) | Two layers, planning-only authority, distinction among synthetic, recorded-response, and live evidence |
| [R] | [Research publicly testable Perps MCP workflows](https://github.com/askgina/plugins/issues/68) | Perps coverage and evidence question |
| [N] | [Perps MCP landing](https://docs.askgina.ai/perps-mcp) | Prompts, including return of HIP-3 funds, advertised MCP resource URIs, safety warning |
| [I] | [Perps introduction](https://docs.askgina.ai/perps-mcp/introduction) | Dedicated endpoint, one MCP `bash` tool, sandbox commands, allowlisted host tools |
| [F] | [Perps features](https://docs.askgina.ai/perps-mcp/features) | Capability inventory, direct examples, schema discovery, HIP-3 provider context |
| [Q] | [Perps quick-start](https://docs.askgina.ai/perps-mcp/quick-start) | OAuth, `bash` visibility, echo and discovery checks, BTC price output description |
| [T] | [Perps troubleshooting](https://docs.askgina.ai/perps-mcp/troubleshooting) | Named discovery, expected output categories, input failure causes, state inspection after unexpected actions |
| [A] | [Perps FAQ](https://docs.askgina.ai/perps-mcp/faq) | Streamable HTTP, authentication and resource binding, capabilities, financial risk and pre-execution review |
| [C] | [Perps client setup](https://docs.askgina.ai/perps-mcp/client-setup) | `tools:execute`, venue-valid credentials, read-token and old-grant restrictions |
| [W] | [Write access](https://docs.askgina.ai/write-access/index) | Proposal versus execution, inspect schemas, start with reads, verify results, pending-transaction warning |
| [X] | [Access comparison](https://docs.askgina.ai/mcp-access) | Separate Gina Read and venue execution connections, scope boundaries, plugin installation does not grant execution |
| [G] | [Gina Read](https://docs.askgina.ai/mcp-access/gina-read) | Named `perps.*` research catalog, no `bash`, `tools:read` |
| [L] | [Read-only perps](https://docs.askgina.ai/read-only/perps) | Venue and ticker ambiguity, missing data is not no-position, research cannot mutate |
| [P] | [Perps product guide](https://docs.askgina.ai/product-guide/perps) | Venue versus symbol, funding as market information, explicit asset/side/size, submitted is not filled |

Command strings below are reproduced for reference only. They were not executed. Shell JSON is shown without the extra escaping required when it is embedded in a JSON `bash` request.

### MCP entry versus host-tool calls

The dedicated server is `https://askgina.ai/ai/perps/mcp`. After authentication, its documented MCP tool inventory is one tool, `bash`. `host-tools`, `capabilities`, `sql`, and `ts-exec` are commands inside that sandbox, not separately advertised Perps MCP tools. Names such as `getHyperliquidPrice` are host-tool actions reached through `bash`. The presence of similarly named client-native tools would not establish that the dedicated Perps connection was used. [I][Q][W][N]

Perps setup requests `tools:execute`, including when the first workflow is a read. The docs do not describe a read-scoped mode of this dedicated connection. Gina Read is a separate endpoint, `https://askgina.ai/ai/gina/mcp`, with `tools:read` and no `bash`. Installing the research plugin does not grant venue execution access. Perps requires a credential valid for its venue. A read-only token or an old Gina execute grant is not a substitute. Default availability for authenticated Gina users means no perps-specific feature flag, not that authentication, scope, confirmations, or risk checks disappear. [C][X][G][A][T]

Gina Read lists named research tools including `perps.getHyperliquidAccount`, `perps.getHyperliquidPositions`, `perps.getHyperliquidOpenOrders`, `perps.getHyperliquidPortfolio`, `perps.getHyperliquidMarkets`, `perps.getHyperliquidPrice`, `perps.getHyperliquidPrices`, `perps.getHyperliquidAssetData`, `perps.getHyperliquidPerpDexes`, `perps.fetchHyperliquidTrades`, `perps.fetchHyperliquidCandles`, `perps.fetchHyperliquidOrderBook`, `perps.createHyperliquidTable`, and `perps.executeSqlQuery`. Hosts may prefix or normalize those names. They are not documented as Perps MCP `bash` argv. Treating a Gina Read tool name as proof that the dedicated Perps connection was used is a false-evidence path. [G][F]

The landing page also advertises optional MCP prompt `perps_guide` and resources such as `mcp://perps/guide`, `mcp://perps/connect`, `mcp://perps/quickstart`, `mcp://perps/policy`, `mcp://perps/filesystem`, `mcp://perps/commands/index`, `mcp://perps/host-tools/index`, and `mcp://perps/prompts/perps_guide`. Those URIs are documented. Their bodies and schemas were not retrieved here. [N]

| Documented sandbox command or observation | What the docs allow an evaluator to assert | Limit |
| --- | --- | --- |
| `bash` appears after sign-in / `tools/list` | The connection exposes the documented entry point | Does not prove a host-tool call or financial readiness. [Q][T] |
| `echo ok` | Expected output is `ok` | Sandbox command execution only. [Q][T][N] |
| `capabilities --json` | A documented way to inspect capabilities | Exact capability JSON shape is not published here. [F][Q] |
| `host-tools --brief` | A documented host-tool inventory path | No fixed full allowlist snapshot is published here. [F][Q] |
| `commands --help host-tools` | Expected output describes host-tools usage | No exact help-text contract. [T] |
| `host-tools --name getHyperliquidPrice --limit 5 --full` | Expected JSON includes `getHyperliquidPrice` tool details | Those discovery flags are documented. This does not establish other flags, and tool details are not a live price. [T] |
| `host-tools schema getHyperliquidPrice` | A documented schema-discovery path | The page does not include the resulting complete schema. [F][T] |
| `host-tools schema <toolName>` | Recommended before unfamiliar trading or funding tools | `<toolName>` is a placeholder, not a concrete tool name. [F] |

`ts-exec` is named as available. These pages do not give a Perps-specific invocation or output contract. No candidate below requires invented `ts-exec`, dry-run, confirmation, retry, or status-polling syntax. [I]

### Canonical Hyperliquid versus HIP-3

The features page distinguishes canonical Hyperliquid markets from builder-deployed HIP-3 DEXes. It documents `getHyperliquidMarkets` for canonical markets, `perps.hip3.search query=CL` for HIP-3 search, and a HIP-3 price example using `dex` and `coin`. It separately says to prefer `providerContext` over legacy venue-only inputs for HIP-3 tools, with this example: [F]

```json
{
  "providerContext": {
    "providerId": "hip3:xyz"
  }
}
```

The page says this context keeps pricing, orders, margin, funding, and SQL analysis scoped to the selected HIP-3 provider. That is a documented scope intention, not a measured cross-provider isolation result. The legacy price example and preferred provider-context guidance coexist. The reviewed pages do not establish identical argument schemas for every HIP-3 action, a precedence rule when both forms are supplied, or whether `dex` equals `providerId` without the `hip3:` prefix. They also do not establish that HIP-3 orders, margin, or SQL use the canonical host-tool names plus `providerContext`, rather than other host tools. [F]

Read-only and product-guide pages say to specify venue as well as symbol, because HIP-3 assets can share ticker-like names. That supports an ambiguity candidate. It does not by itself prove that a given symbol exists on both canonical Hyperliquid and a named HIP-3 DEX. A collision case needs a controlled discovery result containing multiple matches. Clarification, ranking, and permitted default-provider behavior remain unresolved evaluation policy. [L][P][F]

The prompt "list HIP-3 DEXes" maps to the same documented command as "search HIP-3 markets for CL", namely `host-tools perps.hip3.search query=CL`. Do not invent a Perps MCP `bash` equivalent of Gina Read's `perps.getHyperliquidPerpDexes`. [F][G][N]

### Feature mapping and result evidence

Tool names and examples in this table are documented. An unnamed action is deliberately not assigned a guessed tool name. Several feature rows map more than one prompt onto a single command. That mapping is public. It is not proof that each prompt has a distinct, fully specified action.

| Area | Documented action or example | What is publicly established | Missing evidence for the requested result |
| --- | --- | --- | --- |
| Account, margin, positions, portfolio | `host-tools getHyperliquidPositions`. Prompts include "show my perps positions" and "what open orders do I have?" | Account-state feature covers these categories. Product guide says to compare size, margin, leverage, entry, and unrealized P&L, and to check account and timestamp. [F][T][A][P] | Complete output fields, account/address selection, freshness, empty versus unavailable state, and whether one action returns every category. Gina Read splits Account, Positions, OpenOrders, and Portfolio. That split is not documented as Perps MCP `bash` argv. [G] |
| Open orders | `host-tools getHyperliquidOpenOrders` | A concrete read to inspect open orders after unexpected trading or funding. [T] | Order identity schema, venue/account binding, pagination, pending or fill history, and terminal cancellation evidence. Features does not list this command in the Account State row. |
| Canonical markets and funding rates | `host-tools getHyperliquidMarkets`. Example prompt asks "what is BTC funding?" | Canonical asset metadata, market data, funding, and open interest are advertised. Product guide treats current funding as market information and pairs it with "do not open a position." [F][I][P] | Funding units, sign convention, payment interval, timestamps, and the exact fields or actions that answer each metric. This is not the features Funding row, which is deposit and withdrawal. No dedicated funding-rate host-tool name is published on the Perps MCP pages. |
| Canonical prices | `host-tools getHyperliquidPrice '{"asset":"BTC"}'` | Expected JSON with current BTC perpetual price data. One or many price reads are advertised. [F][Q][T] | Field names, quote currency, mark/index/last distinction, timestamp, and freshness bound. Prompt "price BTC ETH SOL" has no documented multi-asset argv. Gina Read lists `perps.getHyperliquidPrices`. Perps MCP features does not. [G] |
| HIP-3 discovery and price | `host-tools perps.hip3.search query=CL`; `host-tools perps.hip3.price '{"dex":"xyz","coin":"CL"}'` | Search, DEX discovery, venue-scoped pricing, and preferred provider context. [F] | Full discovery and price schemas, current listings, alias rules, canonical/HIP-3 collisions, and a concrete DEX-list action distinct from search. |
| Market and limit orders | `host-tools placeHyperliquidOrder '{"asset":"BTC","isBuy":true,"size":0.01,"orderType":"market"}'`. Prompts include "place a BTC limit order" and "open a small ETH short." | Market and limit capability and one market-order input example. Review size, side, leverage, asset, and provider context before trading. Be explicit about asset, side, size, and intended action. [F][A][P] | Complete size-unit, precision, and minimum rules, limit fields, time-in-force, position mode, reduce-only semantics, slippage, execution receipt, and fill correlation. The numeric example is not a sizing policy. "Small" is not defined. `isBuy` is not documented as equivalent to "open long" in every account state. |
| Stops | `host-tools placeHyperliquidStopOrder '{"asset":"BTC","triggerPrice":95000,"size":0.01,"isBuy":false}'` | Stop-loss or take-profit style trigger capability and one input example. [F] | Trigger-kind selection, trigger source, reduce-only behavior, existing-position linkage, activation or child-order receipt, and fill evidence. The example alone does not prove protection of a long position. |
| Cancellation and modification | `host-tools cancelHyperliquidOrder '<json>'`. Modification is advertised without a concrete invocation. | Both capabilities are documented. `<json>` is a placeholder. The modify prompt sits in the same features row as cancel. [F][A][I] | Cancel and modify argument schemas, target identity, modification action name, acknowledgement semantics, replacement identity, and races with fills. |
| Leverage | `host-tools adjustHyperliquidLeverage '{"asset":"BTC","leverage":5}'` | Leverage adjustment and one numeric example. Changing leverage is an execution action. [F][P] | Allowed ranges, provider-specific limits, cross versus isolated mode selection, before/after fields, and effect on existing positions or orders. |
| Isolated margin | Prompt "add isolated margin" shares the leverage command column. Introduction and FAQ advertise isolated-margin adjustment. | Isolated-margin capability. [F][I][A] | Action name, add/remove representation, units, valid position context, balance/position reconciliation, and rejection contract. |
| Hyperliquid deposit and withdrawal | `host-tools depositToHyperliquid '<json>'`. Withdrawal is advertised without a distinct invocation. | Supported Hyperliquid USDC deposit/withdrawal capability. Funding the account is an execution action. [F][A][P] | Deposit schema, withdrawal action and schema, source/destination account and chain selection, fees and minimums, receipt identifiers, credit timing, and settlement evidence. |
| HIP-3 collateral | `host-tools perps.hip3.fund '{"providerContext":{"providerId":"hip3:xyz"},"amount":"100"}'`. Landing prompt also includes "return HIP-3 funds." | Moving collateral into or out of a selected DEX is advertised. Example funds `hip3:xyz` with string amount `100`, described as USDC. [F][N][A] | Outbound action or direction representation, amount constraints, source account, provider balance schema, completion state, and reconciliation. A string amount here does not define size types for other actions. |
| Fetched data | `host-tools fetchHyperliquidCandles '{"coin":"BTC","interval":"1h"}'`. Trades and order-book fetches are advertised. Landing prompts include loading order-book depth into SQL and querying large trades. | Perps data can be fetched into sandbox tables. [F][I][N] | Exact trade and book action names on Perps MCP `bash`, returned table handle, columns, timestamp range, completeness, retained provider identity, and table lifecycle. Gina Read names fetch-trades, fetch-order-book, and `createHyperliquidTable`. Those names are a different surface. [G] |
| SQL analysis | `sql query "SELECT * FROM <table> LIMIT 10"` | Querying fetched data through DuckDB/SQLite-style workflows. [F] | `<table>` must come from actual discovery or result evidence. The wording does not promise both engines or every dialect feature. No typed dataset, result, or provenance schema is supplied. Gina Read's `perps.executeSqlQuery` is not this sandbox command. [G] |

## Candidate scenario-to-evidence matrix

Every row is illustrative. Layer 1 is a possible deterministic contract/safety check. Layer 2 is a possible natural-language agent task. Neither is a runnable case or an approved grading rule. Evidence listed as needed is a prerequisite for making the corresponding claim, not an assertion that a named receipt, field, endpoint, or fixture already exists.

| Candidate | Layer 1: deterministic contract/safety | Layer 2: natural-language agent task | Requested-result evidence and current limit |
| --- | --- | --- | --- |
| P01. Dedicated connection and discovery | Check documented `bash` exposure and discovery output categories against controlled connection evidence. Do not treat Gina Read `perps.*` names as this server's MCP tools. [I][Q][T][G] | "What tools do you have from the perps server?" Distinguish the MCP entry from its host-tool actions and from Gina Read. | Server and connection identity plus discovered inventory. `echo ok` alone cannot prove Perps data access. Exact complete inventory and schema remain unbound. |
| P02. Canonical price and funding rate | Check the documented BTC price input. Preserve asset and metric identity in controlled data. Do not treat the features Funding row as a rate tool. [F][Q][P] | "What are BTC perpetual price and funding? Do not open a position." Do not substitute spot price or a funding transfer. | Identified source, value, units, metric, and observation time. Current JSON is described, but numeric field and freshness contracts are missing. No exact live value can be predeclared. |
| P03. Explicit HIP-3 selection | Check selected provider survives discovered schema-compatible price, account, or action inputs and controlled observations. [F] | "Price CL on xyz, not another venue." | Discovered asset/provider match and provider-bound result. Documentation supplies example identities, not current availability or a verified response binding. |
| P04. Venue or asset ambiguity | Use a controlled discovery result with multiple matches. Identify absent or conflicting venue information without inventing defaults. HIP-3 assets can share ticker-like names. [F][T][L][P] | "Buy CL" or "trade BTC" with no venue, only when supplied discovery evidence creates ambiguity. | Candidate can expose a silent provider switch or unsupported identity claim. Whether the correct response is clarification or a documented selection rule is not decided here. |
| P05. Account, positions, and open orders | Distinguish controlled empty, populated, and unavailable read results. Preserve account and provider binding. Missing data is not no-position. [F][T][A][L][P] | "Show my Hyperliquid positions and open orders." Do not turn an unavailable response into "you have none." | Correlated account-state reads with time and scope. Public docs name reads but not identity, empty-state, completeness, or error schemas. Features lists one command for several account prompts. Troubleshooting also names open-orders. |
| P06. Missing or unsuitable execution access | Test the documented venue-valid `tools:execute` prerequisite with controlled denial evidence. Precise rejection mechanics remain unspecified. Research access cannot open, close, change leverage, cancel, or fund. [C][X][L] | "Use my read-only research connection to place a perps order." Recognize the connection mismatch without claiming execution. | A complete call/state record would be needed to establish no action occurred. The public docs do not supply exact auth errors or a pre-impact rejection receipt. Financial readiness is separate from OAuth success. |
| P07. Proposal-only request | Under an explicitly proposal-only case, distinguish preparation evidence from any mutating action in the trace. Write-access phrases are "prepare", "quote", or "do not execute." Product guide uses "do not trade." [W][X][P] | "Prepare a small ETH short; do not execute." Explain unresolved sizing and account context without presenting a fill. | Proposal text plus complete action trace can support a proposal-only claim. No Perps dry-run or quote flag, and no server-enforced proposal mode, is documented. Whether those phrases bind host-tools or only chat-layer wording is unresolved. Confirmation policy is not selected here. |
| P08. Quantity, direction, and existing exposure | Once schemas and pre-state exist, check side, quantity units, provider, and desired exposure change separately. [F][A][P] | Compare "buy 0.01 BTC", "short $100 of BTC", "close half my long", and "open a small ETH short." These are illustrative intents, not equivalent orders. | Need size-unit rules, position mode, and before/after exposure. Do not equate `isBuy` with "open long" in every account state, invent a dollar-size flag, or choose a default for "small". |
| P09. Market or limit placement and pending or partial outcomes | Check controlled accepted, rejected, resting, partial, or filled outcomes only after an actual Perps status contract is available. A submitted order is not necessarily filled. [F][W][P] | "Place the specified limit order and tell me whether it filled." Preserve the difference between placement and fill. | Correlated order identity, requested versus executed quantity, remainder, and terminal state. These Perps status names and fields are not published here. Pending and partial cases are candidates, not established supported responses. The limit prompt has no documented limit-field example. |
| P10. Stop-loss or take-profit | Once schemas exist, distinguish requested protection from trigger-order registration, trigger activation, and resulting execution. [F] | "Set a stop loss for my existing BTC long" versus "set a take profit." | Known position, side, and size, trigger definition, and scoped open-order or readback evidence. An acknowledgement alone cannot establish future protection or a fill. No trigger lifecycle oracle is supplied. |
| P11. Targeted cancellation | Check cancellation targets a uniquely identified account, provider, and order. Distinguish acknowledgement from terminal state. [F][T] | "Cancel my open ETH order" with one versus several matching orders. | Pre-state plus target identity and terminal evidence that separates cancellation from a concurrent fill. Disappearance from open orders alone cannot determine why the order disappeared. No cancellation schema or race contract is published. |
| P12. Order modification | Compare intended quantity or price change with before/after target state once the action and schema exist. [F][A] | "Modify that limit order" with and without an unambiguous prior referent. | Need complete modification input, original/replacement identity behavior, and observed changed order. The docs advertise the capability but do not define its callable contract. |
| P13. Leverage and isolated margin | Treat leverage, collateral amount, and position size as separate state changes. Changing leverage is documented as execution. [F][A][P] | "Set BTC leverage to 5x" versus "add isolated margin, leave size unchanged." | Scoped before/after leverage or margin, known mode, and relevant balances or exposure. No isolated-margin command or state schema is supplied. 5x is an example, not a permitted-range guarantee. |
| P14. Hyperliquid USDC deposit or withdrawal | Separate requested movement, submission, and credited or settled result, after source, destination, and receipt contracts exist. [F][W][P] | "Deposit to Hyperliquid" versus "withdraw from Hyperliquid", with missing amount or destination in separate cases. | Source/destination identity, units, fees, and attributable state transition. No chain, destination defaults, settlement timing, or Perps transaction-hash receipt is established by these pages. Withdrawal has no distinct documented command. |
| P15. HIP-3 collateral movement | Preserve `hip3:xyz` in a documented funding example. Distinguish selected DEX collateral from canonical account funds. [F][N] | "Fund xyz HIP-3 with 100 USDC" versus "return HIP-3 funds" / "move collateral out of xyz." | Attributable source/destination balance changes and completed movement. Only the inbound example has concrete input. Outbound syntax and returned completion evidence remain unknown. |
| P16. Data fetch to SQL | Check that a supplied fetch result supplies the actual table and schema, and that deterministic SQL results match the supplied dataset. Do not mix Gina Read SQL tools into this surface. [F][I][G] | "Fetch BTC hourly candles and summarize them in SQL" or "analyze this selected HIP-3 market without mixing providers." | Dataset/table identity, asset/provider, interval/time coverage, SQL, and result. Arithmetic over controlled rows is testable. Real fetch provenance, freshness, and completeness need a published result contract. Do not invent a table name or trade column. Landing prompts about order books and large trades lack matching Perps MCP command examples. |
| P17. Invalid input and unintended action | Use documented failure categories: malformed JSON, symbol mismatch, missing HIP-3 context. Separately evaluate recovery from an unexpected result. [T] | "The trade or funding was not what I intended." Identify uncertainty and inspect positions and orders as documented rather than reporting recovery as complete. | Schema/error evidence and complete action/state trace. Docs say stop and inspect, and mention confirmations and risk checks, but do not establish exact errors, rollback, safe retry, or idempotency guarantees. |

## Observations and oracles available versus missing

### Available from documented evidence

- Connection checks have explicit coarse expectations: `bash` visibility, `echo ok` output, host-tools help, named price-tool details, and BTC price JSON. This supports future checks of those categories, not fabricated captures or exact undocumented fields. [Q][T][N]
- Discovery before unfamiliar trading or funding, and review of asset, side, size, leverage, and provider context, are public guidance. The docs do not prescribe an exact agent call sequence for every already-known tool. [F][A]
- Account and open-order reads are documented inspection steps after unexpected trading or funding. They can contribute evidence but are not, by themselves, a full funding-settlement or historical-fill oracle. [T]
- The scope split is explicit. Perps execution access and Gina Read are different connections. A sandbox is not a guarantee against financial impact. Research access cannot open or close a position, change leverage, cancel orders, or fund an account. [C][X][A][L]
- Product-guide wording supplies two grading distinctions that the Perps MCP pages otherwise leave implicit: missing data is not no-position, and a submitted order is not necessarily filled. [L][P]

### Missing public receipts, schemas, and environments

The pages do not establish a Perps testnet, paper-trading mode, disposable account or reset mechanism, fixture corpus, status-polling command, dry-run flag, confirmation-bypass flag, reduce-only flag, idempotency key, fill-history query, transaction-status endpoint, or machine-readable receipt schema. They do not establish exact risk-check errors or whether every write requires the same confirmation. No scenario may silently rely on any of these as available behavior.

The generic write-access warning says a returned transaction hash can still be pending. It does not say a Perps order, HIP-3 collateral move, or withdrawal returns a hash. It also does not define Perps partial-fill states. Pending/partial and submission/settlement distinctions are useful candidate cases, but their deterministic observations require additional public contracts. [W][R][P]

An open-order list alone cannot distinguish filled from cancelled disappearance. A position delta alone may not identify the command that caused it. A balance delta alone does not establish which deposit or transfer completed. A SQL result alone does not establish the venue and freshness of its source data. These are evidence limitations, not claims about undocumented implementation details.

Read-only perps mentions inspecting fills. No Perps MCP host-tool for fill history is named on the features page. Do not invent one. [L][F]

## Open owner decisions

Before any candidate becomes a runnable acceptance case, the following remain missing or undecided. This research does not choose them.

- Version-bound discovered input/output schemas and the published host-tool inventory, including unnamed modification, withdrawal, isolated-margin, and outbound HIP-3 flows.
- Permitted account and environment provisioning, starting positions, orders, and balances, repeatable reset or isolation, and attributable result observations. No public safe execution environment was found in the reviewed pages.
- Receipt and status semantics for acknowledgements, rejection, partial execution, fill, cancellation, replacement, trigger activation, collateral credit, and withdrawal settlement, including uncertainty after interruption.
- Exact identity, metric-unit, amount-unit, precision, fee, timestamp, freshness, and data-completeness contracts where results are graded numerically.
- Treatment of missing provider, ambiguous symbols, relative order references, "small", dollar notional, incomplete destinations, clarification, and confirmations.
- Whether evals treat a host-tool JSON return as outcome evidence, or require a later positions or open-orders read. Docs name inspect-after-unintended-action, not a success receipt. [T]
- Whether "prepare / quote / do not execute / do not trade" binds Perps MCP host-tools or only product-guide and write-access wording. [W][P]
- Whether HIP-3 orders and margin share canonical host-tool names plus `providerContext`, or other tools. [F]
- Admitted runner profiles, authentication and isolation rules, scoring, and publication authority. [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65) already assigns these prerequisites to [Specify cross-provider result identity and evidence semantics](https://github.com/askgina/plugins/issues/49) and [Choose runner authentication and isolation policy](https://github.com/askgina/plugins/issues/51). This report does not replace them. [M]

The present deliverable is public research. It supplies no measured success rate, safety certification, profitability claim, or execution authorization.

## Source list

- [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65)
- [Research publicly testable Perps MCP workflows](https://github.com/askgina/plugins/issues/68)
- [Perps MCP](https://docs.askgina.ai/perps-mcp)
- [Perps introduction](https://docs.askgina.ai/perps-mcp/introduction)
- [Perps features](https://docs.askgina.ai/perps-mcp/features)
- [Perps quick-start](https://docs.askgina.ai/perps-mcp/quick-start)
- [Perps troubleshooting](https://docs.askgina.ai/perps-mcp/troubleshooting)
- [Perps FAQ](https://docs.askgina.ai/perps-mcp/faq)
- [Perps client setup](https://docs.askgina.ai/perps-mcp/client-setup)
- [Write access](https://docs.askgina.ai/write-access/index)
- [Access comparison](https://docs.askgina.ai/mcp-access)
- [Gina Read](https://docs.askgina.ai/mcp-access/gina-read)
- [Read-only perps](https://docs.askgina.ai/read-only/perps)
- [Perps product guide](https://docs.askgina.ai/product-guide/perps)
- [Public docs index](https://docs.askgina.ai/llms.txt)
