# Product screenshots

Captured 2026-09-06 from actual components in the local chatbot checkout at commit `7b7b2bf16`. Images contain Storybook sample data, not a real account. Crops are made during browser capture, with no fabricated UI. No token was generated and no financial action was executed.

| Asset                     | Story or component                                | Notes                                                                  |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| wallet-balance.png        | wallet-walletdashboard--default                   | Sample balance overview.                                               |
| prediction-outcomes.png   | predictions-predictionseventdisplay--single-event | Cropped to one outcome card; illustrative probabilities.               |
| perps-markets.png         | explore-perpsexplore--default                     | Popular market list; missing fields remain visible as dashes.          |
| workflow-results.png      | create-workflowrunresults--completed-success      | Sample result displays live-run labels; no live workflow was executed. |
| agent-setup-read-only.png | AgentSetupCatalogue, temporary fixture below      | Read-only selected; no generated token or private data.                |
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

The product owner will supply screenshots. Do not publish missing-image placeholders. Add the home dashboard hero to `docs/index.mdx` after the opening product description and before the capabilities section.

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
