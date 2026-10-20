# MCP registry listings for Ask Gina

Research for Wayfinder ticket #175, map #168. Checked on 2026-10-20. Nothing was submitted to any registry.

## Verdict

Ask Gina is not listed on any of the four registries. The official MCP Registry is the right first step, because PulseMCP and Glama both say they pick up its entries.

| Registry              | Ask Gina listed | Remote servers                  | Needs from us                                                                                | Who acts                                                                                |
| --------------------- | --------------- | ------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Official MCP Registry | No              | Yes, `remotes` in `server.json` | Prove control of `askgina.ai` (DNS TXT or a well-known file) and run `mcp-publisher publish` | Whoever controls `askgina.ai` DNS or the app deploy, plus whoever holds the signing key |
| Smithery              | No              | Yes, by URL                     | Publish at smithery.ai/new, finish an authenticated scan                                     | A Smithery account holder, plus a test Ask Gina account                                 |
| PulseMCP              | No              | Yes                             | Nothing. Submissions and listing edits are paused since 2026-09-03                           | Nobody until PulseMCP reopens                                                           |
| Glama                 | No              | Yes, as a connector             | Submit the URL, then claim by DNS TXT or a well-known file                                   | A Glama account holder with DNS or deploy access                                        |

Two `server.json` drafts are in `ai_docs/research/registry/`. Both validate against the current official schema.

## What we checked

### Official MCP Registry

Queries against `https://registry.modelcontextprotocol.io/v0.1/servers?search=<term>&limit=100`.

| Search term         | Matches       |
| ------------------- | ------------- |
| `askgina`           | 0             |
| `ask-gina`          | 0             |
| `askgina.ai`        | 0             |
| `io.github.askgina` | 0             |
| `ai.askgina`        | 0             |
| `com.askgina`       | 0             |
| `gina`              | 15, none ours |

The `gina` hits include `ai.talktogina/gina`, a different product at `https://app.talktogina.ai/api/mcp`, published 2026-10-16. It is the closest name collision. Our `title` and `websiteUrl` must keep the two apart. It also shows that an `ai.` domain namespace is in use by a comparable product.

### Smithery

The public API at `https://registry.smithery.ai/servers` returned no Ask Gina server for the queries `askgina.ai`, `askgina` and `ask gina`, three pages each. Direct lookups of `askgina`, `askgina/gina` and `askgina/ask-gina` returned 404. The search is fuzzy and returns unrelated servers, so I filtered by `qualifiedName` and `homepage`. The only partial hit was `maginaryai/maginary-mcp`, which is unrelated.

### PulseMCP

`https://www.pulsemcp.com/servers?q=askgina` shows "No servers found." The submit page says submissions and changes to existing listings are paused, last updated 2026-09-03.

### Glama

Glama's own API needs a key, so I could not query it. The connector pages `glama.ai/mcp/connectors/ai.askgina/gina` and `.../ai.askgina/spot` return 404, while the registry-derived page for `ai.talktogina/gina` returns 200. Glama's search pages render client side and I could not read results from them. Treat Glama as probably absent, not proven absent.

## Readiness of our endpoints

Probed live with unauthenticated requests. The probes were read only. Perps and predictions have only their metadata documents checked.

| Endpoint                                | Unauthenticated POST                                                         | Protected resource metadata scope |
| --------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| `https://askgina.ai/ai/gina/mcp`        | 401 with `WWW-Authenticate` and `resource_metadata`                          | `tools:read`                      |
| `https://askgina.ai/ai/spot/mcp`        | 401 with `WWW-Authenticate`, `scope="tools:execute"` and `resource_metadata` | `tools:execute`                   |
| `https://askgina.ai/ai/perps/mcp`       | not probed                                                                   | `tools:execute`                   |
| `https://askgina.ai/ai/predictions/mcp` | not probed                                                                   | `tools:execute`                   |

Authorization server metadata at `https://askgina.ai/.well-known/oauth-authorization-server` advertises `registration_endpoint` (dynamic client registration), `client_id_metadata_document_supported: true`, and `S256` PKCE. That covers the OAuth requirements of Smithery and Glama.

Not present today, all 404 or absent:

- `https://askgina.ai/.well-known/mcp-registry-auth`, needed for HTTP ownership proof on the official registry.
- `https://askgina.ai/.well-known/mcp/server-card.json`, Smithery's fallback when its scan cannot authenticate.
- A DNS TXT proof. The only TXT record on `askgina.ai` is a Google site verification.

## Official MCP Registry

Sources: [Publishing remote servers](https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/modelcontextprotocol-io/remote-servers.mdx), [Authentication](https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/modelcontextprotocol-io/authentication.mdx), [Quickstart](https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/modelcontextprotocol-io/quickstart.mdx).

### Rules that apply to us

- The registry is in preview. Breaking changes or data resets can happen.
- A remote-only server needs a `remotes` array and no `packages`. The remote must be publicly reachable.
- The `name` must match `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, 3 to 200 characters. `description` is limited to 100 characters, `title` to 100, `version` to 255. Required fields are `name`, `description` and `version`. These limits come from the schema file at `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.
- The registry checks that you control the namespace in `name`. It does not check that you control the remote URL.
- One remote URL can belong to only one server name. Publishing fails if another name already uses it.
- Use `streamable-http`. The `sse` transport is deprecated.
- A new publish needs a new `version` string.

### Namespace choice

| Auth method | Name format                | What proves control                                                          | Fit for us                                                                                                          |
| ----------- | -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| DNS         | `ai.askgina/<name>`        | TXT record on the apex of `askgina.ai`, format `v=MCPv1; k=ed25519; p=<key>` | Best. The name matches the brand and the remote host.                                                               |
| HTTP        | `ai.askgina/<name>`        | File at `https://askgina.ai/.well-known/mcp-registry-auth`                   | Same name, but needs a route on the app that serves `askgina.ai`.                                                   |
| GitHub      | `io.github.askgina/<name>` | GitHub OAuth device flow as an Owner of the `askgina` org                    | Works without DNS access. The name ties to the repo, not the product domain. Ordinary org membership is not enough. |

The authentication page warns that the TXT record must sit on the apex, not under a selector. A stale record from an old key breaks verification.

I recommend DNS with `ai.askgina/gina` and `ai.askgina/spot`. Both drafts use these names. If DNS access is slow to get, `io.github.askgina/gina` is the fallback, and the drafts only need a name change.

### Drafts

- `registry/server.gina.json`, name `ai.askgina/gina`, remote `https://askgina.ai/ai/gina/mcp`.
- `registry/server.spot.json`, name `ai.askgina/spot`, remote `https://askgina.ai/ai/spot/mcp`.

Both use the 2025-12-11 schema, `repository` pointing at `https://github.com/askgina/plugins`, and the docs favicon as the icon. The `ask-gina-spot` description says it moves real funds, so a reader of the registry listing is not surprised.

Validation: I fetched the schema and ran both files through Ajv 8 with `ajv-formats`. Both pass. A control file with an invalid name fails. `mcp-publisher` 1.8.1 lists a `validate` command in its help but answers `Unknown command: validate` when invoked, so Ajv was the only validator I could run.

Perps and predictions are not drafted. Per D11 they wait for native write tools.

### Steps to publish, not run

1. Pick DNS or HTTP proof. Generate an Ed25519 key with OpenSSL 3. Keep the private key out of the repo.
2. Add the TXT record on `askgina.ai`, or serve `mcp-registry-auth` from the app.
3. Install `mcp-publisher` from the registry releases page.
4. `mcp-publisher login dns --domain askgina.ai --private-key <hex>`.
5. Run `mcp-publisher publish ai_docs/research/registry/server.gina.json`, then the same for `server.spot.json`. The command takes a path and defaults to `./server.json`.
6. Check with `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.askgina"`.

### Who must act

- Someone with DNS control of `askgina.ai`, or someone who can ship the well-known route in the app repo.
- Someone who holds the signing key. Treat it like a release credential.
- Or an Owner of the `askgina` GitHub org, for the GitHub route.

## Smithery

Source: [Smithery publish docs](https://smithery.ai/docs/build/publish).

- Publish by URL at `https://smithery.ai/new`, or `smithery mcp publish "<url>" -n @org/name`. Smithery proxies to our endpoint. We keep hosting it.
- Requires streamable HTTP and OAuth where auth is needed. Smithery registers itself as a client through Client ID Metadata Documents, which our authorization server supports.
- Unauthenticated requests must return 401, not 403, so Smithery can detect OAuth through RFC 9728. Our endpoints already do that.
- Smithery scans tools and prompts. For an auth-required server it asks the publisher to sign in so the scan can finish. That means a working Ask Gina test account. The alternative is a static card at `/.well-known/mcp/server-card.json`, which we do not serve.
- WAF note. Smithery sends `SmitheryBot/1.0 (+https://smithery.ai)` from Cloudflare Workers. If a Vercel Firewall rule blocks that agent on `/ai/*/mcp`, the scan fails with a 403. I did not test this. The repo skill `askgina-waf-v13-mcp-oauth-bypass-state` is the place to check before publishing.
- Verification as an official vendor is a separate checklist under Settings, Verification, after publishing.
- The docs I read state no listing fee. I did not find a pricing page for publishers.

The spot endpoint needs the same scan sign in. Its protected resource metadata asks for `tools:execute`, so the test account has to be allowed that scope. The docs say the scan extracts metadata. They do not say whether it calls tools, so use an account with no funds.

## PulseMCP

Source: [PulseMCP submit page](https://www.pulsemcp.com/submit).

New submissions and listing changes are paused. The page says to publish to the official registry and that PulseMCP will pick the entry up automatically once it reopens. Nothing to do now beyond the official registry entry.

## Glama

Sources: [Glama MCP FAQ](https://glama.ai/mcp/faq), [connectors](https://glama.ai/mcp/connectors).

- Two paths. The servers path takes an open source GitHub repo. The connectors path takes an already deployed remote endpoint. We want connectors, because `askgina/plugins` is not an MCP server.
- Submit at the connectors page, Add MCP Server, Connector. Needs a name, a short description and an HTTPS streamable HTTP URL.
- OAuth 2.1 with dynamic client registration lets us skip test credentials. Our authorization server has a registration endpoint.
- Only healthy connectors are indexed. Submissions are public by default.
- Claiming proves ownership. Add a TXT record at `_glama-claim.askgina.ai`, or serve `https://askgina.ai/.well-known/glama.json`, or use GitHub. The file must be public, HTTPS, and not redirect to another domain. Glama re-checks daily and gives seven days of grace after a failure.
- For a connector linked to the official registry under a domain namespace, the domain named by the namespace is the one to verify. So `ai.askgina/gina` verifies through `askgina.ai`. Registry updates then replace name, description and URL unless we switch on Glama's own listing details as the source of truth.
- The auth badge comes from a test profile set after claiming. Without it Glama infers `auth:oauth2` when the server advertises OAuth metadata and rejects anonymous calls, which ours does.
- Glama's FAQ describes registry-linked connectors, and `ai.talktogina/gina` has a connector page. That is evidence, not documentation, that registry entries flow into Glama.

## Recommended order

1. Publish both drafts to the official registry under `ai.askgina`. This is one decision, DNS or HTTP or GitHub, and one key.
2. Wait for PulseMCP and Glama to pick the entries up. Claim the Glama connectors using the same domain.
3. Publish to Smithery after confirming the firewall does not block its scanner and a test account exists.

## Open items

- Choose the proof method and the person who holds the key. That blocks step 1.
- Whether `ai.askgina/spot` should be published before D11 settles which Spot tools are safe to advertise. The registry entry only lists the URL, so it adds no tools.
- Glama and Smithery pricing, and Glama's search results, were not verifiable from public pages.
- The official registry is in preview. Re-check the schema URL before publishing, because the date in the path changes between releases.
