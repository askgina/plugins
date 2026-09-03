# askgina/plugins

Private-first Apache-2.0 workspace for the Ask Gina programmatic client, Bun CLI,
listed-plugin portable core, host adapters, and hermetic evals.

This repository is not public and does not publish packages. Pull-request CI runs
workflow gates, but `main` has no protected required checks. Production Gina MCP
remains at `https://askgina.ai/ai/gina/mcp`. Callers supply a bearer token. The
client exposes only the 30 catalog read tools.

## Packages and runtimes

- `@askgina/contracts` — public catalog, protocol literals, and receipt schemas;
  root-only ESM for Node >=24 and Bun >=1.4
- `@askgina/sdk` — TypeScript client; root-only ESM for Node >=24 and Bun >=1.4
- `@askgina/cli` — compiled Bun `ask-gina` binary; Bun 1.4.x only
- `@askgina/plugin-core` — host-specific plugin core and loaders
- `@askgina/evals` — compiled hermetic/live eval tools, shared contracts,
  adapters, replay, grading, and sanitization; Bun 1.4.x only

The contracts and SDK packages have no CommonJS, browser, edge, or subpath entrypoints.

## Commands

```sh
bun install --frozen-lockfile
bun run audit
bun run fmt:check
bun run lint
bun run check
bun run test
bun run check:target-conformance
bun run artifacts
bun run verify:artifacts
bun run check:public-boundary
bun run smoke:install
```

`bun run artifacts` builds the five package outputs with `vp pack`; the
custom packer then creates five package tarballs, five complete host archives, one
four-skill candidate archive, and contract, package, target, and eval receipts
under ignored `dist/`. `bun run verify:artifacts` performs clean
tarball installs and runtime checks. Nothing here publishes, releases, deploys,
submits, or calls production during pull-request CI.
