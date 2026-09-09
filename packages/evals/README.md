# @askgina/evals

One schema and rubric drive hermetic replay, OpenAI Responses API trials,
OpenRouter trials, Codex CLI trials, Claude CLI trials, and OMP HarnessAgent
trials. Live runners use the same suite cases, reasoning mode, case selection,
repetition count, and sanitized aggregate shape. Model IDs and turn limits remain
backend-specific.

`@askgina/evals` is a Bun 1.4.x-only compiled `dist` package. The root
`eval:replay`, `eval:responses`, `eval:codex`, `eval:openrouter`,
`eval:claude`, and `eval:omp` commands build the package graph, then execute
`packages/evals/dist/bin/*.js`; suite and observation YAML remain repository
inputs.
Artifact verification clean-installs the built tarball and exercises its compiled
import and replay entrypoint. The package supports only its root ESM import; Node.js,
CommonJS, browser and edge runtimes, and subpath imports are unsupported.

## Hermetic replay

```sh
bun run eval:replay -- \
  --suite packages/evals/src/fixtures/model-smoke.yaml \
  --observations packages/evals/src/fixtures/synthetic-observations.yaml \
  --output /tmp/plugin-eval-report.json
```

## Retained attempt summaries and public exports

Replay and live commands remain aggregate-only unless `--attempts-output` is supplied.
Opt-in capture writes a separate, exclusive mode-`0600` JSON file bound to the exact
saved report bytes. It retains public identities, existing check verdicts, approved
failure categories, durations and available token counts, never raw observations.
Capture requires a saved report and does not change grading or its aggregate output.

```sh
bun run eval:replay -- \
  --suite packages/evals/src/fixtures/model-smoke.yaml \
  --observations packages/evals/src/fixtures/synthetic-observations.yaml \
  --output /tmp/eval-private/report.json \
  --attempts-output /tmp/eval-private/attempts.json

bun run eval:export-public -- \
  --manifest /tmp/eval-private/result-request.json \
  --report /tmp/eval-private/report.json \
  --attempts /tmp/eval-private/attempts.json \
  --configuration /tmp/eval-private/configuration.json \
  --output-dir /tmp/eval-public
```

Run these from the repository with fresh, canonical output paths. The examples assume
`/tmp` is a real directory. On macOS, replace `/tmp` with `/private/tmp`; exporter output
paths containing symlink components are rejected.

The synthetic replay includes
a failed case; its exit `0` means replay and persistence succeeded, not that all cases
passed. Inspect the aggregate counts. These commands make no live model or MCP calls.

The exporter requires an explicit manifest. Measured publications require recorded
manual approval bound to the complete proposed publication; synthetic previews remain
separate and labeled. Configuration declarations require immutable component hashes
and matching run settings. Missing configuration stays `labels_only`; all v1 results
are unranked. Source inputs must stay outside the public output directory.
Corrections create immutable revisions. Privacy withdrawal removes previous snapshot
bytes, including older notices, and retains only safe index references and a notice.

Canonical DTO fixtures, field definitions, request formats and consumer instructions
live in `ai_docs/evals-handoff/` in the repository. The existing app reads publication
and index JSON at `/#/handoff`, using erased contract types, not evaluator runtime.

## Live trials

Live commands require a clean Git worktree and three to five repetitions. Use the
same suite, case selection, reasoning setting, repetition count, account class,
and timeout for a controlled comparison. Model IDs use each backend's namespace,
so the literal `--model` value may differ for the same model family. Record that
mapping with the result instead of presenting the strings as identical settings.
The default live benchmark suite is `ask-gina-routing-smoke.yaml`.

Every live runner requires `ASK_GINA_ACCESS_TOKEN`. The provider and native CLI
credentials differ:

| Runner        | Additional environment                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Responses API | `OPENAI_API_KEY`                                                                                                                            |
| OpenRouter    | `OPENROUTER_API_KEY`                                                                                                                        |
| Codex CLI     | `OPENAI_API_KEY`, absolute `CODEX_EVAL_EXECUTABLE`, and its lowercase SHA-256 digest in `CODEX_EVAL_EXECUTABLE_SHA256`                      |
| Claude CLI    | `ANTHROPIC_API_KEY` and absolute `CLAUDE_EVAL_EXECUTABLE`                                                                                   |
| OMP harness   | `OMP_EVAL_API_KEY`, absolute `OMP_EVAL_EXECUTABLE`, its lowercase SHA-256 digest in `OMP_EVAL_EXECUTABLE_SHA256`, and a local Docker engine |

The supported native Codex, Claude, and OMP paths use explicit API keys in
isolated evaluation homes. They do not reuse a saved personal login. Saved-login
reuse, refresh ownership, and personal-home integration remain deferred. OMP does
not read `~/.omp` or inherit `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
`OPENROUTER_API_KEY`. Native OMP also never exports those names into the
isolated child. The child receives only `OMP_EVAL_PROVIDER_API_KEY` for
the private `omp-eval` provider.

Responses and Codex accept model IDs understood by their OpenAI backends, such as
`gpt-5.1`. OpenRouter uses its `provider/model` namespace, such as
`openai/gpt-5.1`. Claude uses a Claude CLI model ID or alias without the
`anthropic/` prefix, such as `claude-sonnet-4-5-20250929`. OMP requires `--provider`
to select `openai`, `anthropic`, or `openrouter`; `--model` uses that provider's
backend ID. For example, `--provider openai --model gpt-5.1` records
`openai/gpt-5.1`, while `--provider openrouter --model openai/gpt-5.1` records
`openrouter/openai/gpt-5.1`. The report, attempt input, and observation keep that
same identity. There is no separate displayed model. These examples show the
required ID shapes.
They do not declare a benchmark configuration or claim that a live run was
performed.

```sh
bun run eval:responses -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id local-responses-example \
  --candidate main \
  --model gpt-5.1 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000

bun run eval:codex -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id local-codex-example \
  --candidate main \
  --model gpt-5.1 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000

bun run eval:openrouter -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id local-openrouter-example \
  --candidate main \
  --model openai/gpt-5.1 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000 \
  --max-steps 8 \
  --openrouter-endpoint openai

bun run eval:claude -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id local-claude-example \
  --candidate main \
  --model claude-sonnet-4-5-20250929 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000 \
  --max-turns 8

bun run eval:omp -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id local-omp-example \
  --candidate main \
  --provider openai \
  --model gpt-5.1 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000
```

Repeat `--case <case-id>` to run a strict subset. `--timeout-ms` is required for
the per-trial budget. `--openrouter-endpoint` is required for OpenRouter and has
no default. `--max-steps` is optional only for OpenRouter, and `--max-turns` is
optional only for Claude. Both default to `8` and accept `1` to `32`.
`--provider` is required only for OMP. The other runners reject those
flags. OMP rejects `--max-steps` and `--max-turns`. ACP does not expose a
portable native model-step boundary, so OMP does not claim an equal step budget
with OpenRouter or Claude. Secrets have no command-line flags.
A missing required flag or backend credential fails closed. The CLI does not
switch runners or auth methods. Add
`--attempts-output /tmp/eval-private/attempts.json` to any command when retained,
report-bound attempt summaries are required. The capture rules in the previous
section still apply.

OpenRouter executes Gina tools through the local AI SDK MCP client. Its offline
real-SDK intercepted-transport proof establishes only requested serialization,
not the provider-selected endpoint, gateway translation, or native HarnessAgent
behavior. Responses uses OpenAI-hosted MCP. Neither proves native plugin
activation, and these two execution paths retain separate runner identities.
Codex and Claude load the
repository plugin through their native CLIs. OMP talks to `omp acp` through
HarnessAgent in Docker and keeps the `omp_harness` target distinct. Task
conformance and observed plugin activation are scored separately. The Claude
adapter has offline verification only. Synthetic events, loopback model
fixtures, and OMP Docker/runtime proof do not establish measured native-plugin
activation; Claude's live activation remains unverified.

Claude requires a CLI supporting `--restricted` and `--permission-prompts none`;
the flag set was checked against version `2.1.263`. Bare mode is not used because
it suppresses the native Skill tool in this version.
The runner stages a complete session-only plugin and keeps its credentials in a
separate temporary config directory. It never installs into your personal home.
The isolated child sets `CLAUDE_CODE_MAX_RETRIES=0` and
`CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK=1`, and does not inherit the retry
watchdog. These disable the main API retry budget and non-streaming fallback.
Claude documents additional pre-response stall/drop reissues outside that budget,
so this is not a guarantee of one HTTP request per model step. The trial deadline
still bounds the native process.
`--max-steps` bounds OpenRouter generation steps, and `--max-turns` bounds Claude
turns. Neither is a count of individual tool calls.

For Codex, the runner verifies and snapshots the configured executable on Linux,
installs and validates the repository plugin under a fresh temporary `CODEX_HOME`,
and seeds only the temporary Gina MCP credential. It verifies the production MCP
endpoint, OAuth status, and catalog before the trial. The enforced profile denies
reads from `CODEX_HOME`, allows only the minimal runtime, empty trial working tree,
and validated plugin skills, disables shell network and web search, and enables
only the observed Gina MCP tools. Trials also use no approvals, ignored
user/project rules, bounded output, and a minimal child environment. Unsupported
platforms fail closed.

OMP requires the tested `18.1.14` executable and a local Docker engine at
`/var/run/docker.sock`. The CLI verifies its SHA-256 and snapshots it once, then
starts a fresh Docker session per trial. The default Node image is digest-pinned.
Containers run as a non-root user, with a read-only root filesystem and runtime
mount, writable temporary filesystems, and no host Docker socket or personal OMP
configuration mounted inside. Bootstrap installs the pinned ACP bridge dependencies.

Each trial writes a static `models.yml` with one private `omp-eval` provider
and one selected-model entry. Public `--provider` / `--model` identity stays
on the report, attempt, and observation. Native ACP uses `--provider omp-eval`
and the original backend model id, including OpenRouter nested slugs. The
child credential env is only `OMP_EVAL_PROVIDER_API_KEY`; the credential
transformation hook matches that same name. Standard provider env names are
not exported, so built-in discovery managers do not start.

OpenAI and OpenRouter use Chat Completions, not the Responses transport that
OMP can select for built-in providers. Anthropic uses its Messages API. The
CLI's `--reasoning` value selects native `--thinking`, with explicit effort
settings for OpenAI/OpenRouter and thinking budgets for Anthropic. The model
entry leaves capacities, cost, and input modalities to OMP 18.1.14's bundled
same-id metadata or defaults for unknown model ids.

This local Docker provider does not broker credentials outside the container.
The Gina bearer stays on the host, where canonical MCP reads execute. The native
guard permits only the canonical MCP inventory and exact staged skill reads;
URL reads, other files, shell tools, and unregistered tool attempts fail the trial.
Native intent tracing is disabled. ACP mappings use OMP's wire names, with a
`skill://` classifier for reads; the guard still checks the exact allowed URI.
The ACP launcher requires loaded guard evidence before forwarding the first prompt.
The guard waits up to five seconds for native MCP registration, within the trial
deadline, then requires the exact tool inventory before any model request. This
startup wait does not retry model or MCP calls. Native `retry.enabled` and
`retry.modelFallback` are false, disabling agent-level TurnRecovery retries and
configured model fallback. OMP 18.1.14's provider clients still retry some HTTP
errors independently of those settings. Native stream/stop recovery can also
reissue requests. There is no one-request guarantee; the absolute trial deadline
still applies. Host-side JSON Schema validation rejects invalid
arguments as forwarded by OMP before MCP execution. OMP may coerce the model's
raw arguments before this check. ACP does not provide a portable model-step limit.

Skill activation requires a successful native read, not loaded metadata or an ACP
intent title. Token usage comes only from native guard evidence and remains absent
when unavailable. A successful result also requires completed native generation
and removal of the owned Docker resources. Failed or cancelled trials allow up to
eight seconds for cleanup without replacing the original failure. Synthetic model/MCP fixtures exercise
the real OMP process and protocol; they do not prove real model behavior, production
Gina connectivity, or measured native-plugin activation.

Each live run writes a mode-`0600` v1 aggregate below the ignored
`.plugin-eval-runs/` directory. OpenRouter writes three sibling mode-`0600`
files: the report `.json`, `.requested-routing-v1.json`, and
`.configuration-v1.json`. Keep all three. The routing and configuration files
bind to the exact UTF-8 report bytes by `sourceReportSha256`. Configuration
identity also records `configurationSha256` of the canonical configuration
digest. That digest is independent of run ID, report bytes, and JSON key
order. It captures requested OpenRouter routing, settings, runtime,
generation-step and deadline budgets, and auth class, plus actual installed
runtime, package, lock, and source facts, credential-free. `--max-steps` is
recorded as `generationSteps`. The OpenRouter CLI independently limits each
trial to eight task-tool executions, including parallel calls, and records
that limit as `taskToolCalls`. Exhausted calls are rejected before MCP dispatch.
Library evidence without an enforced task-call limit records null. Effective
provider observations that are not known stay explicit unknowns. Accepted omissions are temperature, top_p,
output-token-limit, and service-tier. The configuration file is requested
evidence, not observed gateway routing, admission, comparability, or
publication approval. Other runners still write only the aggregate. Raw
prompts, final answers, tool arguments, provider payloads, HTTP bodies, child
output, and credential material are never persisted.

OpenRouter preflights the three sibling paths before credentials or trials.
Existing report, requested-routing, or configuration files fail closed. After
a successful run it writes requested-routing and configuration evidence
first, then the v1 report (`wx`, mode `0600`). If the report write fails
after evaluator-owned companions exist, those companions are deleted. A
nonzero exit means the run failed or at least one rubric case did not pass.
Exporting a measured result still requires the recorded manual approval
described above. Running or capturing attempts does not approve publication.
