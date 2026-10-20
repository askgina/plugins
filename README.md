# askgina/plugins

**What this is:** the Apache-2.0 workspace for the Ask Gina programmatic
client (a TypeScript SDK and a Bun CLI), the listed plugin (a portable core
plus host adapters), the evals that check whether models use that plugin
correctly, and the public evals app. It does not log you in: SDK and CLI callers
bring their own token (see below).

Production Gina MCP is at `https://askgina.ai/ai/gina/mcp`. SDK and CLI callers
supply an externally acquired Gina bearer token with `tools:read`; neither client
implements login or OAuth authentication. See
[authentication](https://docs.askgina.ai/agents/authentication) and
[Agent Setup](https://askgina.ai/agent-setup) to obtain a read-only token.

New here? Start with [Start here](#start-here), which routes you by goal. The
[Reference](#reference) below it is for people changing the build, the evals
app, or the lint setup.

## Start here

### Pick your goal

| I want to...                                                       | Go to                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Call Gina from TypeScript code                                     | [`packages/sdk/README.md`](packages/sdk/README.md)                                                                                    |
| Call Gina from a terminal                                          | [`packages/cli/README.md`](packages/cli/README.md)                                                                                    |
| Use the shared catalog and protocol types                          | [`packages/contracts/README.md`](packages/contracts/README.md)                                                                        |
| Install the plugin in a host (Cursor, Grok Bot, Devin, and others) | [`plugins/ask-gina/README.md`](plugins/ask-gina/README.md#install)                                                                    |
| Connect ChatGPT, Claude, Codex, or another client                  | Public [Connect guides](https://docs.askgina.ai/connect/index)                                                                        |
| Run or change the evals                                            | [`packages/evals/README.md`](packages/evals/README.md#start-here). Start with replay: it makes no network calls and needs no secrets. |
| Work on the public evals app                                       | [Public evals app](#public-evals-app) in Reference                                                                                    |
| Contribute a change                                                | [`ai_docs/contributing.md`](ai_docs/contributing.md), then the loop below                                                             |
| Edit the public docs site                                          | `docs/` is the Mintlify source; authoring rules are in [`ai_docs/docs/authoring.md`](ai_docs/docs/authoring.md)                       |

### Contributor loop

You need Bun 1.4.x (the root `packageManager` is `bun@1.4.0`). From the
repository root:

```sh
bun install --frozen-lockfile
bun run fmt:check
bun run lint
bun run check
bun run test
bun run check:target-conformance
bun run artifacts
bun run verify:artifacts
bun run check:public-boundary
```

This is the list [`ai_docs/contributing.md`](ai_docs/contributing.md) asks you
to run before proposing a change. Pull-request CI runs these and a few more
gates (see [What CI runs](#what-ci-runs) in Reference). `main` has no protected
required checks, so CI does not gate merge or publish packages.

Things that surprise people:

- **Edit skills in one place.** Canonical skill source lives only under
  `plugins/ask-gina/skills/`. Host skill trees are generated at pack time and
  must not be committed.
- **`bun run check` is more than lint.** It also runs `evals:check-public`,
  `evals:check-grading`, the TypeScript compiler, and the TypeScript import
  check.
- **Docs changes have their own checks.** If you touch `docs/` or `tools/docs/`,
  also run `bun run docs:test` and `bun run docs:check`.
- **Fix Effect diagnostics at the source.** Don't suppress them or add
  baselines.

### Map of the repository

| Path                 | What lives there                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts` | `@askgina/contracts`: public catalog, protocol literals, receipt schemas.                                            |
| `packages/sdk`       | `@askgina/sdk`: TypeScript client.                                                                                   |
| `packages/cli`       | `@askgina/cli`: the compiled `ask-gina` Bun binary.                                                                  |
| `packages/evals`     | `@askgina/evals`: replay, live runners, grading, sanitization, public export.                                        |
| `plugins/ask-gina`   | `@askgina/plugin-core`: canonical plugin inputs (manifest, skills, eval cases, targets) and the Devin install notes. |
| `apps/evals`         | The public evals React/Vite app and its Storybook. Not an npm-published package.                                     |
| `tools/`             | Build, pack, verify, and boundary-check scripts; eval regrade and public-artifact checks; docs check.                |
| `docs/`              | Public Mintlify docs source.                                                                                         |
| `ai_docs/`           | Internal engineering docs: contributing, architecture, security, eval handoffs, docs authoring.                      |
| `patches/`           | Dependency patches, including the two Storybook docgen compatibility patches.                                        |
| `scripts/`           | Helper that applies the Effect TSGo patch.                                                                           |
| `specs/`             | Design plans.                                                                                                        |

---

# Reference

## Packages and runtimes

- `@askgina/contracts`: public catalog, protocol literals, and receipt schemas;
  root-only ESM for Node >=24 and Bun >=1.4
- `@askgina/sdk`: TypeScript client; root-only ESM for Node >=24 and Bun >=1.4
- `@askgina/cli`: compiled Bun `ask-gina` binary; Bun 1.4.x only
- `@askgina/plugin-core`: host-specific plugin core and loaders, in
  `plugins/ask-gina`
- `@askgina/evals`: compiled hermetic/live eval tools, shared contracts,
  adapters, replay, grading, and sanitization; Bun 1.4.x only

The contracts and SDK packages have no CommonJS, browser, edge, or subpath entrypoints.

## Commands

Root scripts from `package.json`, grouped by purpose:

```sh
# Setup and quality
bun install --frozen-lockfile
bun run audit
bun run fmt:check
bun run lint
bun run check                 # quality: evals:check-public, evals:check-grading, vp check, tsc, check:typescript-imports
bun run typecheck
bun run test
bun run check:typescript-imports
bun run check:target-conformance
bun run effect-tsgo:diagnostics

# Packaging and verification
bun run build
bun run artifacts
bun run verify:artifacts
bun run verify:packages
bun run verify:targets
bun run smoke:install
bun run check:public-boundary
bun run check:marketplace:codex

# Public evals app
bun run evals:dev            # Vite dev server (default port 5173)
bun run evals:build
bun run evals:typecheck
bun run evals:check-public
bun run evals:check-grading
bun run storybook            # Storybook on port 6006
bun run build-storybook

# Evals
bun run eval:replay
bun run eval:responses
bun run eval:codex
bun run eval:openrouter
bun run eval:claude
bun run eval:omp
bun run eval:export-public

# Docs
bun run docs:check
bun run docs:test
```

## What CI runs

Pull-request CI (`.github/workflows/ci.yml`) runs, in order:

```sh
bun install --frozen-lockfile
bun run audit
bun run fmt:check
bun run lint
bun run check
bun run evals:typecheck
bun run evals:build
bun run build-storybook
bun run test
bun run check:target-conformance
bun run artifacts
bun run verify:artifacts
bun run smoke:install
bun run check:public-boundary
```

It then smokes the Codex marketplace with a pinned Codex CLI at the published
revision. The docs workflow (`.github/workflows/docs.yml`) runs on pull requests
that touch `docs/`, `tools/docs/`, the plugin skills or `.mcp.json`, or the
contracts entry point: it runs `node --test tools/docs/*.test.mjs` and
`node tools/docs/check.mjs --external`.

## Public evals app

`apps/evals` is the public React/Vite app (not an npm-published package) with the Ask Gina
landing-page typography, watercolor artwork, UI components, and Storybook. It has a leaderboard, model
profiles, task evidence explorer, and methodology page. Measured September reports
coexist with explicitly illustrative fixtures. Measured rows cover tool conformance,
not final-answer correctness; public downloads are reviewed projections, not full
conversation archives. The viewer makes no live tool or wallet calls.

CI also runs `evals:build` and `build-storybook`. Their outputs stay in
`apps/evals/dist/app` and `apps/evals/dist/storybook`, separate from published
package artifacts. Storybook uses the existing TypeScript 7 toolchain plus a
TypeScript 5 compiler-API alias and the two docgen compatibility patches under
`patches/`. Local fonts and artwork are pinned in `tools/public-source-assets.ts`.

Before bundling, the public-artifact gate checks historical Claude reports against
strict projection fields and an exact reviewed path/hash allowlist. Changed or new
Claude JSON requires privacy review and corresponding provenance/allowlist updates;
never update a hash merely to admit raw provider output. Full conversations remain
outside the public repository. Sanitizing current files does not remove historical
Git objects, fork-network copies, or previous deployment/cache contents.

## Lint configuration

`@shadcn/lint` is registered in the root `vite.config.ts`.
`apps/evals/src` enables `shadcn/no-raw-colors`,
`shadcn/no-arbitrary-values` with `allow: ["layout"]`,
`shadcn/no-restyle` with `allow: ["layout"]` plus named evals CSS hooks on
primitives, and `shadcn/require-static-classes`.
`apps/evals/src/components/ui` turns `no-arbitrary-values`, `no-restyle`, and
`require-static-classes` off so primitives can keep structural values and
internal variants. `bun run lint` checks the whole workspace, and
`bun run check` includes lint. Add further rules under `lint.rules`, spreading
`effectTsgoRecommended.rules` first, or in app-scoped `lint.overrides`. See the
[available rules](https://github.com/shadcn-ui/lint/blob/main/README.md#rules) and
[configuration examples](https://github.com/shadcn-ui/lint/blob/main/docs/design-systems.md).

## Artifacts

`bun run artifacts` builds the five package outputs with `vp pack`; the
custom packer then creates five package tarballs, six complete host archives, one
four-skill candidate archive, and contract, package, target, and eval receipts
under ignored `dist/`. `bun run verify:artifacts` performs clean
tarball installs and runtime checks. Nothing here publishes, releases, deploys,
submits, or calls production during pull-request CI.

## Eval runners

Live eval runners are `bun run eval:responses`, `eval:codex`, `eval:openrouter`,
`eval:claude`, and `eval:omp`; hermetic replay is `eval:replay`. Credentials,
flags, what each runner can and cannot prove, capture, and publication rules
are in [`packages/evals/README.md`](packages/evals/README.md).

One detail the evals README does not name: OpenRouter's `--server-url` accepts
exactly `https://askgina.ai/ai/gina/mcp` (the default) or
`https://alpha.askgina.ai/ai/gina/mcp`. Any other URL, trailing slashes, and
venue MCP endpoints are rejected. OMP native mode's synthetic stored-credential
smoke is not a real OAuth or subscription authentication test.
