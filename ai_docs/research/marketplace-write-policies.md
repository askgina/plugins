# Marketplace rules for financial write plugins

Research for Wayfinder ticket #178, map #168. Checked on 2026-10-20 from primary pages. Nothing was submitted to any marketplace.

The question is whether `ask-gina-spot`, and later perps and predictions plugins, can be listed, and whether D1 (one plugin per MCP endpoint) holds up.

## Verdict

1. No marketplace contradicts D1. Two enforce something close to it. OpenAI allows one connected MCP server per plugin. Devin's hosted entries declare exactly one server.
2. D1 is not the risk. The risk is the listing assumption behind D11, "Spot lists first". OpenAI and Anthropic both bar plugins that move funds from their public directories, however the plugin is packaged.
3. Gemini CLI's gallery indexes one extension per repository root. A per-venue split in one monorepo cannot be indexed there. This is the only place D1 costs us.
4. Every ecosystem lets us run our own marketplace from a git repo with no review. The `askgina/plugins` repo already does this for several hosts.

| Marketplace                        | Public listing path                    | Moves funds or trades                                            | Gambling                          | Regions                                                  | Cost                                                  | Per-venue plugins                         |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| OpenAI ChatGPT and Codex directory | Portal upload of a ZIP, then review    | Barred                                                           | Barred                            | Per-listing country allowlist, plus export and sanctions | Verified identity, minor admin charges, fees reserved | Allowed. One MCP server per plugin        |
| Anthropic Claude directory         | Portal, from a paid claude.ai plan     | Barred unless Anthropic agrees in writing                        | Not named in the directory policy | Supported countries policy applies                       | No fee found, needs a paid plan                       | Allowed. One plugin folder per submission |
| Cursor Marketplace                 | Form, manual review, open source only  | No rule found                                                    | No rule found                     | Export and sanctions law                                 | Free, plugin must be free                             | Allowed through a marketplace manifest    |
| GitHub Copilot, awesome-copilot    | Issue form, then maintainer approval   | No rule found                                                    | No rule found                     | None stated                                              | Free                                                  | Allowed, each plugin its own entry        |
| Gemini CLI gallery                 | Automatic crawl of public GitHub repos | No rule found                                                    | No rule found                     | None stated                                              | Free                                                  | One extension per repo root               |
| Devin marketplace                  | Pull request to the marketplace repo   | No written rule found. Stripe is listed with payouts and refunds | No written rule found             | None stated                                              | None stated, CLA required                             | Hosted entries have exactly one server    |

## OpenAI

Sources: [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), [Submit plugins](https://developers.openai.com/plugins/deploy/submission), [Build plugins](https://developers.openai.com/plugins/build/plugins), [Developer Apps Terms](https://openai.com/policies/developer-apps-terms/), [Usage policies](https://openai.com/policies/usage-policies/). The two openai.com policy pages return HTTP 403 to direct fetches. I read them through a text proxy, so the exact wording below was not checked on the live pages in a browser.

### Funds, trades, gambling

- Plugin guidelines, prohibited fraudulent, deceptive, or high-risk services: "Execution of money transfers, crypto transfers, or investment trades". Spot swaps, transfers and LP, perps orders, and prediction market trades all fit.
- Developer Apps Terms 1.6(h): an app must not "initiate, execute, or otherwise facilitate money transfers, cryptocurrency transfers, or other financial or investment transactions through the Services".
- Plugin guidelines, prohibited goods: gambling, listed as "Real-money gambling services, casino credits, sportsbook wagers, crypto-casino tokens". Usage policies list "real money gambling" under protect people. Prediction markets are not named. Whether a reviewer treats Polymarket trading as a wager is a judgment call. [INFERENCE]
- Commerce is limited to physical goods. Digital goods, tokens and credits are barred, including through freemium upsells.
- Plugin guidelines also bar "Crypto or NFT offerings involving speculation, consumer deception, or financial abuse". That targets offerings, not research, so it does not touch the read-only `ask-gina` plugin.

Result: `ask-gina-spot` fails on the transfers and trades line. Perps and predictions fail on the same line. Read-only `ask-gina` has no stated conflict.

### Tool shape

- Each model-callable operation must be its own tool with annotations. The guidelines bar "discovery, operation selection, or schema fetching with a generic executor to enable operations not individually exposed for review". Our perps and predictions endpoints expose writes mostly through a sandboxed `bash` tool. That shape would fail review even if the policy line did not exist. It supports the D11 plan for native annotated write tools.
- Annotations `readOnlyHint`, `destructiveHint` and `openWorldHint` must be explicit booleans. The guidelines say irreversible transactions are `destructiveHint: true`.

### Process, cost, regions

- One MCP server per plugin: "only one MCP server can be connected per plugin". This is stricter than D1 and agrees with it.
- Submission needs a verified individual or business identity in the OpenAI platform, a privacy policy, terms, support URL, a dedicated test account, five positive and three negative test cases, and a video walkthrough.
- Cost. Developer Apps Terms 7.8 says verification and compliance steps may carry "minor charges" and that OpenAI reserves the right to charge submission or publication fees later. No current fee amount is published in what I read.
- Regions. `publication.countries` in the manifest sets a per-listing country allowlist. Terms 10.3 require compliance with AML and trade laws and bar apps tied to embargoed countries.
- Adding an MCP server to an existing skills-only plugin is not supported. Include it in the first ZIP.
- Own marketplace route. `codex plugin marketplace add owner/repo` adds a git-backed marketplace, and one marketplace can hold many plugins. No review applies. This is the working route for `ask-gina-spot` on Codex.

## Anthropic

Sources: [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [Usage Policy](https://www.anthropic.com/legal/aup), [Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria), [Plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist), [Publish and distribute a plugin](https://code.claude.com/docs/en/plugins/publish), [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces).

### Funds, trades, gambling

- Directory Policy section 4A: "Unless otherwise expressly permitted by us in writing", the directories do not accept software that "transfers money, cryptocurrency, or other financial assets, or executes financial transactions on behalf of users". It covers MCP servers, skills and plugins alike. The connector checklist repeats it.
- Gambling is not named in the directory policy. The Usage Policy page I read, which shows an effective date of 2026-11-12, has no gambling ban either. Placing prediction market orders still fits the financial transactions line in 4A. [INFERENCE]
- Directory Policy 3F makes the developer verify they own or control every endpoint and domain the software connects to. We own `askgina.ai`, so ownership is not the blocker. Section 4A is.
- The Usage Policy lists a personalized recommendation to buy, sell, hold or allocate among specific digital assets as a high-risk finance recommendation. It requires a qualified human to review the advice and disclosure that AI was used. Check this against the read-only research skills before any directory submission.

Result: no directory path for any write plugin unless Anthropic gives a written exception. The read-only plugin has no stated conflict.

### Tool shape

- Read and write must be separate tools. A catch-all tool that takes both safe and unsafe methods is rejected. Annotations `title`, `readOnlyHint` and `destructiveHint` are required. Tool names stay at or under 64 characters.
- Remote MCP servers that need auth must use OAuth 2.0 with certificates from recognized authorities.

### Process, cost, regions

- The portal validates one plugin folder at a time. In a repo with several plugins, each is validated and submitted on its own. Names must be distinct, and look-alikes are held for review. Per-venue plugins fit.
- Submitting needs a paid claude.ai plan. Pro and Max submit from their own account. Team and Enterprise need an Owner or a role with directory permission. No listing fee appears in the pages I read.
- Regions. Directory Policy 1A requires compliance with the supported countries policy. The Usage Policy bars giving access in violation of the Supported Regions Policy.
- Own marketplace route. A `.claude-plugin/marketplace.json` in a git repo publishes the plugin with no submission form. Anyone runs `claude plugin marketplace add owner/repo`. `askgina/plugins` already has this file.

## Cursor

Sources: [Plugins](https://cursor.com/docs/plugins), [Plugins reference](https://cursor.com/docs/reference/plugins), [Marketplace security](https://cursor.com/help/security-and-privacy/marketplace-security), [Marketplace Publisher Terms](https://cursor.com/marketplace-publisher-terms), last updated 2026-05-06.

- No financial transaction, trading or gambling rule appears in these pages. Publisher Terms 4.2 require compliance with all applicable law, including export control and sanctions. 4.5 requires accurate, non-misleading descriptions.
- Review is manual and covers security, data handling and quality. Terms 2.2 add publisher identity and business legitimacy. Cursor may reject for any reason and gives none.
- Plugins must be open source, with permissive licenses only. Apache-2.0 qualifies. GPL, AGPL and LGPL are barred. No binaries ship.
- Cost. Listing is free, and Terms 3.1 require the plugin to be free to users through the marketplace. Our MCP is free to connect, though trades may carry fees at the venue. Whether that counts as charging for use is a question for Cursor. [INFERENCE]
- Per-venue. A single repo can hold many plugins through `.cursor-plugin/marketplace.json` at the root, with unique names. Terms 2.1 say no new application is needed for each added plugin, only a re-index request.
- The security page says the marketplace is curated and Cursor works with a small group of trusted partners. Submission is open, approval is discretionary.

## GitHub Copilot

Sources: [Creating a plugin marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace), [awesome-copilot CONTRIBUTING](https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md).

- awesome-copilot rejects content that circumvents Responsible AI rules, weakens security, enables malicious activity, or circumvents platform policies. It names no financial or gambling rule.
- External plugins enter through an issue form. The repo must be public on GitHub, with an immutable tag or commit SHA. Automated lint and an install smoke test run, then a maintainer approves or rejects. Rejection is terminal for that issue. Approved listings are re-reviewed every six months.
- Paid services are allowed under separate guidance, if the content is neutral. Cost is free. Regions are not mentioned.
- Per-venue. Each plugin is its own entry in the issue form. Fits D1.
- Own marketplace route. A `marketplace.json` in `.github/plugin/` or `.claude-plugin/` makes any repo a marketplace. Users run `copilot plugin marketplace add owner/repo`. No review.

## Gemini CLI

Sources: [Release extensions](https://geminicli.com/docs/extensions/releasing/), last updated 2026-05-08.

- The gallery crawls public GitHub repositories that carry the `gemini-cli-extension` topic and a tag. There is no submission form, no stated content policy and no review. The page says an extension appears "if it passes validation" and does not define the checks.
- The manifest `gemini-extension.json` must sit at "the absolute root of the repository or the release archive". One repo root holds one extension. Per-venue listings from the `askgina/plugins` monorepo cannot be indexed. They would need one repo per venue, or a release archive per venue. This is the only D1 cost I found.
- Cost and regions are not mentioned.
- The page carries a notice that Gemini CLI was replaced by Antigravity CLI for unpaid and Google One users on 2026-06-18. I did not research whether the gallery or the extension format carries over. Check before spending effort here.

## Devin

Sources: [devin-marketplace README](https://raw.githubusercontent.com/CognitionAI/devin-marketplace/main/README.md), [adding-a-plugin skill](https://raw.githubusercontent.com/CognitionAI/devin-marketplace/main/.agents/skills/adding-a-plugin/SKILL.md), repo contents read through the GitHub API.

- Listing is a pull request to `CognitionAI/devin-marketplace`. Contributions fall under a CLA. The repo states no content policy, no financial or gambling rule, no regional limits and no fees.
- Two entry kinds. A plugin authored in the repo under `plugins/<slug>`, where "`mcpServers` declares exactly one server, keyed by the slug". Or a third-party plugin pinned to a full 40 character commit SHA. For the second kind the instructions tell Cognition's reviewer to "review the vendor and the exact upstream commit you are endorsing".
- The repo lists 226 entries. The names include `stripe`, `paypal`, `plaid`, `brex`, `ramp` and `mercury`. The Stripe manifest describes payouts and refunds. So money-moving tools have precedent here. I found no trading or prediction market entry by name. I did not read every manifest.
- Per-venue. The one-server rule for hosted entries is D1. A pinned third-party entry can bundle more.

## D1 check

| Point            | Finding                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| OpenAI           | One MCP server per plugin is enforced. Agrees with D1.                                                                 |
| Devin            | Hosted entries declare one server. Agrees with D1.                                                                     |
| Anthropic        | One plugin folder per submission, distinct names. Agrees with D1.                                                      |
| Cursor, Copilot  | Many plugins per repo are supported. Agrees with D1.                                                                   |
| Gemini CLI       | One extension per repo root. Conflicts with D1 for the monorepo.                                                       |
| Directory policy | OpenAI and Anthropic bar write plugins from their public directories. Packaging does not change this.                  |
| Generic executor | OpenAI and Anthropic reject catch-all tools. Perps and predictions today expose writes through `bash`. D11 is the fix. |

## What this means for D1 and D11

- Keep D1. The packaging question has an answer in every marketplace that matters.
- Change the D11 listing plan. "Spot lists first" is true for self-hosted marketplaces, and possibly for Cursor, awesome-copilot and Devin. It is false for OpenAI and Anthropic public directories. Plan `ask-gina` as the directory listing and the write plugins as repo marketplace installs, unless OpenAI or Anthropic grant a written exception.
- For Anthropic, the written exception in section 4A is the only route. Ask through the directory contact before any engineering for a directory submission.
- For Gemini, decide whether per-venue repos are worth it before chasing the gallery.
- Read-only `ask-gina` stays the safe listing. Re-check its research skills against the Anthropic high-risk finance recommendation rule and the OpenAI "unregulated financial services" line before each directory submission.

## Not verified

- OpenAI usage policy and developer terms were read through a text proxy.
- Whether OpenAI or Anthropic treat prediction markets as gambling. No page says.
- Whether Cursor treats trading fees at the venue as charging for plugin use.
- Venue-level geographic limits, for example on prediction markets. No marketplace page covers them. Check the Ask Gina terms and the venue rules.
- Current OpenAI submission fees. The terms reserve the right and name none.
- Devin's review criteria. The repo documents format only.
