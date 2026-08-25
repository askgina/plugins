# Security

Report vulnerabilities privately to Ask Gina maintainers. Do not file public
issues that include tokens, account data, or raw eval observations.

This repository must remain private until a separate public-visibility
authority is granted. Pull-request CI has `contents: read` at most and does
not receive secrets. The separately dispatched live-smoke workflow uses only a
`live-evals` environment whose custom deployment-branch policy admits only
`main`. The workflow's default-branch guard and checkout are defense in depth;
contributor refs cannot enter the secret-bearing environment.

Forbidden in source, packages, archives, and receipts:

- credentials, tokens, token IDs
- private application hosts and imports
- authenticated raw eval observations
- proprietary prompts beyond allowlisted fixtures

`bun run check:public-boundary` scans repository source, receipts, and extracted
archives. It fails on private imports or hosts, credential-like values, unsafe or
unexpected archive content, private runtime dependencies, and raw eval fields.
The check has no credentialed mode and no release override.
Live eval credentials are read from environment-backed Effect `Config` values,
never command-line arguments. The Responses runner sends the provider key only
to the Responses API and the Gina bearer only in the remote MCP authorization
transport field. The Codex runner accepts only an absolute executable whose SHA-256 digest is
pinned before startup. It installs and validates the plugin in a fresh temporary
`CODEX_HOME`, writes the Gina MCP credential only to that temporary credential
store, and never forwards the Gina bearer in the child environment. Before the model request,
the runner verifies the exact production catalog and starts Codex with a named,
enforced permission profile. That profile denies reads from `CODEX_HOME`, allows
reads only from Codex's minimal runtime, the empty trial working tree, and the
validated plugin skills, disables shell network and web search, and enables only
the observed canonical Gina MCP tools. The runner also uses no approvals,
bounded output, and a minimal inherited environment.

Raw observations and model/tool payloads exist only in memory. The only durable
live-eval output is a schema-validated aggregate below the ignored
`.plugin-eval-runs/` directory. Errors retain fixed classifications, not child
stderr, HTTP bodies, prompts, tokens, or tool results.
