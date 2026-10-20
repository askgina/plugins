# Docs Agent corpus headroom for Spot LP docs

Research for #177, part of #168. Written 2026-10-20.

Sources read:

- t-y-b-b/nextjs-ai-chatbot at `67767a3ffe961189e310993bb3c911f72b72992a`. Paths without a prefix are in that repo.
- askgina/plugins at `0805b519820874c392474bb445610437cded284c`. Paths starting with `plugins:` are in this repo.

## Answer

The corpus has 3,487 characters of headroom out of 24,000. The five Spot LP pages add 37,838 characters raw, which is 10.9 times the headroom. They cannot go in as they are.

Even the existing `product-guide/liquidity-positions` page, which is excluded today, does not fit. Including it takes the corpus to 25,564 characters, 1,564 over the cap.

Two things are needed:

1. Deduplicate the LP pages so each fact lives in one place.
2. Add one compact, plain-Markdown LP page to the Product Guide, and raise the cap from 24,000 to about 28,000 in three places at once.

The Spot MCP pages themselves cannot enter the corpus. They fail the corpus format rules in four ways, listed below.

## Limits that exist

There is one hard limit, a character count over the assembled prompt text. There is no token limit and no per-page limit.

| Limit                                       | Value          | Where                                                                      |
| ------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| Total characters of the assembled corpus    | 24,000         | `lib/docs/corpus.ts:92`, enforced at `lib/docs/corpus.ts:319-323`          |
| Same cap asserted in the chatbot test       | 24,000         | `lib/docs/corpus.test.ts:212-213`                                          |
| Same cap asserted upstream in the docs gate | 24,000         | `plugins:tools/docs/check.mjs:255-257`                                     |
| Per-page limit                              | none           | no check in `lib/docs/corpus.ts` or `plugins:tools/docs/check.mjs`         |
| Token limit                                 | none           | no token count anywhere in either file                                     |
| `maxContextChars` on the Docs Agent config  | 16,000, unused | `lib/ai/agents/docsAgent.ts:72`, field typed at `lib/ai/agents/types.ts:9` |

`maxContextChars: 16000` has no reader. A search of `lib` and `app` finds only its declarations and one test of a different agent. The current corpus is already 20,513 characters, so the field is not a working limit.

The chatbot loader counts the assembled string, not the page bodies. Each included page contributes `Canonical source: <url>\nReviewed: <date>\n\n<body>`, joined with `\n\n---\n\n`, `lib/docs/corpus.ts:301-306`. That adds about 98 characters per page plus 7 for the separator. The upstream gate builds the same string, `plugins:tools/docs/check.mjs:242-243` and `255`.

Token estimate: at roughly 4 characters per token, 20,513 characters is about 5,100 tokens. [INFERENCE] No tokenizer was run. The model list is `ModelId.OpenRouterDeepseekV41Flash` then `ModelId.OpenRouterO4Mini`, `lib/ai/agents/docsAgent.ts:67`. I did not check their context windows, so the 28,000 figure below follows the repo's own cap logic and not a model measurement.

The cap was 12,000 earlier. `plugins:ai_docs/lp-documentation-maintenance.md:44` and `:56` still say 12,000 and "do not raise the cap silently". The code says 24,000. Fix that doc when the cap moves again.

## Current usage

Measured by running the upstream gate's string construction over the 15 `docs/product-guide` files at askgina/plugins `0805b519`. The chatbot mirror produces the same total, 20,513, at its pinned lock. The mirror's file list is `scripts/sync-mintlify-product-guide.ts:21-39`.

Total: 20,513 characters of 24,000. Headroom: 3,487. Included pages: 13 of 15.

Page bodies, in characters, excluding the 98-character header:

| Page                             | Body  | Included |
| -------------------------------- | ----- | -------- |
| `index`                          | 1,600 | yes      |
| `wallet-and-account`             | 1,510 | yes      |
| `transactions-and-portfolio`     | 1,825 | yes      |
| `liquidity-positions`            | 4,946 | no       |
| `market-research`                | 1,149 | yes      |
| `predictions`                    | 1,670 | yes      |
| `perps`                          | 1,612 | yes      |
| `recipes-and-webhooks`           | 2,771 | yes      |
| `automations/recipes`            | 1,002 | yes      |
| `automations/schedules`          | 945   | yes      |
| `automations/webhooks`           | 1,454 | yes      |
| `automations/copy-trading`       | 1,294 | yes      |
| `memory`                         | 1,042 | yes      |
| `networks-fees-and-pricing`      | 1,319 | yes      |
| `safety-support-and-limitations` | 4,465 | no       |

The two excluded pages set `includeInDocsAgent: false`. The Docs Agent still gets LP signal from short summaries on included pages, `plugins:docs/product-guide/transactions-and-portfolio.mdx:40-42`, `plugins:docs/product-guide/index.mdx:34` and `plugins:docs/product-guide/networks-fees-and-pricing.mdx:29`. `plugins:ai_docs/lp-documentation-maintenance.md:51` records that choice.

## What the LP pages would add

Raw size, characters. Header is the 98-character canonical source block that every included page carries.

| Page                                         | Raw file | Body   |
| -------------------------------------------- | -------- | ------ |
| `docs/spot-mcp/liquidity-positions.mdx`      | 16,072   | 15,918 |
| `docs/spot-mcp/lp-skills.mdx`                | 8,372    | 8,241  |
| `docs/spot-mcp/lp-agent-workflow.mdx`        | 6,158    | 6,020  |
| `docs/spot-mcp/lp-analytics.mdx`             | 4,007    | 3,862  |
| `docs/spot-mcp/lp-scheduled-monitoring.mdx`  | 3,444    | 3,312  |
| Spot MCP pages total                         | 38,053   | 37,353 |
| `docs/product-guide/liquidity-positions.mdx` | 5,225    | 4,946  |

Projected corpus totals:

| Scenario                                          | Corpus chars | Against 24,000 |
| ------------------------------------------------- | ------------ | -------------- |
| Today                                             | 20,513       | 3,487 under    |
| Include `product-guide/liquidity-positions` as is | 25,564       | 1,564 over     |
| Add the five Spot MCP pages raw                   | 58,351       | 34,351 over    |

The five Spot pages also cannot be added as files, because the loader and gate reject them:

1. They have two frontmatter keys, `title` and `description`. The loader requires exactly seven, `lib/docs/corpus.ts:93-101` and `:151-157`. The gate requires the same set, `plugins:tools/docs/check.mjs:141-143`.
2. They have no H1. The loader requires the first line of the body to be `# <frontmatter title>`, `lib/docs/corpus.ts:207-212`. Headings in `spot-mcp/liquidity-positions.mdx` start at `##` on line 8.
3. They use MDX. `spot-mcp/liquidity-positions.mdx:12-18` has a `<Frame>` tag and a `style={{ width: "100%" }}` expression, and `lp-scheduled-monitoring.mdx:18` has a `{/* ... */}` comment. `validatePlainMarkdown` rejects tags and `{...}` expressions, `lib/docs/corpus.ts:110-130`.
4. They live outside `plugins/ask-gina/docs/product-guide/`. The loader reads only that directory, `lib/docs/corpus.ts:253-255`, and the mirror copies only `product-guide` and `connect`, `scripts/sync-mintlify-product-guide.ts:19-56`.

## Overlap among the LP pages

I split the five pages plus `product-guide/liquidity-positions` into paragraphs and 319 sentences of 40 or more characters, then compared every cross-page pair with a similarity ratio. Eleven sentences matched at 0.65 or higher and total 906 characters in their second occurrence. Many more repeat the same fact in different words. The groups below are the ones worth cutting. Lines are in `plugins:docs/`, written `page:line`.

Verbatim or near verbatim:

- "LP quotes do not swap into the desired ratio." at `spot-mcp/liquidity-positions:92` and `spot-mcp/lp-agent-workflow:35`.
- "Prepared, submitted and pending are not settled." at `spot-mcp/liquidity-positions:218` and `spot-mcp/lp-agent-workflow:17`. Reworded at `product-guide/liquidity-positions:61`.
- The pointer "See the LP support matrix" at `spot-mcp/lp-skills:51`, `spot-mcp/lp-analytics:6` and `product-guide/liquidity-positions:22`.

Same fact, restated:

| Fact                                                                                             | Occurrences                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never resend after an unknown or partial result, use status recovery                             | `spot-mcp/liquidity-positions:218`, `spot-mcp/lp-agent-workflow:17`, `spot-mcp/lp-scheduled-monitoring:52`, `product-guide/liquidity-positions:61` |
| Execute with the exact `quoteId` and `planHash`, never a superseded quote                        | `spot-mcp/liquidity-positions:200-202`, `spot-mcp/lp-agent-workflow:16`, `spot-mcp/lp-scheduled-monitoring:26`                                     |
| Review amounts, minimums, fees and expiry before approving                                       | `spot-mcp/liquidity-positions:198`, `spot-mcp/lp-agent-workflow:14`, `product-guide/liquidity-positions:47`                                        |
| Read positions then allowlist with the chain-specific tools                                      | `spot-mcp/liquidity-positions:43-46`, `spot-mcp/lp-agent-workflow:11`, `spot-mcp/lp-analytics:18`                                                  |
| Scanner covers more protocols than Spot MCP can operate                                          | `spot-mcp/liquidity-positions:63`, `spot-mcp/lp-skills:51-53`                                                                                      |
| Scanner allowlist file is separate from the Spot MCP allowlist                                   | `spot-mcp/liquidity-positions:59` and `:67`, `spot-mcp/lp-skills:66`, `spot-mcp/lp-agent-workflow:37`                                              |
| Scheduled runs only flag and propose                                                             | `spot-mcp/lp-skills:77`, `spot-mcp/lp-scheduled-monitoring:6` and `:22-26`, `spot-mcp/lp-agent-workflow:6`                                         |
| Quote expires, re-quote, ask again                                                               | `spot-mcp/lp-agent-workflow:15`, `spot-mcp/lp-skills:83`                                                                                           |
| Estimated fee APR is an estimate, owed amounts can include principal, CPMM fees stay in the pool | `product-guide/liquidity-positions:36-41`, `spot-mcp/lp-analytics:13` and `:34-36`, `spot-mcp/liquidity-positions:226`                             |
| Raydium CLMM full exit is decrease then close, CPMM is withdraw                                  | `spot-mcp/liquidity-positions:34-35`, `spot-mcp/lp-agent-workflow:31`, `product-guide/liquidity-positions:51`                                      |

Duplication inside `spot-mcp/liquidity-positions.mdx` itself. This page is 15,918 characters and the biggest single saving:

- The allowlist update arguments appear three times: `:50-51`, `:66` and `:81`. The revocation rule appears at `:53` and again in the table at `:83-88`.
- Section "Allowlists end to end" (`:57-88`) restates "Discover and select" (`:41-55`).

Doing only the cuts in the third table plus the internal repeats removes roughly 1,500 to 2,500 characters across the Spot pages. [INFERENCE] I measured individual blocks, not a finished edit: `spot-mcp/liquidity-positions:50-51` is 273 characters, `:53` is 220, `:83-88` is 451.

## Which page should own each fact

Pick one owning page per fact. Every other page keeps at most one sentence and a link.

| Fact                                                              | Owner                                                                    | Others                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Support matrix, operation kinds, restrictions                     | `spot-mcp/liquidity-positions#capability-and-access`                     | `product-guide` keeps its 3-row network table at `:16-20` and drops the pointer sentence at `:22`; `lp-skills:51` and `lp-analytics:6` link only |
| Allowlist semantics, arguments, revisions, revocation             | `spot-mcp/liquidity-positions#allowlists-end-to-end`                     | delete `:50-51` and `:53` in "Discover and select", keep one link; `lp-skills:66` and `lp-agent-workflow:37` link only                           |
| Funding, no ratio swap, preparatory swaps                         | `spot-mcp/liquidity-positions#fund-and-quote`                            | `lp-agent-workflow:35` and `lp-analytics:40` link only                                                                                           |
| Execute with exact quote, supersession                            | `spot-mcp/liquidity-positions#execute-the-exact-quote`                   | `lp-agent-workflow:16` keeps the step, drops "Never execute a superseded quote"; monitoring links                                                |
| Settlement states, never resend, status recovery                  | `spot-mcp/liquidity-positions#recover-an-uncertain-operation`            | `lp-agent-workflow:17`, `lp-scheduled-monitoring:52` and `product-guide:61` shrink to the wallet or workflow detail plus a link                  |
| Fee APR meaning, owed balances, CPMM fees, historical vs estimate | `spot-mcp/lp-analytics`                                                  | `product-guide:36-41` shrinks to one sentence plus a link; `spot-mcp/liquidity-positions:226` keeps only the widget label explanation            |
| Scanner scope vs operability, scanner file vs allowlist           | `spot-mcp/lp-skills#scope-differs-from-spot-mcp-support`                 | `spot-mcp/liquidity-positions:63` becomes one sentence plus a link                                                                               |
| Playbook rules, approval, quote expiry, scheduled flag only       | the `lp-rebalancing-playbook` `SKILL.md`, summarized once in `lp-skills` | `lp-agent-workflow:6` and `:15`, `lp-scheduled-monitoring:22` link only                                                                          |
| Exit sequence per protocol                                        | `spot-mcp/lp-agent-workflow` action table `:24-31`                       | `product-guide:51` and `spot-mcp/liquidity-positions:34-35` shrink to one sentence                                                               |

The upstream docs already follow the rule "use upstream sources, not copies", `plugins:docs/spot-mcp/lp-skills.mdx:13`. The dedupe applies it to prose as well.

## Proposal for the corpus

The Docs Agent answers web-app users, so it needs the user-facing LP page and a short account of the agent path. It does not need the tool-argument detail.

1. Keep `product-guide/liquidity-positions` as the one corpus LP page. Set `includeInDocsAgent: true` after trimming it.
   - Cut `product-guide:36-41` (654 characters) to one sentence plus a link to LP analytics.
   - Cut `:22-24` (381 characters) to the table plus one link.
   - Merge `:51-55` (761 characters) and `:61` (397 characters) into one short exit and uncertainty block.
   - Those four blocks total 2,193 characters. Condensing them to under half saves about 1,500 and takes the body from 4,946 to about 3,400 characters. The corpus then lands near 24,000, with no margin.
2. Add one new plain-Markdown page, `product-guide/spot-lp-agents`, under 2,800 characters. It covers what Spot MCP LP can do for an agent, the support matrix reduced to one sentence, the propose and approve rule, and links to `docs.askgina.ai/spot-mcp/*` for detail. It needs the seven frontmatter keys, an H1 that equals its title, no JSX and no braces.
3. Raise `DOCS_AGENT_CORPUS_MAX_CHARACTERS` from 24,000 to 28,000. The sums: 20,513, plus a trimmed LP page of at most 3,500 plus 105, plus the new page of at most 2,800 plus 105, equals 27,023. That leaves about 1,000 characters of margin under 28,000. Change all three places in one commit:
   - `lib/docs/corpus.ts:92`
   - `lib/docs/corpus.test.ts:212`
   - `plugins:tools/docs/check.mjs:256` and its message at `:257`

   Also update the stale 12,000 mention in `plugins:ai_docs/lp-documentation-maintenance.md:44` and `:56`.

4. Land in the order the mirror requires. Upstream first, then the app:
   - Upstream: edit the pages, add the new page to the corpus list at `plugins:tools/docs/check.mjs:204-220`, and raise the cap.
   - App: the mirror's file list at `scripts/sync-mintlify-product-guide.ts:21-39`, `DOC_SOURCES` at `lib/docs/corpus.ts:7-56`, `EXPECTED_SLUGS` at `lib/docs/corpus.test.ts:14`, and the lock file. `scripts/vercel-ignore.sh:27` already rebuilds on any product-guide change.
   - The daily `mintlify-docs-sync` workflow copies the mirror, but a new page needs the three hand edits in the app first, or the sync script fails on the file list.

The Spot MCP pages stay Mintlify only. Agents reach them through `docs.askgina.ai` and, after #171, through its `llms.txt`. The corpus gets the compact version, not a copy.
