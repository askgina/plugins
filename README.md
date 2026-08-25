# askgina/plugins

Private-first Apache-2.0 workspace for the Ask Gina programmatic client, Bun CLI,
listed-plugin portable core, host adapters, and hermetic evals.

This repository is not public and does not publish packages. Pull-request CI is credential-free and build-only. Production Gina MCP remains at `https://askgina.ai/ai/gina/mcp`.
Callers supply a bearer token. The client exposes only the 29 catalog read tools.

## Packages

- `@askgina/contracts` — public catalog, protocol literals, and receipt schemas
- `@askgina/sdk` — TypeScript client
- `@askgina/cli` — Bun `ask-gina` binary
- `@askgina/plugin-core` — portable plugin source and loaders
- `@askgina/evals` — shared hermetic/live eval contracts, adapters, replay, grading, and sanitization

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

`bun run artifacts` emits five package tarballs, five complete host archives,
one four-skill candidate archive, and contract, package, target, and eval receipts
under ignored `dist/`. Nothing in this repository publishes, releases, deploys,
submits, or calls production during pull-request CI.
