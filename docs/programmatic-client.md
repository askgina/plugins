# Programmatic client

The TypeScript SDK and Bun CLI talk to production Gina MCP at
`https://askgina.ai/ai/gina/mcp` with a caller-supplied bearer.

```ts
import { createClient } from "@askgina/sdk";

const client = createClient({ accessToken: process.env.ASK_GINA_ACCESS_TOKEN ?? "" });
```

```sh
ask-gina --token "$ASK_GINA_ACCESS_TOKEN" list
ask-gina --token "$ASK_GINA_ACCESS_TOKEN" call gina.listScheduledPrompts '{}'
```

Only the 29 catalog read-tool names are callable. Unknown names are rejected
before transport. There is no login, DCR, or write/execute catalog.
