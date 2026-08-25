# Contributing

Edit canonical skill source only under `plugins/ask-gina/skills/`. Host skill
trees are generated at pack time and must not be committed.

Keep the workspace on Bun 1.4.0, Vite+ 0.3.0, Vitest 4.1.11, and Effect
4.0.0-rc.111. Dependency updates are reviewed plan revisions, not drive-by
range bumps.

Do not add secrets, OIDC, package write, remote cache, or release workflows.
Public contract changes must not include `factoryKey`, JWT material, private
hosts, or authenticated observations.
