# askgina/plugins

Apache-2.0 workspace for the Ask Gina programmatic client, Bun CLI,
listed-plugin portable core, host adapters, and hermetic evals.

Production Gina MCP remains at `https://askgina.ai/ai/gina/mcp`.
Callers supply a bearer token or oauth authenticate.

## Packages and runtimes

- `@askgina/contracts` — public catalog, protocol literals, and receipt schemas;
  root-only ESM for Node >=24 and Bun >=1.4
- `@askgina/sdk` — TypeScript client; root-only ESM for Node >=24 and Bun >=1.4
- `@askgina/cli` — compiled Bun `ask-gina` binary; Bun 1.4.x only
- `@askgina/plugin-core` — host-specific plugin core and loaders
- `@askgina/evals` — compiled hermetic/live eval tools, shared contracts,
  adapters, replay, grading, and sanitization; Bun 1.4.x only

The contracts and SDK packages have no CommonJS, browser, edge, or subpath entrypoints.

## Public evals app

`apps/evals` is a private React/Vite app with the Ask Gina landing-page typography,
watercolor artwork, UI components, and Storybook. It has a leaderboard, model
profiles, task evidence explorer, and methodology page. All scores and traces are
illustrative fixtures, not measured benchmarks. It makes no live tool or wallet calls.

```sh
bun run evals:dev       # App on port 5173
bun run storybook       # Stories on port 6006
bun run evals:typecheck
```

CI also runs `evals:build` and `build-storybook`. Their outputs stay in
`apps/evals/dist/app` and `apps/evals/dist/storybook`, separate from published
package artifacts. Storybook uses the existing TypeScript 7 toolchain plus a
TypeScript 5 compiler-API alias and the two docgen compatibility patches under
`patches/`. Local fonts and artwork are pinned in `tools/public-source-assets.ts`.

## Commands

```sh
bun install --frozen-lockfile
bun run audit
bun run fmt:check
bun run lint
bun run check
bun run test
bun run check:target-conformance
bun run artifacts
bun run verify:artifacts
bun run check:public-boundary
bun run smoke:install
```

`bun run artifacts` builds the five package outputs with `vp pack`; the
custom packer then creates five package tarballs, six complete host archives, one
four-skill candidate archive, and contract, package, target, and eval receipts
under ignored `dist/`. `bun run verify:artifacts` performs clean
tarball installs and runtime checks. Nothing here publishes, releases, deploys,
submits, or calls production during pull-request CI.
