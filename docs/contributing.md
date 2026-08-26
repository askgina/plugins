# Contributing

Edit canonical skill source only under `plugins/ask-gina/skills/`. Host skill
trees are generated at pack time and must not be committed.

Keep the workspace on Bun 1.4.0, Vite+ 0.3.0, Vitest 4.1.11, and Effect
4.0.0-rc.111. The contracts and SDK artifacts also support Node >=24. Dependency
updates are reviewed plan revisions, not drive-by range bumps.

Do not add secrets, OIDC, package write, remote cache, or release workflows.
Public contract changes must not include `factoryKey`, JWT material, private
hosts, or authenticated observations.

Use the repository scripts before proposing a change:

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

`bun run artifacts` builds ignored package outputs with `vp pack` and stages the
custom packer's ignored archives and receipts under repository `dist/`;
`bun run verify:artifacts` checks clean tarball installs and their runtime
entrypoints. Pull-request CI runs these repository gates, but `main` has no
protected required checks, so CI does not gate merge or publish packages.

Do not suppress Effect diagnostics or add diagnostic baselines, report files, or
count ratchets. Fix the source. Package manifests, plugin manifests, and host
manifests must keep the root release version exactly aligned.
