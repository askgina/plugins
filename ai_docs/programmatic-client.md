# Programmatic client

The TypeScript SDK and Bun CLI talk to production Gina MCP at
`https://askgina.ai/ai/gina/mcp` with a caller-supplied bearer token. Install and
consume the packed artifacts; do not import files from the workspace `src/`
directories. This repository does not publish the packages.

## Runtime and package contract

- `@askgina/contracts` and `@askgina/sdk` are compiled ESM packages for Node.js
  `>=24` and Bun `>=1.4`. Import each package from its root only.
- `@askgina/cli` requires Bun `1.4.x`. Its installed `ask-gina` command points to
  the compiled ESM bin at `./dist/bin.js`.
- CommonJS, browser runtimes, edge runtimes, and package subpaths are not
  supported.

`vp pack` writes each package's compiled JavaScript, declarations, and maps to
its ignored `dist/` directory. The maps embed the committed TypeScript and use
relative source paths.

## SDK usage

```ts
import { createClient } from "@askgina/sdk";

const client = createClient({ accessToken: process.env.ASK_GINA_ACCESS_TOKEN ?? "" });
```

## CLI usage

```sh
export ASK_GINA_ACCESS_TOKEN=synthetic-fixture
ask-gina list
ask-gina call gina.listScheduledPrompts '{}'
```

Only the 30 catalog read-tool names are callable. Unknown names are rejected
before transport. There is no login, DCR, or write/execute catalog.
