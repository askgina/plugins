# Ask Gina listed-plugin evaluation v1

This package evaluates the 29-tool, read-only Ask Gina plugin without making
the ChatGPT trial the scaling bottleneck. The YAML suite is target-independent:
the same cases can be run through OpenAI Responses, captured manually from the
installed ChatGPT plugin, or replayed from browser automation.

## What each layer proves

| Layer                     | Primary use                                                                           | Does not prove                                           |
| ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Contract replay           | Schemas, graders, reports, regression fixtures                                        | Model or production behavior                             |
| Responses API + Gina MCP  | Routing, arguments, tool errors, latency, result bytes, tokens, tool-subset ablations | Installed skill activation, OAuth UX, ChatGPT product UI |
| ChatGPT Developer mode    | Actual ChatGPT model routing, OAuth, tool cards, follow-ups                           | Large-sample timing, cost, reproducibility               |
| Complete installed plugin | Manifest + skills + MCP behavior together                                             | Statistical reliability without repeated runs            |
| Browser replay            | Repeatable visible-product regression capture                                         | Clean separation between automation and product failures |

This layering follows the official OpenAI testing guidance: evaluate the MCP
server first, then tool selection in ChatGPT Developer mode, then the complete
packaged plugin. Keep the same prompts and results across versions.

## Credential-free proof

Run the checked-in synthetic observations through the deterministic grader:

```bash
bun run evals:plugin -- \
  --suite plugins/ask-gina/evals/model/v1/smoke.yaml \
  --observations plugins/ask-gina/evals/model/v1/fixtures/synthetic-observations.yaml
```

The synthetic report deliberately includes two routing failures: current-price
versus chart selection and HIP-3 search versus list selection. Latency and
result size remain reported diagnostics, not scored dimensions. This is not a
Gina or model benchmark.

## Full family corpus

The `families/` directory contains 32 cases that collectively expect every
tool in the checked-in read catalog:

| Suite              | Cases | Catalog tools covered |
| ------------------ | ----: | --------------------: |
| `portfolio.yaml`   |     3 |                     3 |
| `spot.yaml`        |     4 |                     4 |
| `perps.yaml`       |    17 |                    14 |
| `predictions.yaml` |     8 |                     8 |

Each family case runs against the checked-in 29-tool MCP catalog by default.
The runner sends that catalog through `allowed_tools`, verifies the imported
`mcp_list_tools` result, and records both lists in the report. This means a
family run measures selection and cross-family confusion under the production
catalog rather than making routing artificially easy.

Run the authenticated full corpus as four traceable runs:

```bash
bun run evals:plugin:responses -- --models gpt-5.6-terra --suite plugins/ask-gina/evals/model/v1/families/portfolio.yaml --candidate full-catalog-portfolio
bun run evals:plugin:responses -- --models gpt-5.6-terra --suite plugins/ask-gina/evals/model/v1/families/spot.yaml --candidate full-catalog-spot
bun run evals:plugin:responses -- --models gpt-5.6-terra --suite plugins/ask-gina/evals/model/v1/families/perps.yaml --candidate full-catalog-perps
bun run evals:plugin:responses -- --models gpt-5.6-terra --suite plugins/ask-gina/evals/model/v1/families/predictions.yaml --candidate full-catalog-predictions
```

Keep the four reports separate so failures are attributable to a family and
candidate. Aggregate them only for catalog-level presentation; do not merge raw
observations, because those remain local-sensitive.

The sanitized 2026-08-19 production baseline is checked in at
`results/2026-08-19-gpt-5.6-terra-production-baseline.json`. It contains only
scores, distributions, tool names, and run metadata. It explicitly records the
mid-run transition from the production forty-tool baseline to a thirty-eight-
tool candidate and the subsequent narrowing to thirty-three tools at that time.
The current candidate contains 29 tools. The historical baseline is not a clean
`allowed_tools` ablation of the current candidate.

## Installed-skill activation corpus

`activation.yaml` contains 25 fresh-chat product cases for the four goal-led
skills. Each case records the expected skill separately from MCP routing via
`expected.skill`, so an installed skill miss is not hidden by a correct raw MCP
tool choice. Product observations can record the visible activation in
`activated_skills`.

The corpus covers direct and indirect current-data prompts, plausible
model-memory or web competition, signed-out authentication, cross-skill
boundaries, missing identifiers, general-knowledge negatives, unsupported
venues, and one secure write handoff for each skill. Run these cases against the
complete installed plugin in a fresh ChatGPT conversation per case. The
Responses runner may reuse the same prompts for tool-routing evidence, but it
cannot score installed-skill activation.

## Codex CLI installed-plugin harness

The Codex CLI runner uses the already-installed `ask-gina@personal` profile. Do
not create a new profile or reinstall the plugin. Codex starts with each skill's
name, description, and path, then loads the full `SKILL.md` only when it selects
that skill. On `codex exec --json` that load is a `command_execution` read of the
plugin skill file; the harness maps those reads to `observation.activated_skills`.

Ask Gina `agents/openai.yaml` files do not set
`policy.allow_implicit_invocation: false`, so implicit triggers stay allowed.

One live case:

```bash
bun run evals:plugin:codex -- --cases spot-direct-price
```

The runner passes `-s read-only` to Codex by default. If the host cannot
initialize Codex's sandbox, opt in to the host workaround for that run:

```bash
bun run evals:plugin:codex -- --cases spot-direct-price \
  --sandbox-mode danger-full-access
```

**Warning:** `danger-full-access` disables Codex's sandbox for the child
process. Use it only on an isolated eval host and working directory that you
trust; never make it the default. It does not change Ask Gina's read-only tool
contract.

This harness records activation evidence. A 25/25 product pass is out of scope.

## Authenticated Responses run

Provide secrets only in the local process environment:

- `OPENAI_API_KEY`: OpenAI API key for the Responses API.
- `ASK_GINA_MCP_READ_TOKEN`: the read-only access token from Gina Agent Setup.

Do not paste a ChatGPT password, API key, or Gina token into a prompt, YAML,
issue, commit, or report. The Responses API requires the MCP access token in
the `authorization` field on every request and does not return or store it in
the Response object.

One model, one repetition:

```bash
bun run evals:plugin:responses -- --models chat-latest
```

Recommended comparison after the one-model smoke succeeds:

```bash
bun run evals:plugin:responses -- \
  --models chat-latest,gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna \
  --repetitions 3
```

Raw observations and reports are written with mode `0600` under the ignored
`.plugin-eval-runs/` directory. Raw observations are `local_sensitive` because
tool arguments and final answers can contain test-account identifiers. Reports
contain only scores, aggregate measurements, and tool catalog names and are the
artifact to review or intentionally share.

Useful ablation flags:

- `--cases id[,id]` runs only selected cases and reports partial coverage.
- `--allowed-tools tool[,tool]` overrides the default complete read catalog with
  a catalog-valid subset using the official Responses API `allowed_tools` control.
- `--candidate name` labels the candidate in the report.
- `--output-dir path` changes the private artifact directory.

Run one metadata or schema candidate at a time. Do not mix multiple changes in
one candidate or the result will not identify which change caused the delta.
Responses observations do not claim OAuth-scope safety when the target provides
no explicit scope evidence; those checks remain `not_scored` rather than passing
by absence. Use the authenticated MCP preflight and installed-plugin gate to
prove the granted `tools:read` scope.

## Recommended ChatGPT gate

Use a fresh conversation for each case unless the case is explicitly tagged
`follow_up`. Run all required cases in `activation.yaml` before release; use
`smoke.yaml` for the smaller MCP-routing and follow-up gate.

For every displayed ChatGPT model being compared:

1. Open ChatGPT Settings → Security and login and enable Developer mode.
2. Open the ChatGPT Plugins page, add `https://askgina.ai/ai/gina/mcp`, and
   complete Gina OAuth with a dedicated test account.
3. Confirm the discovered connection exposes only the expected read tools.
4. Start a clean conversation, enable the connection, and submit the exact
   prompt from `activation.yaml` or `smoke.yaml`.
5. Record model label, case id, activated skill, selected tool(s), arguments,
   visible error, whether auth was requested again, any web/model fallback, and
   whether the final answer was useful.
6. For `follow-up-address-to-perps`, submit both turns in one conversation and
   verify that the second call reuses the address returned by the first.
7. For `safety-execution-handoff`, verify that no write or calldata tool runs.

The 25-case activation corpus is the product-level release gate. The family
corpus remains automated; the human gate concentrates on activation and product
surfaces that the API proxy cannot prove.

## Provisional gates

Use these as initial release gates and recalibrate after the first real
baseline:

- direct routing recall at least 98%;
- indirect routing recall at least 92%;
- negative-prompt precision at least 99%;
- deterministic argument correctness at least 97%;
- forbidden tool/scope safety 100%;
- p95 trial latency below 8 seconds for cases with a latency ceiling;
- p95 model-facing tool result below 50 KB and no result above 100 KB.

Do not cut a tool solely because a smaller model misses it. First confirm that
it overlaps another tool, stays weak after one-field-at-a-time metadata tuning,
creates false activations, and has low user value. Compare the complete catalog,
family-level subsets, and the proposed cut set through Responses; then validate
the candidate with the installed ChatGPT gate.

## Sources

- [OpenAI: connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI: MCP and Connectors in the Responses API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI: optimize plugin metadata](https://developers.openai.com/plugins/guides/optimize-metadata)
