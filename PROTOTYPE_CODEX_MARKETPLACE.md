# Codex Repository Marketplace Prototype

Throwaway evidence for askgina/plugins#21. This branch is not a production implementation and must not be merged.

## Question

Can Codex add `askgina/plugins` at a clean Git ref and install Ask Gina directly from `plugins/ask-gina` when that directory contains the declared OpenAI plugin surfaces plus ordinary workspace files and nested source for other hosts?

## Probe shape

Base revision: `f10b5d14f60f41e26df76803541a61a44ad3a05b`

Probe revision before evidence capture: `4505ff0c87156fb4e91646360bd2ce8c12878034`

The branch adds `.agents/plugins/marketplace.json` and temporarily copies the existing OpenAI manifest, MCP configuration, and asset to `plugins/ask-gina`. The old OpenAI overlay remains only so the existing artifact builder can prove isolation without implementing the production migration. Production must move these files and delete the obsolete overlay as locked in issue #22.

No generated skill copy or symlink is committed. The marketplace source uses the existing canonical `plugins/ask-gina/skills` tree.

## Runtime

Codex CLI: `0.149.0-alpha.4.3`

All Codex commands used `HOME=/tmp/codex-marketplace-probe-21`, so no user-global Codex configuration, cache, or credentials were read or retained. The temporary HOME caused a non-fatal warning that Codex would not create PATH aliases under `/tmp`.

## Commands and observations

```sh
codex plugin marketplace add askgina/plugins \
  --ref prototype/codex-marketplace-install --json
```

Codex cloned the public Git source, resolved marketplace `ask-gina-plugins`, and checked out `4505ff0c87156fb4e91646360bd2ce8c12878034` without running Bun, Vite+, package installation, or repository build commands.

```sh
codex plugin list --marketplace ask-gina-plugins --available --json
```

Codex advertised `ask-gina@ask-gina-plugins` version `0.1.0` from local source `plugins/ask-gina` with installation policy `AVAILABLE` and authentication policy `ON_INSTALL`.

```sh
codex plugin add ask-gina@ask-gina-plugins --json
```

Installation succeeded at:

```text
/tmp/codex-marketplace-probe-21/.codex/plugins/cache/ask-gina-plugins/ask-gina/0.1.0
```

The installed plugin was enabled. Codex copied the complete source directory, including `.codex-plugin`, `.mcp.json`, `assets`, four canonical skills and their `agents/openai.yaml` files, plus undeclared `src`, `evals`, `__tests__`, `targets`, `package.json`, and other workspace files. Their presence did not prevent discovery, installation, or enablement.

The installed manifest paths resolved to:

- `./skills/`: four canonical skills, each with `SKILL.md` and `agents/openai.yaml`;
- `./.mcp.json`: the production Ask Gina HTTP MCP endpoint;
- `./assets/icon.svg`: both declared icon paths.

`ON_INSTALL` was preserved in plugin metadata, but this Codex CLI install did not perform OAuth or contact a production account. Authentication enforcement on ChatGPT and other surfaces remains a separate verification concern.

## Generated host artifact isolation

After the zero-build marketplace probe completed, the branch ran:

```sh
bun install --frozen-lockfile
bun run artifacts
bun run verify:targets
```

The repository checks completed successfully: formatting, lint, typecheck, 104 tests, artifact assembly, and target verification. The generated `dist/targets/ask-gina-openai-0.1.0.tgz` contained only:

```text
.codex-plugin/
.mcp.json
assets/
skills/
```

It contained no `src`, `evals`, `__tests__`, root `targets`, package metadata, or foreign host manifest. This proves the marketplace source can tolerate ordinary tracked repository files while the generated public OpenAI artifact remains lean and isolated.

## Cleanup

The probe removed the installed plugin and marketplace with the Codex CLI. Its isolated temporary HOME can be deleted without affecting user-global state.

## Verdict

**Confirmed.** Codex can add the repository at a branch ref and install Ask Gina directly from `plugins/ask-gina` with zero preparatory build. Extra tracked workspace files and nested host source are copied but do not block installation. Existing artifact tooling can still produce a lean OpenAI host archive from the same canonical skills.

The production plan still needs a clean source migration: move the OpenAI metadata to the canonical root, teach generators to select those root files, and delete the old OpenAI overlay without aliases or duplication.
