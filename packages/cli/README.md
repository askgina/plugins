# @askgina/cli

Compiled, unpublished CLI artifacts for **Bun 1.4.x only**. The installed
`ask-gina` bin points to `dist/bin.js`; do not run workspace TypeScript or use
Node.js to execute it. CommonJS, browser/edge runtimes, and package subpaths are
unsupported.

## Generate local tarballs

In the repository, install dependencies with `bun install --frozen-lockfile` to
populate Bun's cache. Artifact generation requires **Node 24.x**, **Bun 1.4.x**,
and the locked dependencies available in Bun's cache for the offline snapshot
install. From a **clean, committed repository root**, run:

```sh
bun run artifacts
```

The packer builds committed HEAD, not uncommitted source, and **removes and
recreates the root `dist/` directory**. It emits compiled npm-format packages,
not registry publications. Installing only the CLI tarball is insufficient:
its internal dependencies still reference exact release versions.

## Install into a separate consumer

Create a directory beside a checkout named `askgina-plugins`, and save this as
its `package.json` (adjust all file paths if your layout differs):

```json
{
  "name": "askgina-cli-consumer",
  "private": true,
  "type": "module",
  "dependencies": {
    "@askgina/contracts": "file:../askgina-plugins/dist/packages/askgina-contracts-0.1.0.tgz",
    "@askgina/sdk": "file:../askgina-plugins/dist/packages/askgina-sdk-0.1.0.tgz",
    "@askgina/cli": "file:../askgina-plugins/dist/packages/askgina-cli-0.1.0.tgz"
  },
  "overrides": {
    "@askgina/contracts": "file:../askgina-plugins/dist/packages/askgina-contracts-0.1.0.tgz",
    "@askgina/sdk": "file:../askgina-plugins/dist/packages/askgina-sdk-0.1.0.tgz"
  }
}
```

This includes the complete internal package closure. The Bun file overrides
keep transitive SDK/contracts resolution local, following the artifact
verifier's installation pattern. External dependencies still need registry
access or a populated cache; this minimal manifest is not an exact copy of the
verifier's locked external dependency graph.

Run from the consumer directory:

```sh
bun install --ignore-scripts
bun ./node_modules/.bin/ask-gina --help
bun ./node_modules/.bin/ask-gina --version
```

Help and version need no credentials and make no authenticated tool request.

## Authenticate and use

Follow [public authentication guidance](https://docs.askgina.ai/agents/authentication)
and open [Agent Setup](https://askgina.ai/agent-setup). Explicitly select
**Read-only — view data** (`tools:read`); the form may default to full access.
Manual tokens expire after 90 days. Revoke them under **Active Tokens → Revoke**;
generate replacements and update your private environment yourself. The CLI
has no `--token` option, login, OAuth, or automatic refresh flow.
This manual-token lifetime is not an OAuth token lifetime.

Have a trusted launcher or secret manager supply the real bearer as
`ASK_GINA_ACCESS_TOKEN` in the process environment. Never paste a bearer into
chat or put it in source, shell history, or committed files. With that environment
already supplied, these commands make real authenticated requests to
`https://askgina.ai/ai/gina/mcp`:

```sh
bun ./node_modules/.bin/ask-gina list
bun ./node_modules/.bin/ask-gina call gina.listScheduledPrompts '{}'
bun ./node_modules/.bin/ask-gina ask gina.listScheduledPrompts '{}'
```

`list` fetches the live tool list. `call TOOL [JSON]` takes an optional JSON
object (default `{}`). `ask TOOL [JSON]` is exactly a **call alias**, not
natural-language chat. All three require a real bearer and print JSON.

The supported connected surface is the 31 read-catalog tools plus
`gina.renderReadOnlyDashboard`. Separate transaction-execution endpoints and
additional MCP App render/connect tools are unsupported. Read-scoped access is
non-trading, not side-effect-free: analytics can create/recreate temporary
DuckDB tables, persist bounded dataset metadata, and fetch provider data when
rematerializing missing tables.
