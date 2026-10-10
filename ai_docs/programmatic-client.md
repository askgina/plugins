# Programmatic client

Internal engineering notes; consumer recipes belong in the [SDK README](../packages/sdk/README.md) and [CLI README](../packages/cli/README.md).
Both clients use only `https://askgina.ai/ai/gina/mcp`, with a caller-supplied Gina-issued `tools:read` bearer; URL overrides are unsupported.
Public onboarding authority: [authentication](https://docs.askgina.ai/agents/authentication), [MCP access](https://docs.askgina.ai/mcp-access/index), and [Agent Setup](https://askgina.ai/agent-setup).

## Runtime and installation authority

These unpublished packages are consumed as packed, compiled ESM artifacts, never workspace `src/` imports; package-root imports only.
`@askgina/contracts` and `@askgina/sdk` support Node.js `>=24` or Bun `>=1.4.0`; CommonJS, browsers, edge runtimes, and package subpaths are unsupported.
The CLI requires Bun `1.4.x`, even alongside the Node-compatible SDK; its `ask-gina` bin is `./dist/bin.js` with a Bun shebang.
Repository tooling pins Bun `1.4.0`; packing and Node consumer verification require Node `24.x`, narrower than the SDK consumer range.

| Consumer | Internal closure, all version `0.1.0` | Direct external runtime dependencies                      |
| -------- | ------------------------------------- | --------------------------------------------------------- |
| SDK      | contracts + sdk                       | `effect@4.0.0-rc.111`, `@modelcontextprotocol/sdk@1.32.0` |
| CLI      | contracts + sdk + cli                 | SDK dependencies plus `@effect/platform-bun@4.0.0-rc.111` |

Tarballs externalize dependencies, rather than bundling them. Contracts also depends on Effect; consumers importing Effect directly should declare it directly.
Platform-bun brings platform-node-shared; both peer on Effect, and the repository pins node-shared to `4.0.0-rc.111`.
The MCP SDK brings dependencies including Zod; its `@cfworker/json-schema` peer is optional. These are not additional internal artifacts.
Packed manifests rewrite `workspace:*` to `0.1.0`, not sibling tarball paths; installing the SDK or CLI tarball alone is insufficient.
The README consumer manifests use local tarballs and internal overrides; external resolution still requires registry access or a populated cache.
Those minimal manifests are not the verifier's exact locked graph: [`cleanInstall`](../tools/verify-artifacts.ts) generates temporary SDK/CLI manifests with absolute `file:` paths and lock-matched external/root/internal overrides.
Version/closure authorities: [contracts](../packages/contracts/package.json), [SDK](../packages/sdk/package.json), [CLI](../packages/cli/package.json), [bun.lock](../bun.lock), and [root overrides](../package.json).
The root `tinypool` override patches prototype-pollution/RCE advisories despite the formatter's exact vulnerable pin; retain it until the formatter admits a patched worker version.
Other compatible transitive security patches stay in `bun.lock` rather than becoming new direct dependencies.

## Existing artifact tooling (reference, not execution evidence)

[`build`, `artifacts`, `verify:artifacts`, `verify:packages`, and `smoke:install`](../package.json) are existing scripts; their dependencies live in the [task graph/build configuration](../vite.config.ts).
Package builds use `vp -C ../.. pack --filter <package-slug>`; this emits ignored package `dist/` JavaScript, declarations, and maps, not release tarballs.
Maps embed committed TypeScript with relative source paths; see the [contracts README](../packages/contracts/README.md).
`artifacts` invokes the [packer](../tools/pack-artifacts.ts) after quality/build/test dependencies; its direct entrypoint is `bun tools/pack-artifacts.ts`.
The packer accepts no arguments, runs from the repository root, and removes/recreates root `dist/`; unrelated output must live elsewhere.
It requires a clean source tree, snapshots committed HEAD, installs frozen dependencies from populated offline Bun cache, and rebuilds the snapshot.
Neither `npm pack`, `bun pm pack`, nor invented output-directory flags substitutes for that process.
Outputs are `dist/packages/askgina-{contracts,sdk,cli,plugin-core,evals}-0.1.0.tgz` (five separate files).
Only contracts + sdk are needed for SDK consumption; add cli for CLI consumption. Plugin-core/evals are outside both consumer closures.
Archives have a `package/` root with manifests, compiled `dist/`, README, and LICENSE, not raw `src/`; target/skill archives and `dist/receipts/packages.json` are also emitted.
`verify:artifacts` follows artifact generation; `verify:packages` and `smoke:install` both invoke `bun tools/verify-artifacts.ts --packages`.
Verification regenerates canonical artifacts and performs isolated offline installs: it is not lightweight/read-only and shares the clean-tree/cache/runtime prerequisites.
The [verifier](../tools/verify-artifacts.ts) exercises installed CLI help/version and Node SDK synthetic injected-transport `listTools()`, not authenticated calls.

## Authentication and operation semantics

In Agent Setup, sign in, choose **Generate Token**, name it, and explicitly select **Read-only — view data** before generating.
The form may default to **Full access — view and execute**; changing a server URL does not change the token's scope.
Keep real tokens in private configuration or a secret manager, never source, commits, shell history, or chat; synthetic fixtures are not production credentials.
SDK callers pass `createClient({ accessToken })` explicitly; the SDK does not read `ASK_GINA_ACCESS_TOKEN`. The CLI reads that environment variable and has no `--token` flag.
Manual tokens expire after **90 days**; **Active Tokens → Revoke** invalidates them. Generate replacements and update every private client configuration yourself.
Manual-token lifetimes do not describe OAuth tokens obtained through a compatible external client.
Neither client implements login, DCR, browser consent, automatic refresh, or revocation; both send the supplied bearer.
SDK methods return Effects; construction makes no request, and `Effect.runPromise` executes an operation. Each operation manages its connection; there is no caller-managed close API.
Calls return MCP results, not synthesized answers; MCP `isError: true` becomes an SDK tool error. Authorities: [client](../packages/sdk/src/client.ts), [transport](../packages/sdk/src/transport.ts).
CLI help/version need no credentials or authenticated request; version is `0.1.0`. The installed bin can be invoked through Bun without adding it to PATH.
CLI `list`, `call TOOL [JSON]`, and `ask TOOL [JSON]` make real authenticated requests and print JSON; `list` returns names, not input schemas.
`ask` is exactly a call alias, not natural-language chat, an LLM agent, or automatic tool selection; both call forms require a supported tool name.
Omitted JSON becomes `{}`; supplied JSON must be an object, not an array, scalar, or `null`.
CLI authorities: [command](../packages/cli/src/command.ts), [run](../packages/cli/src/run.ts), and [bin](../packages/cli/bin.ts); executable consumer examples remain in the READMEs.

## Supported surface and side effects

The [read catalog](../packages/contracts/src/index.ts) has **31 reads**: 3 Gina/account, 4 Spot, 15 Perps (including 2 analytics), and 9 Predictions.
The connected allowlist adds **`gina.renderReadOnlyDashboard`**, giving 32 callable names; unknown names fail before transport.
`listTools()` accepts exactly the 31-read or 32-name inventory; missing, extra, or duplicate names fail, rather than being filtered.
This is name validation, not input/output-schema or annotation validation; accepting a dashboard call does not imply a terminal/plain SDK renders its App UI.
Execution is separate: no trading, transfer, leverage changes, schedule creation, or other write/execute catalog is supplied.
App-only additions `gina.showConnectOptions`, `predictions.renderPredictionPodium`, `predictions.renderPredictionBinaryMarket`, and `predictions.renderPredictionCollection` are not SDK-callable.
The historically inspected application registered 36 tools for App-capable hosts versus 32 for ordinary hosts; registration count is not model-visible count.
On App hosts, `predictions.getSeriesMarket` and `predictions.getPredictionMarketDetails` were App-only/private; ordinary hosts still registered those reads.
**Read capability means non-trading, not side-effect-free.** `perps.createHyperliquidTable` materializes DuckDB tables, creates/removes temporary JSON staging files, and persists identity-bound dataset metadata.
Canonical dataset metadata expires after one hour; that does not guarantee immediate deletion of every physical table.
`perps.executeSqlQuery` validates bounded read-only SQL, but missing tables can trigger provider-backed rematerialization and retry.
Reads can write internal table/metadata state, call providers, and emit metering/telemetry; neither universal `readOnlyHint=true` nor network-free SQL is promised.

## Source comparison — 2026-10-09

The SDK/CLI contract was compared with application revision `2dbeb8b98cdadc999a5532061dcaed2a22b79bd1`.
The 31 read names, family counts (3/4/15/9), and four automatic widget bindings remain unchanged.
Two analytics annotations were refreshed to match the application's manifest and registration:

| Contract field                              | Current value | Reason                                                        |
| ------------------------------------------- | ------------- | ------------------------------------------------------------- |
| `perps.createHyperliquidTable.readOnlyHint` | `false`       | Materializes temporary analytics state.                       |
| `perps.executeSqlQuery.openWorldHint`       | `true`        | Missing tables can require provider-backed rematerialization. |

The six-field public catalog projection remains intentionally narrower than server metadata.
This comparison establishes name/family/widget-binding and focused annotation parity, not full input/output-schema parity or production deployment parity.

## Provenance and verification boundary

`SOURCE_COMMIT` in contracts identifies the compared application revision.
`catalogSha` hashes the schema-encoded public catalog; annotation changes require recomputing it and updating current synthetic fixtures, not historical measured reports.
Artifact receipt `sourceCommit` instead identifies the committed revision of this repository from which the packer builds. These identities are not interchangeable.

Local builds, tests, compiled-client smoke checks, and isolated tarball installs establish package behavior, not authenticated production success.
Production claims require separate deployment binding and an authorized request with a real Gina-issued read credential.
