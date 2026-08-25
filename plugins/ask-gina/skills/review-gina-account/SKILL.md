---
name: review-gina-account
description: Review the user's live Ask Gina account across cross-chain holdings, linked wallets, and scheduled prompts or recent runs. Use for direct or indirect personal questions such as "what do I hold?" or "which wallets are connected?", even when signed out so Gina can authenticate. For schedule creation or changes and asset-movement requests, provide the secure Ask Gina handoff without calling read tools. Do not use for general education or venue-specific positions or history.
---

# Review an Ask Gina account

Use Gina for supported current or authenticated account data. Keep this skill active across follow-ups while the account-review goal stays the same; reroute when the user changes to token, Hyperliquid, or prediction-market research.

## Choose one primary read

| Intent | Tool | Do not substitute |
| --- | --- | --- |
| Current cross-chain holdings, balances, or allocation | `gina.getCrosschainPortfolio` | A public token price cannot establish what the user owns. Do not claim an empty result is complete when provider status is absent. |
| Linked Ethereum and Solana wallets | `gina.getAccountAddresses` | Do not infer an address from portfolio rows. |
| Scheduled prompts or recent runs | `gina.listScheduledPrompts` | This only inspects schedules; it never creates, edits, pauses, or deletes one. |

Call one primary tool unless the user explicitly combines goals. For “how did my schedules run?”, request recent runs. If the request is personal but the user is signed out, activate Gina and allow authentication instead of replacing the answer with generic information.

## Respond and recover

- Lead with the result. Identify the account, wallet, chain, and time context when returned.
- Preserve structured UI and summarize useful findings instead of dumping raw data.
- State missing values plainly. Never invent an address, balance, timestamp, or provider status.
- Distinguish authentication, invalid input, not found, timeout, oversized result, and upstream failure when the result does.
- Retry at most once only for an explicit timeout or transient result. Otherwise offer the smallest recovery.
- Never silently replace failed Gina data with memory or web data. Label any separately requested fallback as a different source.

## Read-only boundary

Never claim that funds moved or a schedule changed. For write intent, explain the boundary and offer a secure Ask Gina handoff. Set `prompt` to the user's complete current write request using standard query encoding. Opening the link does not submit anything; the user must review and confirm. Example: `https://askgina.ai/new?agent=gina&prompt=Create%20a%20daily%209%20AM%20portfolio%20summary.`.

## Examples

Activate for “Show my linked wallets,” “What do I hold?”, “How is my portfolio allocated?”, “Which accounts are connected?”, and “How did my automations run?” If “show my account” does not identify the desired account slice, ask one focused question.

Do not activate for “What is a crypto wallet?” or “Explain portfolio diversification.” A request such as “Create a daily portfolio summary” is a write handoff, not a completed action.
