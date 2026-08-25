# @askgina/evals

One schema and rubric drive hermetic replay, OpenAI Responses API trials, and
Codex CLI trials. Live runners use the same suite cases, model, reasoning mode,
case selection, repetition count, and sanitized aggregate shape.

## Hermetic replay

```sh
bun run eval:replay -- \
  --suite packages/evals/src/fixtures/model-smoke.yaml \
  --observations packages/evals/src/fixtures/synthetic-observations.yaml \
  --output /tmp/plugin-eval-report.json
```

## Live trials

Live commands require a clean Git worktree, three to five repetitions, and the
same `--suite`, `--model`, `--reasoning`, and `--timeout-ms` values when comparing
runners. The default live benchmark suite is `ask-gina-routing-smoke.yaml`. Both
runners require `ASK_GINA_ACCESS_TOKEN` and `OPENAI_API_KEY` in the process
environment. Codex trials additionally require an absolute executable path in
`CODEX_EVAL_EXECUTABLE` and its lowercase SHA-256 digest in
`CODEX_EVAL_EXECUTABLE_SHA256`. The runner attests that executable, installs and
validates the repository plugin under a fresh temporary `CODEX_HOME`, seeds only
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
