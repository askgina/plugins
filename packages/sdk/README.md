# @askgina/sdk

Compiled, unpublished **ESM** artifacts for **Node.js >=24** or **Bun >=1.4**.
Import only from `@askgina/sdk`; CommonJS, browser/edge runtimes, package
subpaths, and imports from workspace TypeScript source are unsupported.

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
not registry publications. Installing only the SDK tarball is insufficient:
its internal contracts dependency still references an exact release version.

## Install into a separate consumer

Create a directory beside a checkout named `askgina-plugins`, and save this as
its `package.json` (adjust all file paths if your layout differs):

```json
{
  "name": "askgina-sdk-consumer",
  "private": true,
  "type": "module",
  "dependencies": {
    "@askgina/contracts": "file:../askgina-plugins/dist/packages/askgina-contracts-0.1.0.tgz",
    "@askgina/sdk": "file:../askgina-plugins/dist/packages/askgina-sdk-0.1.0.tgz",
    "effect": "4.0.0-rc.111"
  },
  "overrides": {
    "@askgina/contracts": "file:../askgina-plugins/dist/packages/askgina-contracts-0.1.0.tgz",
    "@askgina/sdk": "file:../askgina-plugins/dist/packages/askgina-sdk-0.1.0.tgz"
  }
}
```

This includes the complete internal package closure and a direct `effect`
dependency for the example below. The Bun file overrides keep internal package
resolution local, following the artifact verifier's installation pattern.
External dependencies still need registry access or a populated cache; this
minimal manifest is not an exact copy of the verifier's locked external
dependency graph.

Run from the consumer directory:

```sh
bun install --ignore-scripts
```

## Authenticate and run an Effect

Follow [public authentication guidance](https://docs.askgina.ai/agents/authentication)
and open [Agent Setup](https://askgina.ai/agent-setup). Explicitly select
**Read-only — view data** (`tools:read`); the form may default to full access.
Manual tokens expire after 90 days. Revoke them under **Active Tokens → Revoke**;
generate replacements and update your private environment yourself. This
manual-token lifetime is not an OAuth token lifetime. The SDK provides no
login, OAuth, or automatic refresh flow.

Have a trusted launcher or secret manager supply the real bearer as
`ASK_GINA_ACCESS_TOKEN` in your application's environment. Never paste a bearer
into chat or put it in source, shell history, or committed files. The SDK does
**not** read environment variables: your application must explicitly pass
`accessToken`.

Save this executable example as `consumer.mjs`:

```js
import { Effect } from "effect";
import { createClient } from "@askgina/sdk";

const accessToken = process.env.ASK_GINA_ACCESS_TOKEN;
if (!accessToken?.trim()) {
  throw new Error("Supply ASK_GINA_ACCESS_TOKEN securely before running.");
}

const client = createClient({ accessToken });
const tools = await Effect.runPromise(client.listTools());
console.log(JSON.stringify(tools, null, 2));
```

With the environment already supplied, run `node consumer.mjs` (Node >=24) or
`bun consumer.mjs` (Bun >=1.4). This makes a real authenticated request to the
fixed endpoint `https://askgina.ai/ai/gina/mcp`. Client methods return Effects,
not Promises; `Effect.runPromise` executes them. To call a tool instead of
listing, use `await Effect.runPromise(client.callTool("gina.listScheduledPrompts", {}))`.

The supported connected surface is the 31 read-catalog tools plus
`gina.renderReadOnlyDashboard`. Separate transaction-execution endpoints and
additional MCP App render/connect tools are unsupported. Read-scoped access is
non-trading, not side-effect-free: analytics can create/recreate temporary
DuckDB tables, persist bounded dataset metadata, and fetch provider data when
rematerializing missing tables.
