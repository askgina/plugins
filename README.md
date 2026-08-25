# askgina/plugins

Private-first Apache-2.0 workspace for the Ask Gina programmatic client, Bun CLI,
listed-plugin portable core, host adapters, and hermetic evals.

This repository is not public and does not publish packages. CI is credential-free
and build-only. Production Gina MCP remains at `https://askgina.ai/ai/gina/mcp`.
Callers supply a bearer token. The client exposes only the 29 catalog read tools.

## Packages

- `@askgina/contracts` — public catalog, protocol literals, and receipt schemas
- `@askgina/sdk` — TypeScript client
- `@askgina/cli` — Bun `ask-gina` binary
- `@askgina/plugin-core` — portable plugin source and loaders
- `@askgina/evals` — hermetic eval replay and sanitization

## Commands

```sh
bun install --frozen-lockfile
bun run fmt:check
bun run lint
bun run check
bun run test
bun run artifacts
bun run verify:artifacts
```
