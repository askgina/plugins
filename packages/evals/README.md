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

`HarnessAgent` is re-exported from the stock `@ai-sdk/harness` 1.0.102, and
`createCodex` with `CodexHarnessSettings` from the stock
`@ai-sdk/harness-codex` 1.0.104. Import them from `@askgina/evals` so installed
consumers resolve the same adapter versions as the evaluators. There is no
patched adapter, auth-store lease, or restricted-settings surface.

`OmpHarnessTrialOptions` requires a nested `auth: OmpAuth` value. API-key
callers pass `{ mode: "api-key", provider, apiKey }`, optionally with
`providerBaseUrl`; native callers pass `{ mode: "native", provider, agentDirectory }`. The former
top-level `provider`, `apiKey`, and `providerBaseUrl` fields are removed.
The API-key provider type is `OmpApiKeyProvider`.

`createLocalHarnessSandbox` is a synchronous local-process sandbox provider for
stock `HarnessAgent`/`createACP` on POSIX hosts. Sessions run commands as
ordinary host child processes in their own process group under a disposable
home, working, and temporary directory, with group-signalled cleanup on stop or
destroy. This is runtime placement, not a security boundary: it enforces no
filesystem, network, or process isolation. It omits optional network-policy
changes, dynamic port configuration, request transformations, and session
resume. It throws on Windows.

The dependencies `@ai-sdk/harness` 1.0.102, `@ai-sdk/harness-acp` 1.0.40, and
`@ai-sdk/harness-codex` 1.0.104 are Copyright 2023 Vercel, Inc., licensed under
Apache-2.0; this package includes the Apache-2.0 license.

## Hermetic replay

```sh
bun run eval:replay -- \
  --suite packages/evals/src/fixtures/model-smoke.yaml \
  --observations packages/evals/src/fixtures/synthetic-observations.yaml \
  --output /tmp/plugin-eval-report.json
```

## Retained attempt summaries and public exports

`--attempts-output` remains an optional grader companion. Without it, replay stays
aggregate-only. Every live CLI always writes the v1 aggregate and a
`.journal-v1.jsonl` sibling described below. That journal is not a grader
artifact and does not change grading or the v1 aggregate. Opt-in attempt
capture writes a separate, exclusive mode-`0600` JSON file bound to the exact
saved report bytes. It retains public identities,
existing check verdicts, approved failure categories, durations and available
token counts, never raw observations. Capture requires a saved report and does
not change grading or its aggregate output.

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

| Runner        | Additional environment                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Responses API | `OPENAI_API_KEY`                                                                                                       |
| OpenRouter    | `OPENROUTER_API_KEY`                                                                                                   |
| Codex CLI     | `OPENAI_API_KEY`, absolute `CODEX_EVAL_EXECUTABLE`, and its lowercase SHA-256 digest in `CODEX_EVAL_EXECUTABLE_SHA256` |
| Claude CLI    | `ANTHROPIC_API_KEY` and absolute `CLAUDE_EVAL_EXECUTABLE`                                                              |
| OMP API key   | `OMP_EVAL_API_KEY`, absolute `OMP_EVAL_EXECUTABLE`, and its lowercase SHA-256 digest in `OMP_EVAL_EXECUTABLE_SHA256`   |
| OMP native    | Absolute `OMP_EVAL_EXECUTABLE` and its lowercase SHA-256 digest in `OMP_EVAL_EXECUTABLE_SHA256`                        |

Codex and Claude use explicit API keys in disposable evaluation homes, not a
saved personal login. OMP defaults to `--omp-auth api-key`, which passes the
model key as `OMP_EVAL_PROVIDER_API_KEY` for a private `omp-eval` provider.

OMP also supports `--omp-auth native --omp-agent-dir <absolute-directory>`.
The directory must already exist. OMP uses it directly through
`PI_CODING_AGENT_DIR`; the evaluator does not copy credentials, generate native
provider settings, or require `OMP_EVAL_API_KEY`. OMP may refresh credentials,
update its databases, or migrate profile settings there. This is not a
read-only profile mount. Choose the directory deliberately.

Both OMP modes retain a minimal child environment and disable extensions.
They do not inherit `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
`OPENROUTER_API_KEY`. Native mode relies on the selected profile's credential
configuration, not arbitrary credential variables in the parent shell.

Responses and Codex accept model IDs understood by their OpenAI backends, such as
`gpt-5.1`. OpenRouter uses its `provider/model` namespace, such as
`openai/gpt-5.1`. Claude uses a Claude CLI model ID or alias without the
`anthropic/` prefix, such as `claude-sonnet-4-5-20250929`. OMP API-key mode requires
`--provider openai|anthropic|openrouter`; native mode accepts a native OMP provider
identifier, such as `openai-codex`. `--model` must be available through the
selected provider. For example, `--provider openai --model gpt-5.1` records
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
  --openrouter-endpoint openai \
  --expected-provider OpenAI \
  --max-cost-usd 25

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

bun run eval:omp -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id local-omp-native-example \
  --candidate main \
  --omp-auth native \
  --omp-agent-dir /absolute/path/to/existing/omp-agent \
  --provider openai-codex \
  --model gpt-5.6-luna \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000
```

Repeat `--case <case-id>` to run a strict subset. `--timeout-ms` is required for
the per-trial budget. OpenRouter requires `--openrouter-endpoint`,
`--expected-provider`, and `--max-cost-usd`, with no defaults. The expected
provider is an exact case-sensitive OpenRouter provider label, not an endpoint
slug or region. `--max-cost-usd` must be a positive finite amount. Before each
dispatch the CLI checks that the provider key has a non-resetting lifetime
limit, including BYOK, that fits that amount. The check is not a hard spend
cap. In-flight usage, delayed settlement, a mutable provider limit, external
auth, and overshoot remain unproven. Optional `--server-url` is OpenRouter-only
and accepts only the exact Gina-read URLs `https://askgina.ai/ai/gina/mcp`
(production, the default) and `https://alpha.askgina.ai/ai/gina/mcp`. Trailing
slashes and any other URL, including venue MCP endpoints, are rejected.
`--max-steps` is optional only for OpenRouter, and `--max-turns` is optional
only for Claude. Both default to `8` and accept `1` to `32`. `--provider` is
required only for OMP. `--omp-auth` and `--omp-agent-dir` are also OMP-only.
The directory flag is required for native mode and rejected in API-key mode.
Other runners reject those OpenRouter, Claude, and OMP flags. OMP rejects
`--max-steps` and `--max-turns`. ACP does not expose a
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
stock HarnessAgent and `createACP` on a local process and keeps the
`omp_harness` target distinct. Task
conformance and observed plugin activation are scored separately. The Claude
adapter has offline verification only. Synthetic events, loopback model
fixtures, and OMP local-runtime proof do not establish measured native-plugin
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

OMP requires the tested `18.1.17` executable. The CLI verifies its SHA-256 and
snapshots it once, then starts a fresh local `omp acp` session per trial under
`createLocalHarnessSandbox`. Bootstrap links that snapshot. Both authentication
modes load the isolated evaluation settings through an explicit `--config`
overlay. There is no Docker engine, container image, or host-socket requirement.
Local HarnessAgent bootstrap also requires Node.js and pnpm on the evaluator's
`PATH` (verified with Node.js 24.21.0 and pnpm 10.34.5).

Each API-key trial writes a static `models.yml` in its disposable home with one
private `omp-eval` provider and one selected-model entry. Public `--provider` /
`--model` identity stays on the report, attempt, and observation. In API-key mode,
the ACP child is launched with `--provider omp-eval` and the original backend
model id, including OpenRouter nested slugs. The
child receives the explicit model key as `OMP_EVAL_PROVIDER_API_KEY` through
the stock adapter's environment option. Standard provider credential variables
are not inherited. There is no credential broker or request transformation.

In API-key mode, OpenAI and OpenRouter use Chat Completions, not the Responses
transport that OMP can select for built-in providers. Anthropic uses its
Messages API. The CLI's `--reasoning` value selects native `--thinking`, with explicit effort
settings for OpenAI/OpenRouter and thinking budgets for Anthropic. The model
entry leaves capacities, cost, and input modalities to OMP 18.1.17's bundled
same-id metadata or defaults for unknown model ids.

Native mode passes the requested provider unchanged and uses the selected
profile's models and credentials. It writes no replacement `models.yml` and
passes no evaluator model key. Its agent-directory check reads filesystem
metadata only and rejects missing directories before MCP or model dispatch.
Canonical skills are staged under the disposable `HOME/.agents/skills` in both
modes, so selecting another agent directory does not redirect skill discovery.

OMP accepts exactly the 31-tool research catalog or the supported 32-tool
connected catalog. The dashboard renderer is not exposed to OMP or included in
research eval evidence. Host-side validation supports standard JSON Schema union
types while remaining strict and does not coerce arguments.

The Gina bearer stays on the host. Canonical MCP reads execute in the evaluator
process and are exposed as wrapped HarnessAgent host tools. The child does not
receive that token. Native OMP builtins are restricted to `read` via `--tools read`, while all 31 research MCP tools remain available; `read` still has ordinary host access;
the local sandbox is placement, not confinement. Stock OMP defaults
`tools.xdev` to true and mounts MCP tools under `xd://` instead of provider
functions; the session `config.yml` sets `tools.xdev: false` and the stock ACP
adapter uses HTTP for its host-tool MCP transport. Only the staged `read`
builtin is declared to the harness, mapped to `skill://` skill reads.
Native intent tracing is disabled. Native `retry.enabled` and
`retry.modelFallback` are false,
disabling agent-level TurnRecovery retries and configured model fallback. OMP
18.1.17's provider clients still retry some HTTP errors independently of those
settings. Native stream/stop recovery can also reissue requests. There is no
one-request guarantee; the absolute trial deadline still applies. Host-side JSON
Schema validation rejects invalid arguments as forwarded by OMP before MCP
execution. OMP may coerce the model's raw arguments before this check. ACP does
not provide a portable model-step limit.

Skill activation requires a successful native read, not loaded metadata or an ACP
intent title. Native skill reads contribute skill activation and failure evidence,
not research-tool routing calls. Token usage comes from the harness generation result and remains
absent when unavailable. A successful result also requires completed native
generation and sandbox cleanup. Failed or cancelled trials allow up to eight
seconds for session destroy without replacing the original failure. A cold local
synthetic smoke through stock OMP 18.1.17 proved a successful canonical host-tool
call, an MCP `isError` response recorded as a failed trial, and cleanup for both
sessions. The stock Codex adapter also passed a cold local host-tool smoke.

Native provider HTTP 500 errors arrive as ACP text plus `end_turn` with no typed
metadata, so OMP cannot yet replace every evaluator for reliable provider-failure
classification. This is tracked in
[OMP #11644](https://github.com/can1357/oh-my-pi/issues/11644).

Native mode passed a cold synthetic smoke with an inert API key stored through
OMP's stock credential API in a disposable `agent.db`, with no evaluator key
environment variable. The proof covered canonical skill reads, successful and
failed MCP calls, rejection before dispatch for a missing profile, API-key mode
compatibility, and one physical destroy per session. The receipt's
`profile.before` and `profile.after` hashes matched for `models.yml` and
`config.yml`, but `agent.db` changed during native execution. The selected
profile remained in place. This is not a read-only profile mount and proves
stored API-key delegation only, not real OAuth refresh or subscription access.
These fixtures do not prove real model behavior, production Gina connectivity,
or measured native-plugin activation.

Each live run writes a v1 aggregate below the ignored `.plugin-eval-runs/`
directory and a sibling `.journal-v1.jsonl`, both mode `0600`. OpenRouter
writes four siblings: the v1 aggregate `.json`, `.requested-routing-v1.json`,
`.configuration-v2.json`, and `.journal-v1.jsonl`. Keep all four. Other live
runners write only the aggregate and journal. `--attempts-output` remains an
optional grader companion and does not replace those siblings.

The journal writes its run header, fsynced, before credentials load. The
header captures suite, catalog, reasoning, account class, selected cases,
and repetitions. Trials outside that plan are rejected. OpenRouter trials
require valid provider-limit evidence; other runners reject that evidence.
Each trial fsyncs a `started` record before dispatch. OpenRouter also fsyncs each
`generation` record before tool execution. A failed generation callback
fails closed. Already-fsynced `started` and `generation` records remain if
failure, timeout, or interruption leaves a trial or run incomplete, even
without `finished` or `report-bound`. When a trial does finish, the record
stores settled status (`completed`, `failed`, `blocked`, `interruption`,
`timeout`), not a grader verdict. The exact report SHA is written only in a
final `report-bound` record after complete matching v1 report bytes are finalized,
before any report files are published. The record binds bytes, not proof that
publication succeeded. Binding checks the report identity and the evaluator's
returned case selection against the header. The legacy v1 report alone has no
case IDs and cannot prove that selection. Journal writes use one scoped file descriptor and reject
path replacement, unlinking or external size changes. An ambiguous write or sync
failure disables later appends and dispatches.

The routing and configuration files bind to the exact UTF-8 report bytes by
`sourceReportSha256`. Configuration identity also records
`configurationSha256` of the canonical configuration digest. That digest is
independent of run ID, report bytes, and JSON key order. OpenRouter CLI
runs emit `configuration-v2`, which binds requested `serverUrl` /
`mcpResource` (`prod` or `alpha`), `expectedProvider`, and `maxCostUsd` in
addition to requested OpenRouter routing, settings, runtime, generation-step
and deadline budgets, and auth class, plus actual installed runtime,
package, lock, and source facts, credential-free. Existing
`configuration-v1` files are not rewritten. `--max-steps` is recorded as
`generationSteps`. The OpenRouter CLI independently limits each trial to
eight task-tool executions, including parallel calls, and records that limit
as `taskToolCalls`. Exhausted calls are rejected before MCP dispatch.
Library evidence without an enforced task-call limit records null.

Returned `responseModel` and `provider` strings are observations.
The requested model slug is not compared to `responseModel`. Dated or
normalized aliases are valid. Observed mismatch compares only an explicit
`--expected-provider` label to a non-null provider, exact and
case-sensitive. If that label is set, as the OpenRouter CLI requires, a
null observed provider is persisted then fails `evidence-missing` before
tool dispatch. That is not observed-mismatch and not a verified route.
Null stays unknown only when `expectedProvider` is omitted, which the
library still allows. The provider label is not endpoint or region
evidence. Effective provider
observations that are not known stay explicit unknowns. Accepted omissions
are temperature, top_p, output-token-limit, and service-tier. The
configuration file is requested evidence, not observed gateway routing,
admission, comparability, or publication approval. Raw prompts, final
answers, tool arguments, provider payloads, HTTP bodies, child output, and
credential material are never persisted.

OpenRouter preflights the four sibling paths before credentials or trials.
Existing report, requested-routing, configuration, or journal files fail
closed. After a successful run it binds the journal first, then writes requested-routing
and configuration evidence, followed by the v1 report (`wx`, mode `0600`). A
journal-binding failure publishes none of these files. If
the report write fails after evaluator-owned routing or configuration
companions exist, those companions are deleted. The journal is retained,
including incomplete records. A nonzero exit means the run failed or at
least one rubric case did not pass. Exporting a measured result still
requires the recorded manual approval described above. Running or capturing
attempts does not approve publication.
