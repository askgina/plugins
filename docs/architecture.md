# Architecture

`askgina/plugins` is the candidate public-distribution workspace. Until a
separately authorized authority transition, the private application remains the
operating source.

## Packages

`@askgina/contracts` has no workspace dependents inverted: SDK, plugin-core, and
evals depend on it; CLI depends on SDK. Cycles are forbidden.

## Skills

`plugins/ask-gina/skills/` is the only authoring source. Pack-time generation
builds temporary host trees and the skills candidate. Generated
`targets/<host>/skills/` copies are not source.

## Runtime

The CLI uses `@effect/platform-bun` `BunRuntime.runMain` and `BunServices.layer`.
It must not depend on `@effect/platform-node` or Redis.

## CI

GitHub Actions are fork-safe and build-only. Contributor workflows use
`pull_request` with `contents: read`. There is no release job, OIDC, secret,
environment, package writer, or remote cache.
