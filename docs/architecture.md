# Architecture

`askgina/plugins` is the candidate public-distribution workspace. Until a
separately authorized authority transition, the private application remains the
operating source.

## Packages

The dependency DAG is `contracts -> sdk/plugin-core -> cli/evals`. Workspace
cycles are forbidden, and packed artifacts replace workspace ranges with the
single repository release version before clean-install verification.

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
that common contract; they cannot change the rubric.
The patched Effect TSGo compiler and official Vite+ Oxlint preset fail on every
enabled compiler and Effect diagnostic; there is no baseline or count ratchet.

## Artifacts

The pack task creates five npm-style package archives, five host archives, one
skills candidate, and four bounded receipts. Verification compares hashes and
file lists, performs fresh package-closure installs, reruns target conformance,
and regenerates the four-dimension hermetic eval aggregate from synthetic files.
`dist/` is generated evidence, never authoring source.

## CI

GitHub Actions are fork-safe and build-only. Pull-request workflows use
`pull_request` with `contents: read`; dependency audit and package clean-install
smoke checks are blocking. A separate manual Responses live-smoke workflow may
read two protected secrets and uploads only the sanitized aggregate. There is no
release job, OIDC, package writer, or remote cache.
