# Product screenshots

## Product-owner dashboard capture

`dashboard-home.png` was supplied by the product owner on 2026-09-06 as `Screenshot 2026-09-06 at 16.59.53.png` for the homepage hero. It shows the actual Home dashboard in light mode, including the wallet panel, PnL calendar, quests, and automation summary. The 2990 × 1674 PNG is losslessly compressed to 973,426 bytes, removing its fully opaque alpha channel. Decoded RGBA pixels were verified identical to the supplied original. Account values are visible; their sample/live status was not specified. No credentials or trigger URLs are visible. The chat composer is not shown and remains a separate capture. Included in `docs/index.mdx`.

## Component captures

`chatgpt-prediction-up-down.png` was supplied by the product owner on 2026-09-07 as `Screenshot 2026-09-07 at 11.47.48.png`, identified by the owner as ChatGPT. The original 1896 × 1698 PNG is preserved unchanged (307,618 bytes). It shows a Gold up/down market request and widget with outcome prices, chart, session history, and View market button. The market title and close date say September 3 although captured September 7, and the captured status says Closing; these are not evidence of current status. The host's CSP off badge is visible and preserved; the capture does not establish production CSP configuration, granted scopes, OAuth, or marketplace availability. No credentials are visible. Included in `docs/read-only/predictions.mdx` and `docs/connect/chatgpt.mdx` as an additional ChatGPT prediction-widget example.

`claude-prediction-market.png` was supplied by the product owner on 2026-09-07 as `Screenshot 2026-09-07 at 11.43.56.png`, identified by the owner as Claude. The original 1780 × 2302 PNG is preserved unchanged (517,902 bytes). It shows the NBA champion market prompt, search activity, Gina `predictions.renderPredictionPodium` tool label, NBA: 2027 Champion widget, outcome prices, historical chart, time-range controls, View market button, and assistant summary. Market values and time remaining are historical capture data. No credentials are visible. Host identity is owner-provided because host branding is outside the crop. Included in `docs/read-only/predictions.mdx`. MCP capture #6 (prediction widget) is complete; this does not establish connection settings or granted scopes.

`claude-perps-chart.png` was supplied by the product owner on 2026-09-07 as `Screenshot 2026-09-07 at 11.39.25.png`, identified by the owner as Claude. The original 1796 × 1522 PNG is preserved unchanged (211,389 bytes). It shows the prompt “gina show me a chart of HYPE rn”, the Gina `perps.fetchHyperliquidCandles` tool label, HYPE/USD candlesticks with 1h selected, volume bars, and an assistant summary. Market values are historical capture data. No credentials are visible. Host identity is owner-provided because host branding is outside the crop. Included in `docs/read-only/perps.mdx` and `docs/connect/claude.mdx`. Covers MCP capture #3 (successful request example) and #7 (perps market widget); it does not show connection settings or establish the exact endpoint, scope, or OAuth flow used.

`agent-setup-read-only.png` was replaced with the product owner's light-mode capture supplied on 2026-09-07 as `Screenshot 2026-09-07 at 11.37.15.png`. The original 2976 × 2616 PNG is preserved unchanged (614,211 bytes). It shows the permission notice, token name, Read-only — view data selection, empty Active Tokens section, and OpenClaw Setup configuration template. The authorization value is a placeholder; no token secret is visible. No token was generated during documentation work. Included in `docs/agents/authentication.mdx`. MCP capture #1 is complete; full-access selection and external-host connection/result captures remain pending.

`perps-markets.png` was replaced with the product owner's light-mode web app capture supplied on 2026-09-07 as `Screenshot 2026-09-07 at 11.36.31.png`. The original 2976 × 2106 PNG is preserved unchanged (529,223 bytes). It shows the xyz:AAPL market chart, order form, displayed funding/order confirmation, and an open long position. The order form displays 5x while the existing position row displays cross 20x; these are recorded as shown, not interpreted as matching settings. Account and position values are visible; their sample/live status was not specified. No financial action was performed during documentation work. Included in `docs/product-guide/perps.mdx`. Web app capture #6 is complete; the external-host MCP perps widget remains pending.

`prediction-outcomes.png` was replaced with the product owner's light-mode capture supplied on 2026-09-07 as `Screenshot 2026-09-07 at 10.30.59.png`. The original 2588 × 2212 PNG is preserved unchanged (463,736 bytes). It shows the NBA: 2027 Champion event, probability chart, outcome prices, Buy buttons, and Order book controls. Displayed market data is a historical capture; no trade was executed during documentation work. Included in `docs/product-guide/predictions.mdx`. Prediction market detail capture #5 is complete.

`wallet-balance.png` was replaced with the product owner's light-mode capture supplied as `Screenshot 2026-09-06 at 17.01.22.png` on 2026-09-07. The capture filename dates it to 2026-09-06. The original PNG is preserved unchanged (304,560 bytes). It shows the wallet overview, holdings, and Fund, Swap, and Send controls. Account values are visible; their sample/live status was not specified. No credentials or trigger URLs are visible. The funding details screen is still pending. Included in `docs/product-guide/wallet-and-account.mdx`.

Captured 2026-09-06 from actual components in the local chatbot checkout at commit `7b7b2bf16`. Images contain Storybook sample data, not a real account. Crops are made during browser capture, with no fabricated UI. No token was generated and no financial action was executed.

| Asset                     | Story or component                                | Notes                                                                  |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| workflow-results.png      | create-workflowrunresults--completed-success      | Sample result displays live-run labels; no live workflow was executed. |
| recipient-review.png      | VerifyRecipientDisplay, temporary fixture below   | Illustrative address, never a deposit destination.                     |
| create-prompt.png         | create-herolanding-herochatinput--default         | Actual Create composer with example suggestions.                       |

The standalone chat composer story failed on the existing Inngest `BaseMiddleware` mock. The older WelcomeScreen story renders but is no longer imported by app components, so it is deliberately not used as a current first-chat screenshot. A current signed-in first-chat capture remains a release verification item. No demo account was supplied during this run.

## Reproduce temporary captures

The two fixture-only captures came from a temporary `stories/DocsCapture.stories.jsx` in the chatbot checkout. This public repository does not retain imports from private application modules. Resolve the current component locations inside that checkout, run its existing Storybook, capture the images, and remove the temporary story afterward. Existing Storybook providers supply mock authentication.

For Agent Setup, render `AgentSetupCatalogue` full-screen inside an `SWRConfig` with an isolated empty cache and an empty `/api/mcp-tokens` fallback. Disable revalidation, open the catalogue with an inert change handler, select **Read-only — view data** through the UI, and crop the token form only. Do not click **Generate Token**.

For recipient review, render `VerifyRecipientDisplay` in a 640-pixel-wide container with this synthetic unverified recipient:

- ID: `docs-demo-recipient`
- Address: `0x1111111111111111111111111111111111111111`
- Chain type: `evm`
- Chain ID: `8453`

Do not click **Verify Recipient**.

## Product-first capture handoff

The product owner is supplying screenshots. The home dashboard hero is included in `docs/index.mdx` after the opening product description and before the capabilities section. Remaining captures are pending; do not publish missing-image placeholders.

| Capture                                           | Page                                                       |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Dashboard hero                                    | `index.mdx`                                                |
| Successful research chat                          | `product-guide/index.mdx`                                  |
| Wallet overview and funding details               | `product-guide/wallet-and-account.mdx`                     |
| Transaction review and result/history             | `product-guide/transactions-and-portfolio.mdx`             |
| Prediction market and perps market/position       | `product-guide/predictions.mdx`, `product-guide/perps.mdx` |
| Automations list                                  | `product-guide/recipes-and-webhooks.mdx`                   |
| Filled recipe and simulated result                | `product-guide/automations/recipes.mdx`                    |
| Schedule configuration and completed run          | `product-guide/automations/schedules.mdx`                  |
| Supported webhook configuration and triggered run | `product-guide/automations/webhooks.mdx`                   |
| Trader detail and copy-trading setup              | `product-guide/automations/copy-trading.mdx`               |
| Files browser and saved-memory interaction        | `product-guide/memory.mdx`                                 |
| Credits and cryptoasset purchase review           | `product-guide/networks-fees-and-pricing.mdx`              |
| Agent Setup read-only and full-access states      | `agents/authentication.mdx`                                |
| Account, spot, prediction, and perps MCP widgets  | Relevant `read-only/` guide and supported host guide       |
| Host connection and successful first request      | Relevant `connect/` guide                                  |

Use a consistent demo account, redact credentials and trigger URLs, and identify the host in widget captions. Existing component images can be replaced with full product captures. Recheck the corpus character limit after adding captions to corpus pages. Connector logos are official brand assets, not screenshots; do not present an unverified integration as available.
