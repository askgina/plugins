# LP documentation maintenance and application handoff

- Owner: Ask Gina web team; repository review owner: @ericjuta (existing CODEOWNERS).
- Reviewed: 2026-09-28.
- Verified application: `Gina application (private)`, commit `2e847ae3dd0523e7ea3e3b9944c9b6bcc232fd37`.
- Evidence: committed source, generated registry/schema snapshot and schema-checked templates. No funded transaction was executed. Deployment availability remains unverified.
- Application companion: pending; proposed owner is Ask Gina web team / @ericjuta. No assignment, GitHub issue, application change or published upstream revision is claimed by this local implementation.

## Sources and refresh

The canonical public source is this repository's `docs/`. The authoritative action/access matrix is `docs/spot-mcp/liquidity-positions.mdx`. The short Product Guide table links there.

`tools/docs/lp-contract.snapshot.json` records source commit, per-file SHA-256 hashes, generated native inventory, input schemas and templates validated against actual source Zod schemas. To refresh from a trusted application checkout with dependencies installed:

```sh
node tools/docs/refresh-lp-contract.mjs /absolute/path/to/gina-application <full-application-commit>
bun run docs:test
bun run docs:check
bun run lint
```

The extractor reads committed files with `git show`, follows schema initializer dependencies and evaluates those initializers with the application's Zod version. It never imports tool runtimes or calls providers. Review the source commit before refreshing; initializer evaluation is intended for trusted source. Unsupported source structures fail rather than silently using a copied schema. The snapshot records the installed Zod version; use the lockfile dependencies for the chosen revision.

Placeholder examples are parsed using synthetic identities solely in memory. EVM increase is also checked with the v4 discriminator. Schema acceptance does not establish business checks, ownership, admission, balances, supported token extensions, simulation or settlement. JSON Schema cannot express every Zod refinement; refresh runs the actual Zod parsers. CI pins the exact validated templates and generated tool inventory, so editing either requires a deliberate refresh. CI does not independently fetch private application code or detect a newer application revision.

Review these application files when behavior changes:

- Registry and access: `lib/ai/sandbox/skills/index.ts`, `lib/ai/sandbox/host-tools.ts`, `lib/mcp/spot-tool-registry.ts`, `lib/mcp/gina-read-tool-catalog.ts` and the compiled Gina manifest.
- Quote/status schemas: `app/actions/wallet/tools/{quoteLpOperation,quoteSolanaLpOperation,executeLpOperation,executeSolanaLpOperation}/index.ts`.
- Admission and compilers: `lib/lp/allowlist.ts`, `lib/lp/operations.ts`, `lib/solana-lp/allowlist.ts`, `lib/solana-lp/operations.ts`, `lib/solana-lp/quotes.ts` and settlement modules.
- Wallet: `components/wallet/yield/{yield-tab,lp-position-modal,lp-action-panel}.tsx`, `lib/lp/wallet-actions.ts`, `lib/lp/wallet-actions-contract.ts`, `lib/lp/wallet-positions-contract.ts`.
- Economics: `lib/presentation/composers/lp-explorer.ts`, `lib/lp/positions-preview.ts`, `app/actions/wallet/tools/getLpPerformance/index.ts`.

At this revision, the compiler covers a WSOL deficit with native SOL and reports `wrapsNativeSol`; this takes precedence over contradictory “wraps never happen implicitly” prose in the internal Spot skill. Receive unwrapping is opt-in. The native registry no longer includes the old LONG tools. The public Gina Read catalog in this repository does not list LP tools; internal inheritance does not establish public access.

## Required review contract

LP behavior PRs must link a docs update or explain why there is no public docs impact. This includes registration, protocols, operation kinds, fees, UI labels, quote binding, expiry and result states. The PR template prompts for this; source-to-doc impact cannot be inferred automatically by this repository.

For each relevant docs PR:

1. Update the verified application revision, snapshot, matrix, examples and review dates together.
2. Verify guards and settlement behavior, especially composite recentering. Record deployed tool discovery and release evidence separately from code evidence. Never validate docs with funded execution.
3. Check navigation, links, rendering at narrow/wide widths, and the included plain-Markdown Product Guide corpus without raising its 12,000-character cap.
4. Capture dated Yield list, detail and quote-review illustrations in a representative environment. Use illustrative balances and remove identifying account data. This implementation has no authenticated representative Yield environment, so those three illustrations remain pending.
5. Link a GitHub companion task in `askgina/plugins` and name its owner before publication. The companion is a manual process until application freshness automation exists. This local change does not create an external task or send a message.
6. After publication, verify the live pages, navigation, search and Mintlify-generated `llms.txt`; do not manually edit the generated index.

## Application companion handoff

The detailed `product-guide/liquidity-positions.mdx` is excluded from the Docs Agent prompt. Compact summaries and links were added to existing included pages. Local corpus/plain-Markdown validation passes; this does not update the application's pinned mirror.

The application sync currently assumes exactly nine files. An excluded new page still breaks that directory assumption. The application owner must:

1. Copy an explicit allowed subset while tolerating unrelated upstream files. Preserve source identity, clean published revision, missing-file detection, digests and path safety.
2. Sync the final **published** upstream revision. Include the lock and mirrored pages in one commit. Do not raise the 12,000-character corpus cap silently.
3. Add separate upstream freshness detection using existing CI (request or open one mirror-update PR per revision; avoid duplicates and loops). Existing local hash checks establish integrity only.
4. Add application-side LP behavior/docs-impact checks and run:

```sh
bun run docs:sync-product-guide:from /absolute/path/to/askgina-plugins
bun run docs:sync-product-guide:check
bun run test --run scripts/sync-mintlify-product-guide.test.ts lib/docs/corpus.test.ts 'app/(docs)/__tests__/public-review-content.test.ts'
```

Changed included upstream files to mirror:

- `docs/product-guide/index.mdx`
- `docs/product-guide/wallet-and-account.mdx`
- `docs/product-guide/transactions-and-portfolio.mdx`
- `docs/product-guide/networks-fees-and-pricing.mdx`

New detailed public pages:

- `docs/product-guide/liquidity-positions.mdx`
- `docs/spot-mcp/liquidity-positions.mdx`
- `docs/spot-mcp/lp-analytics.mdx`

Final upstream commit to sync: pending publication. Record the clean published commit here or in the linked companion task at handoff; the application baseline above is not an upstream docs commit. Public pages, a ready PR, a published site and an updated Docs Agent are distinct milestones.

## Local validation, September 28, 2026

- `bun run lint`: passed after restoring the existing lockfile dependencies with Bun 1.4.0. No dependency manifests or lockfiles changed.
- `bun run docs:test`: nine tests passed, including inventory/example drift failures.
- `bun run docs:check`: 65 pages and 25 images passed navigation, links, access and corpus checks.
- `node tools/docs/check.mjs --external`: passed with the existing documented Perplexity HTTP 403 exception requiring browser verification.
- `mint broken-links` from `docs/`: no broken links; all MDX parsed.
- Contract refresh: 36 native tools extracted; six templates validated against actual source schemas, including both Uniswap discriminators and both status tools.
- Mintlify preview: all three new guides rendered at desktop and 390-pixel mobile widths; navigation includes all three. Browser error collection was empty. The analytics table was reduced to two columns after the mobile check.
- Local Mintlify search reports “Not available on local preview”; hosted search and the generated index remain post-publication checks.
- These render checks show the documentation, not a representative authenticated Wallet Yield session. The three wallet illustrations remain pending.

## User-provided ChatGPT widget captures

Added September 28, 2026 from screenshots supplied by the user:

- `Screenshot 2026-09-28 at 15.27.34.png` → `docs/images/product/chatgpt-lp-positions.jpg`: LP inventory cards and filters in ChatGPT.
- `Screenshot 2026-09-28 at 15.28.09.png` → `docs/images/product/chatgpt-lp-position-detail.jpg`: Raydium CLMM detail view, range, amounts, fee APR and simulated fee APY.

Encoded as JPEG at original dimensions to keep each image below the documentation size limit; no crop or content changes. Capture dates are retained here for provenance. The public hero leads with the shared Uniswap/Raydium MCP workflow; its provenance caption was removed at the user’s request. These are evidence of the ChatGPT widget presentation, not Wallet Yield or funded execution. Wallet list, detail and quote-review screenshots remain pending separately.
