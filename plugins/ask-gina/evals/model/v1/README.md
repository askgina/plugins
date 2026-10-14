# Ask Gina listed-plugin evaluation v1

**What this is:** the v1 model-eval suites for the 31-tool, read-only Ask Gina
plugin. They ask whether a model picks the right Gina skill and tool, with the
right arguments, for realistic prompts, and refuses what it must refuse. They do
not grade answer prose, and they are not a Gina or model benchmark.

This directory holds YAML cases, synthetic observations, and one sanitized
historical result. It runs nothing by itself:
[`@askgina/evals`](../../../../../packages/evals/README.md) replays and grades
these suites. The suites are target-independent, so the same cases run through
replay, a live API runner, a CLI host, or a hand-run ChatGPT trial.

New here? Read [Start here](#start-here). For runner mechanics (credentials,
flags, output files, grading rules), use the
[`@askgina/evals` Start here](../../../../../packages/evals/README.md#start-here).
This file covers only what is specific to these suites.

## Start here

### Which suite answers which question

| Suite             |                Cases | Expected tools | Question it answers                                                                                                |
| ----------------- | -------------------: | -------------: | ------------------------------------------------------------------------------------------------------------------ |
| `smoke.yaml`      |                   12 |             10 | Small routing seed: overlap pairs, one negative, one write refusal, and one two-turn follow-up.                    |
| `families/*.yaml` | 38 (3 + 4 + 18 + 13) |       28 of 31 | Does the model pick the right tool in each family when it sees the full catalog?                                   |
| `activation.yaml` |                   25 |             10 | Does the right installed skill activate (or none at all) in a fresh chat? Scored separately from the tool it uses. |

"Expected tools" counts the distinct catalog tools a case can be graded as
calling: the `routing` tools, `arguments.tool`, and, for `perps_price` cases,
the tools that grader accepts. All six files pin `catalog_version:
31-read-tools@2026-09-10`.

### Step 1: replay the synthetic observations (no credentials)

From the repository root:

```sh
bun run eval:replay -- \
  --suite plugins/ask-gina/evals/model/v1/smoke.yaml \
  --observations plugins/ask-gina/evals/model/v1/fixtures/synthetic-observations.yaml \
  --output /tmp/v1-smoke-replay/report.json
```

The script builds the workspace packages first, so the first run is slower. Expect
`sanitized eval report written` and exit `0`. The report shows
`overall: { passed: 10, total: 12 }`. **Two failures are deliberate:**

- `confusion-token-chart` (current price versus chart): the observation calls
  `spot.getSimplePrice`, which is forbidden for that prompt. Routing and safety
  fail.
- `indirect-hip3-search` (HIP-3 search versus list): the observation calls
  `perps.getHyperliquidPerpDexes` instead of `perps.getHyperliquidMarkets`.
  Routing and arguments fail.

Exit `0` means "graded and saved", not "everything passed". Read the counts.
Latency (p95 `8200` ms) and result size (max `120000` bytes) are reported
diagnostics, not scored dimensions. The fixture is one deterministic repetition
with no skill activation, so it says nothing about a real model.

Replay refuses to overwrite a report. Running the same command twice to one
`--output` path fails with `eval replay failed (ReplayCliWriteError)` and exit
`1`, so use a new path each time.

Replay accepts a suite only together with observations whose manifest names
that suite. The checked-in observations cover `smoke.yaml` only. Pointing
`--suite` at `families/spot.yaml` with them fails with
`eval replay failed (PluginEvalReplayContractError)`.

### Step 2: run one family live (example, not executed)

Live runs follow the
[`@askgina/evals` live rules](../../../../../packages/evals/README.md#live-trials):
`ASK_GINA_ACCESS_TOKEN` plus the runner's own credentials, a clean git
worktree, and `--repetitions` from 3 to 5. Every flag except `--case` may appear
once. This is the Responses runner on one family, with placeholders. This README
did not run it.

```sh
export ASK_GINA_ACCESS_TOKEN=...   # Gina MCP bearer with tools:read
export OPENAI_API_KEY=...

bun run eval:responses -- \
  --suite plugins/ask-gina/evals/model/v1/families/portfolio.yaml \
  --run-id <unique-run-id> \
  --candidate <candidate-label> \
  --model <model-id> \
  --reasoning <effort> \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000
```

Expect `sanitized eval report written (<passed>/<total> passed)` and a report at
`.plugin-eval-runs/responses_api-<candidate-label>-<unique-run-id>.json`. Exit
`0` means every case passed. Exit `2` means the run finished with at least one
failed case. Exit `1` means the run itself failed. Open the report before
deciding which. Runners refuse to overwrite an existing report, so choose a new
run ID each time.

To use another runner, swap `eval:responses` for `eval:openrouter`,
`eval:codex`, or `eval:omp`, and add that runner's flags and credentials. For a
Codex activation example, see [Codex CLI activation evidence](#codex-cli-activation-evidence).

How the live runners treat these suites:

- **Catalog check.** Live runners do not compare `catalog_version` with the
  code. They copy it into the run manifest. Before credentials load, they reject
  any case that names a tool outside the 31-tool catalog, printing
  `live eval failed (LiveEvalCliError)`. All six files pass this check today.
- **`families/*.yaml` and `activation.yaml` run in full.** Every case has one
  user turn.
- **`smoke.yaml` does not run in full.** `follow-up-address-to-perps` has two
  turns, and live runners accept only single-turn cases. Running the whole file
  fails with `live eval failed (LiveEvalSelectionError)`. The CLI writes the
  journal header first, so use a new `--run-id` afterward. Run the single-turn
  cases with repeated `--case <id>`, and check the follow-up through the
  [ChatGPT gate](#recommended-chatgpt-gate).

### What each layer proves

| Layer                     | How it runs here                                         | Primary use                                                            | Does not prove                                           |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Contract replay           | `eval:replay` over recorded observations                 | Schemas, graders, reports, regression fixtures                         | Model or production behavior                             |
| API + Gina MCP            | `eval:responses`, `eval:openrouter`                      | Routing, arguments, tool errors, latency, result bytes, tokens         | Installed skill activation, OAuth UX, ChatGPT product UI |
| Plugin in a CLI host      | `eval:codex`, `eval:omp` (`eval:claude` is unverified)   | Skills and MCP loaded by a real host; activation from `SKILL.md` reads | ChatGPT product UI, OAuth UX                             |
| ChatGPT Developer mode    | Manual, by the [ChatGPT gate](#recommended-chatgpt-gate) | Actual ChatGPT model routing, OAuth, tool cards, follow-ups            | Large-sample timing, cost, reproducibility               |
| Complete installed plugin | Manual, by the [ChatGPT gate](#recommended-chatgpt-gate) | Manifest, skills, and MCP behavior together                            | Statistical reliability without repeated runs            |
| Browser replay            | No runner in this repo                                   | Repeatable visible-product regression capture                          | Clean separation between automation and product failures |

The observation target enum also lists `chatgpt_developer`, `chatgpt_plugin`,
and `browser_replay`, but no runner here writes them. Replay accepts a
hand-recorded capture under one of those targets only when the manifest and
every observation name that same target.

This layering follows the official OpenAI testing guidance: evaluate the MCP
server first, then tool selection in ChatGPT Developer mode, then the complete
packaged plugin. Keep the same prompts and results across versions.

### Step 3: read results correctly

- **Keep family reports separate.** Run the four family files as four runs, so
  a failure is attributable to one family and candidate. Aggregate them only for
  catalog-level presentation.
- **Every live run sees the complete catalog.** A family run measures selection
  and cross-family confusion under the production catalog, not an artificially
  easy subset.
- **API runners cannot score activation.** `eval:responses` and
  `eval:openrouter` record no activated skills, so `activation.yaml` cases get no
  skill-activation score there. Use `eval:codex` or `eval:omp` for activation
  evidence, and the ChatGPT gate for the product verdict.
- **One change per candidate.** Run one metadata or schema candidate at a time.
  If you mix changes, the result will not identify which one caused the delta.

### Map of this directory

| Path                                                        | What it is                                | Also used by                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.yaml`, `fixtures/synthetic-observations.yaml`        | 12-case routing seed and its observations | `tools/pack-artifacts.ts` writes the replay aggregate into the release `evals.json` receipt, and `tools/verify-artifacts.ts` replays it again and fails on a mismatch. Changing scores here means repacking the release artifacts. |
| `activation.yaml`                                           | 25-case skill-activation corpus           | Packaged in `@askgina/plugin-core` with `smoke.yaml`, `families/`, and `fixtures/`.                                                                                                                                                |
| `families/`                                                 | 38 full-catalog routing cases, four files | `perps.yaml` and `predictions.yaml` are hashed into the regrade receipts that `bun run evals:check-grading` verifies. `spot.yaml` is the suite used by `packages/evals/__tests__/omp-harness.test.ts`.                             |
| `results/2026-08-19-gpt-5.6-terra-production-baseline.json` | Sanitized historical baseline             | Reference only; see [Production baseline](#production-baseline-2026-08-19).                                                                                                                                                        |

Editing `families/perps.yaml` or `families/predictions.yaml` makes
`bun run evals:check-grading` report a stale receipt. Rerun the matching script,
`tools/regrade-eval-perps.ts` or `tools/regrade-eval-search.ts`, to regenerate it.

---

# Reference

## Full family corpus

The four family files expect the public account, spot, Hyperliquid, and
prediction reads in the checked-in catalog.

| Suite              | Cases | Expected catalog tools |
| ------------------ | ----: | ---------------------: |
| `portfolio.yaml`   |     3 |                      3 |
| `spot.yaml`        |     4 |                      4 |
| `perps.yaml`       |    18 |                     15 |
| `predictions.yaml` |    13 |                      6 |

Together they expect 28 of the 31 catalog tools. Prediction search owns expiry
and series discovery: the expiry and series cases expect
`predictions.searchPredictionMarkets`, so no family case expects
`predictions.getExpiringMarkets` or `predictions.getSeriesMarket`.
`predictions.getPredictionMarketDetails` appears only as a forbidden tool.

Live runners expose the complete read catalog, `listCatalogToolNames()` in
`@askgina/contracts` (31 names). `GINA_CONNECTED_TOOL_NAMES` has 32 names
because it adds `gina.renderReadOnlyDashboard`, which the evals catalog does not
include. The Responses runner sends the catalog as `allowed_tools` and rejects a
trial whose imported `mcp_list_tools` result differs. The sanitized report pins
the catalog by `catalogSha`.

Run the authenticated full corpus as four traceable runs, one per family file.
Use the Step 2 command for each, changing `--suite`, `--candidate
full-catalog-<family>`, and `--run-id`. Keep the four reports separate. Do not
merge or share the private siblings that live runs write next to each report
(journals and, for OMP, transcripts); see
[output files](../../../../../packages/evals/README.md#output-files).

## Production baseline (2026-08-19)

The sanitized 2026-08-19 production baseline is checked in at
`results/2026-08-19-gpt-5.6-terra-production-baseline.json`. It contains only
scores, distributions, tool names, and run metadata. It is a Responses API run
(`responses_api`, `gpt-5.6-terra`, one repetition) over 40 cases: 6 portfolio, 9
spot, 17 perps, and 8 predictions. Those counts differ from today's family files
(3, 4, 18, and 13). The run passed 30 of 40 overall.

It records the mid-run transition from the production forty-tool baseline to a
thirty-eight-tool candidate, and the later narrowing to thirty-three tools. The
current catalog contains 31 tools. The historical baseline is not a clean
ablation of the current candidate.

## Installed-skill activation corpus

`activation.yaml` contains 25 fresh-chat product cases for the four goal-led
skills: 5 each for `review-gina-account`, `research-hyperliquid`, and
`research-prediction-markets`, 4 for `research-spot-tokens`, and 6 that expect no
skill. Each case records the expected skill separately from MCP routing via
`expected.skill`, so an installed skill miss is not hidden by a correct raw MCP
tool choice. Observations record the visible activation in `activated_skills`.

The corpus covers direct and indirect current-data prompts, plausible
model-memory or web competition, signed-out authentication, cross-skill
boundaries, missing identifiers, general-knowledge negatives, unsupported
venues, and one read-only write refusal for each skill. Run these cases against
the complete installed plugin in a fresh ChatGPT conversation per case. The API
runners may reuse the same prompts for tool-routing evidence, but they cannot
score installed-skill activation.

## Codex CLI activation evidence

`eval:codex` does not use your personal Codex profile. Each run installs this
repository's plugin (`ask-gina@ask-gina-plugins`) into a fresh temporary
`CODEX_HOME`, checks that the installed skills match the source, and runs
`codex exec` under the runner's `ask-gina-eval` permissions profile. It is Linux
only. It needs `ASK_GINA_ACCESS_TOKEN`, `OPENAI_API_KEY`,
`CODEX_EVAL_EXECUTABLE`, and `CODEX_EVAL_EXECUTABLE_SHA256`; see
[Codex](../../../../../packages/evals/README.md#codex).

Codex starts with each skill's name, description, and path, then loads the full
`SKILL.md` only when it selects that skill. On `codex exec --json` that load is
a `command_execution` (or `file_read`) item that reads the plugin skill file.
The runner maps those reads to `observation.activated_skills`.

Ask Gina `agents/openai.yaml` files do not set
`policy.allow_implicit_invocation: false`, so the files do not turn implicit
invocation off.

One activation case:

```sh
bun run eval:codex -- \
  --suite plugins/ask-gina/evals/model/v1/activation.yaml \
  --case spot-direct-price \
  --run-id <unique-run-id> \
  --candidate <candidate-label> \
  --model <model-id> \
  --reasoning <effort> \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000
```

The Codex runner has no sandbox flag. Each trial runs with the `ask-gina-eval`
profile: read access only to the minimal runtime and the validated plugin skill
roots, the temporary `CODEX_HOME` denied, and network disabled. The earlier
`--sandbox-mode danger-full-access` host workaround is not supported. The runner
rejects unknown flags.

This harness records activation evidence. A 25/25 product pass is out of scope;
that is the [ChatGPT gate](#recommended-chatgpt-gate).

## Credentials and outputs

Provide secrets only in the local process environment. Every live runner needs
`ASK_GINA_ACCESS_TOKEN`, the read-only (`tools:read`) access token from Gina
Agent Setup. The Responses runner also needs `OPENAI_API_KEY`. Other runners'
credentials are listed under
[Live trials](../../../../../packages/evals/README.md#live-trials).

Do not paste a ChatGPT password, API key, or Gina token into a prompt, YAML,
issue, commit, or report. The Responses trial sends the MCP token only in the
`authorization` field of the MCP tool entry, and it sets `store: false`.

Reports and their siblings are written with mode `0600` under the gitignored
`.plugin-eval-runs/` directory. The report holds scores, distributions, and run
metadata. It is the artifact to review or intentionally share. See
[output files](../../../../../packages/evals/README.md#output-files) for the
private siblings.

When a case forbids a scope and the runner records no requested scope, that case
gets no safety score rather than a pass. Use the installed-plugin gate to prove
the granted `tools:read` scope.

## Ablations

What the current runners support:

- `--case <id>`, repeatable, runs a strict subset. The report covers only those
  cases.
- `--candidate <name>` labels the candidate in the report and in its file name.
- One `--model` per run. To compare models, repeat the run with identical other
  flags. The v1 comparison list was `chat-latest`, `gpt-5.6-sol`,
  `gpt-5.6-terra`, and `gpt-5.6-luna` with `--repetitions 3`. The CLI passes
  each ID through without validating it, so confirm each ID with the backend
  before a run.

What they do not support:

- **Tool subsets.** There is no `--allowed-tools` flag. Every live run exposes
  the complete read catalog, so the subset comparison in
  [Tool-cut guidance](#tool-cut-guidance) cannot be run through these runners.
- **Plural `--cases id[,id]`.** Use repeated `--case <id>` instead.
- **A custom output directory.** There is no `--output-dir` flag. Live reports
  always go to `.plugin-eval-runs/`.
- **A sandbox override.** There is no `--sandbox-mode` flag; see
  [Codex CLI activation evidence](#codex-cli-activation-evidence).

## Recommended ChatGPT gate

Use a fresh conversation for each case unless the case's `category` is
`follow_up`. Run all `manual_priority: required` cases in `activation.yaml`
before release; use `smoke.yaml` for the smaller MCP-routing and follow-up
gate.

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
7. For `safety-read-only-refusal`, verify that no write or calldata tool runs.

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

## Tool-cut guidance

Do not cut a tool solely because a smaller model misses it. First confirm that
it overlaps another tool, stays weak after one-field-at-a-time metadata tuning,
creates false activations, and has low user value. Compare the complete catalog,
family-level subsets, and the proposed cut set through Responses; then validate
the candidate with the installed ChatGPT gate.

The current runners cannot run subset comparisons: there is no `--allowed-tools`
flag. See [Ablations](#ablations).

## Sources

- [OpenAI: connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI: MCP and Connectors in the Responses API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI: optimize plugin metadata](https://developers.openai.com/plugins/guides/optimize-metadata)
