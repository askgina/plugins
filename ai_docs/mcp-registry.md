# MCP Registry entries

`registry/` holds one `server.json` per public remote MCP server for the [official MCP Registry](https://registry.modelcontextprotocol.io). PulseMCP and Glama pick up entries from it.

| File                        | Name              | Remote                           |
| --------------------------- | ----------------- | -------------------------------- |
| `registry/server.gina.json` | `ai.askgina/gina` | `https://askgina.ai/ai/gina/mcp` |
| `registry/server.spot.json` | `ai.askgina/spot` | `https://askgina.ai/ai/spot/mcp` |

Perps and Predictions have no entry yet. They need native annotated write tools first (D11 on map #168).

Both files follow the `2025-12-11` server schema. `description` is limited to 100 characters and every publish needs a new `version`. The registry checks that we control the `ai.askgina` namespace, not the remote URL, and one remote URL can belong to only one name.

## Publish

Nothing here has been published. Publishing needs proof that we control `askgina.ai` and a signing key, so the owner of the domain runs it.

1. Generate an Ed25519 key with OpenSSL 3 and keep `key.pem` out of this repository:

   ```sh
   openssl genpkey -algorithm Ed25519 -out key.pem
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   echo "askgina.ai. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
   ```

2. Add that TXT record on the apex of `askgina.ai`, not under a selector. Remove it again if the key changes, because a stale record breaks verification.
3. Install `mcp-publisher` from the registry releases page, then log in and publish:

   ```sh
   PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
   mcp-publisher login dns --domain askgina.ai --private-key "${PRIVATE_KEY}"
   mcp-publisher publish registry/server.gina.json
   mcp-publisher publish registry/server.spot.json
   ```

4. Check the result with `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.askgina"`.

Without DNS access, an Owner of the `askgina` GitHub organization can use `mcp-publisher login github` instead. The names then change to `io.github.askgina/gina` and `io.github.askgina/spot`.

Sources: the registry's [authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx) and [remote servers](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx) guides.
