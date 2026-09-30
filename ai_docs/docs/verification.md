# Docs overhaul verification

Implementation tracker: [#42](https://github.com/askgina/plugins/issues/42).

## Verified locally

- 65 public MDX pages, seven images, single-sidebar navigation, six legacy OpenClaw redirects, internal Markdown and component links, skill names, read catalog parity, and endpoint/scope checks pass `node tools/docs/check.mjs`.
- Seven regression tests pass with Node's test runner. They cover broken card/image links, missing alt text, traversal, nested navigation duplicates, redirect cycles, orphan content, first-party absolute links, and plain-Markdown corpus compatibility.
- The actual `parseAndValidateFrontmatter` and `validatePlainMarkdown` functions from the chatbot's `lib/docs/corpus.ts` at commit `7b7b2bf16` were exercised against all eight current product-guide corpus pages and accepted them. Source H1s, exact metadata keys, reciprocal related slugs, and the 12,000-character corpus cap are preserved. New Predictions/Perps web pages are not automatically added to the chatbot corpus.
- `mint broken-links` reports no broken links. Mintlify preview runs on port 3005. Desktop (1280 px) and mobile (390 px) navigation expose the same sections; nested host and venue groups collapse normally. Wallet guide image renders; inspected preview console has no errors.
- `/openclaw-skills/gina-mcp` returns a 307 redirect to `/agents/plugins-and-skills` locally. All redirect destinations resolve through the source checker.
- External links pass, with one explicitly reported exception: Perplexity's verified primary guide responds 403 to non-browser requests. The checker retries GET, then warns only for this exact URL/status. See the host verification note for the primary source.
- Changed files formatted with the installed standalone Oxfmt; standalone Oxlint reports no warnings for the docs checker. `git diff --check` passes.
- Temporary screenshot fixtures were removed; the chatbot checkout remains clean. No tokens were generated and no financial actions executed.

## Release checks still required

- Capture the current signed-in first-chat screen. The existing chat composer Storybook story fails on the Inngest `BaseMiddleware` mock, and no demo account was supplied. An older unused welcome component was rejected as misleading. Seven other actual component captures are included; provenance is in `screenshots.md`.
- Perform authenticated Gina setup and one read request on each advertised host. Primary host documentation establishes the setup routes, not end-to-end account success. Public listing URLs remain unverified and are not advertised as released installs.
- After publishing through the existing Mintlify deployment, check `/llms.txt`, `/llms-full.txt` where supported, and page Markdown exports. The installed local preview redirects these export URLs to `/index`, so it cannot verify generated export contents. Production still serves the prior docs until deployment.
- Full repository Bun checks were not run: installed Bun 1.3.1 cannot parse this repository's lockfile version 2; the repository requires Bun 1.4.x. The frozen install failed without modifying the lockfile. Standalone docs tests, lint, formatting, source validation, actual corpus parser validation, and Mintlify checks were run instead.

## Product-first revision — 2026-09-06

- Product overview and capabilities lead Start here, followed by wallet, nested automations, files/memory, and credits. Agents and connection setup follow.
- Removed eight community source pages and the leaderboard source; incoming routes redirect to maintained help or portfolio content.
- Updated the sibling chatbot's corpus catalog and expected-slug test, and synchronized all eight maintained corpus sources into its vendored product guide. These changes must ship with the docs removal.
- `node tools/docs/check.mjs`: 61 pages and 7 existing images pass, including navigation, redirects, permissions, metadata, and corpus size.
- `node --test tools/docs/check.test.mjs`: 7 tests pass.
- `mint broken-links`: no broken links.
- Chatbot `vitest --run lib/docs/corpus.test.ts`: all 10 tests pass against the synchronized sources.
- Local Mintlify homepage renders the product-first cards and updated sidebar, with no leaderboard/community sections.
- Product-owner screenshots remain pending; insertion destinations are recorded in `screenshots.md`. No broken image placeholders added. Connector logos remain separate follow-up assets.

## Chatbot corpus expansion — 2026-09-28

- Predictions, Perps, and the four `product-guide/automations/*` pages now carry the chatbot corpus metadata and a source H1, with reciprocal `relatedSlugs` to the overview, wallet, transactions, and automations pages. This supersedes the earlier note that new Predictions/Perps pages are excluded: 13 of 15 product-guide pages are in the chatbot Docs Agent corpus. `safety-support-and-limitations` and `liquidity-positions` stay catalogued but excluded (`includeInDocsAgent: false`); transactions now lists `liquidity-positions` reciprocally.
- `tools/docs/check.mjs` validates all 15 product-guide routes and caps the assembled corpus at 24,000 characters (20,513 at this revision).
- `node --test tools/docs/check.test.mjs`: 9 tests pass. `node tools/docs/check.mjs`: 65 pages and 27 images pass, including corpus metadata, reciprocity, and size.
- The sibling chatbot mirrored all 15 files through `bun run docs:sync-product-guide:from`; its corpus, sync, and public-review tests pass against them.
- `bun run lint` was not run locally: installed Bun 1.3.14 cannot read this repository's lockfile version 2 and `vp` is unavailable. PR CI runs the full lint.

## Standalone docs lint boundary

The docs workflow deliberately runs under Node without workspace dependency installation. `vite.config.ts` exempts only `tools/docs/check.mjs` and `tools/docs/check.test.mjs` from five Effect migration diagnostics (Node imports, async functions, console, Date, fetch). General lint rules and `--deny-warnings` remain enabled; application and other tooling files retain the full Effect preset.

Verified using oxlint 1.78.0 and oxlint-tsgolint 7.0.2001 patched by @effect/tsgo 0.36.5 in an isolated temporary installation: the original preset reproduces all 12 CI warnings, and the override extracted from vite.config.ts passes with zero warnings. Docs validation and all seven checker tests pass. This targeted reproduction does not substitute for the full CI build.

## Claude phone apps — 2026-09-29

- `docs/connect/claude.mdx` adds a Claude on iPhone and Android section. The iPhone link (`claude://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Gina&connectorUrl=…`) was verified by the product owner on an iPhone; the Android link (`claude://claude.ai/add-connector?name=Gina&url=…`) was verified by the product owner in the Claude Android app on a BlueStacks emulator, not yet on a physical Android phone. Both open Claude's Add custom connector screen with Gina filled in.
- Anthropic documents `claude://` only for Claude Code routes ([Open the Claude mobile app with a link](https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link)), so the page labels these links undocumented and keeps the web and Desktop steps as the fallback.
- `tools/docs/check.mjs` skips `claude:` links like `mailto:` and `tel:`, since they are app deep links rather than docs routes; the broken-link regression test covers one alongside two real misses.
- `node tools/docs/check.mjs`: 65 pages pass. `node --test tools/docs/check.test.mjs`: 9 tests pass.

## Claude one-tap install buttons — 2026-09-30

- `docs/connect/claude.mdx` now opens with three Mintlify cards: Web browser (`https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Ask%20Gina&connectorUrl=…`, the link the Gina connect widget uses), iPhone and Android (the owner-verified `claude://` links, moved up from the phone section). The manual web/Desktop steps, the phone note and both Claude Code routes stay below.
- In a local `mint dev` preview all three cards render as `<a>` elements with those exact `href`s, on a 1280 px desktop and a 390 px phone viewport.
- claude.ai answers scripted and headless-browser requests with a Cloudflare challenge (HTTP 403, "Just a moment…"), so `tools/docs/check.mjs --external` lists that exact URL in `BOT_CHALLENGE_403_URLS` next to the existing Perplexity entry; any other status still fails.
- `node tools/docs/check.mjs` and `--external` pass (65 pages); `node --test tools/docs/check.test.mjs` passes.

## Claude compact install buttons — 2026-09-30

- The three one-tap cards in `docs/connect/claude.mdx` are now horizontal, title-only buttons: Web (Claude spark, the existing `docs/images/clients/claude.svg`), iPhone (Font Awesome brands `apple`, `#8E8E93`) and Android (brands `android`, `#3DDC84`), replacing the theme-brown icons. One paragraph below the buttons carries the per-button detail. The `href`s are unchanged.
- In a local `mint dev` preview all three buttons render as `<a>` elements with those `href`s, on one row at 1440 px and stacked at 390 px.
