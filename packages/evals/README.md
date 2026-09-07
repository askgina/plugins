# @askgina/evals

One schema and rubric drive hermetic replay, OpenAI Responses API trials, and
Codex CLI trials. Live runners use the same suite cases, model, reasoning mode,
case selection, repetition count, and sanitized aggregate shape.

`@askgina/evals` is a Bun 1.4.x-only compiled `dist` package. The root
`eval:replay`, `eval:responses`, and `eval:codex` commands build the package graph, then execute `packages/evals/dist/bin/*.js`; suite and observation YAML remain repository inputs.
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

Run these from the repository with fresh output paths. The synthetic replay includes
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

Live commands require a clean Git worktree, three to five repetitions, and the
same `--suite`, `--model`, `--reasoning`, and `--timeout-ms` values when comparing
runners. The default live benchmark suite is `ask-gina-routing-smoke.yaml`. Both
runners require `ASK_GINA_ACCESS_TOKEN` and `OPENAI_API_KEY` in the process
environment. Codex trials additionally require an absolute executable path in
`CODEX_EVAL_EXECUTABLE` and its lowercase SHA-256 digest in
`CODEX_EVAL_EXECUTABLE_SHA256`. On Linux, the runner rejects group- or
world-writable inputs, copies the verified bytes into a private non-writable
snapshot, unlinks it, and launches its open descriptor; unsupported platforms fail
closed. It then installs and validates the repository plugin under a fresh temporary
`CODEX_HOME`, seeds only
the temporary Gina MCP credential, verifies the exact MCP endpoint and OAuth
status and production catalog, then runs with an enforced permission profile.
The profile denies reads from `CODEX_HOME`, read-allows only the minimal runtime,
empty trial working tree, and validated plugin skills, disables shell network and
web search, and enables only the observed Gina MCP tools. Trials also use no
approvals, ignored user/project rules, bounded output, and a minimal child
environment.

```sh
bun run eval:responses -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id 2026-08-25-main \
  --candidate main \
  --model gpt-5.1 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000

bun run eval:codex -- \
  --suite packages/evals/src/fixtures/ask-gina-routing-smoke.yaml \
  --run-id 2026-08-25-main \
  --candidate main \
  --model gpt-5.1 \
  --reasoning medium \
  --repetitions 3 \
  --account-class eval \
  --timeout-ms 120000
```

Repeat `--case <case-id>` to run a strict subset. `--timeout-ms` is required so
both runners share the same per-trial budget. Secrets have no command-line flags.

Each live run writes exactly one mode-`0600` aggregate below the ignored
`.plugin-eval-runs/` directory. Raw prompts, final answers, tool arguments,
provider payloads, HTTP bodies, child output, and credential material are never
persisted. A nonzero exit means the run failed or at least one rubric case did
not pass.
