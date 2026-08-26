# Architecture

`askgina/plugins` is the candidate public-distribution workspace. Until a
separately authorized authority transition, the private application remains the
operating source.

## Packages

The dependency DAG is `contracts -> sdk/plugin-core -> cli/evals`. Workspace
cycles are forbidden, and packed artifacts replace workspace ranges with the
single repository release version before clean-install verification.

`@askgina/contracts` and `@askgina/sdk` expose only their ESM package roots: no
CommonJS, browser, edge, or subpath entrypoints. They support Node >=24 and Bun

> =1.4. The compiled CLI and eval executables run on Bun 1.4.x only.

## Skills

`plugins/ask-gina/skills/` is the only authoring source. Pack-time generation
builds temporary host trees and the skills candidate. Generated
`targets/<host>/skills/` copies are not source.

## Runtime

The CLI uses `@effect/platform-bun` `BunRuntime.runMain` and `BunServices.layer`.
It must not depend on `@effect/platform-node` or Redis.

Library and tool APIs return typed Effects. Promise APIs are confined to external
integration boundaries, and application executables provide Bun services once.
Live evals share one suite, observation, grading, replay, and sanitized-report
pipeline. Responses API and Codex CLI adapters only translate host evidence into
that common contract; they cannot change the rubric. Eval commands execute the
compiled binaries in `dist/`; suite definitions and observation fixtures remain
repository YAML inputs.

The patched Effect TSGo compiler and official Vite+ Oxlint preset fail on every
enabled compiler and Effect diagnostic; there is no baseline or count ratchet.

## Artifacts

`vp pack` writes each package's ignored compiled JavaScript, declarations, and
source maps; every map embeds committed TypeScript through relative paths. The
repository's custom packer stages those validated outputs with metadata and assets
as five npm-style package archives, five host archives, one skills candidate, and
four bounded receipts under ignored `dist/`. Verification clean-installs package
tarballs in temporary projects, checks their closures, runs their actual runtime
entrypoints, reruns target conformance, and regenerates the four-dimension
hermetic eval aggregate from synthetic files. Generated `dist/` content is evidence, never authoring source.

## CI

Fork-safe GitHub Actions run formatting, lint, compiler, test, audit, target
conformance, artifact clean-install/runtime, and public-boundary gates on pull
requests. These workflows use `pull_request` with `contents: read`, but `main`
has no protected required checks, so they do not gate merge. A separate manual
Responses live-smoke workflow may read two protected secrets and uploads only the
sanitized aggregate. There is no release job, OIDC, package writer, remote cache,
or publication authority.
