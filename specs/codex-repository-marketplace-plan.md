# Codex repository marketplace plan

## Goal

A clean checkout by a GitHub principal with read access to the private `askgina/plugins` repository must install Ask Gina through the Codex and ChatGPT repository marketplace without running Bun, Vite+, or artifact generation. The repository keeps one authored skill tree and continues to produce lean host archives.

The implementation may be merged to `main` and verified through an isolated repository-marketplace install. This plan does not authorize OpenAI universal-directory submission, npm publication, MCP deployment, or installation for end users.

## Locked inputs

- [#22](https://github.com/askgina/plugins/issues/22) locks the distribution contract.
- [#21](https://github.com/askgina/plugins/issues/21) proves clean-checkout Codex installation and lean generated artifacts. The captured evidence is commit [`5b570717`](https://github.com/askgina/plugins/blob/5b57071738e51dbf12dd1c645d5adbd37cc46793/PROTOTYPE_CODEX_MARKETPLACE.md).
- [#20](https://github.com/askgina/plugins/issues/20) locks the source and target-generation migration.
- [#24](https://github.com/askgina/plugins/issues/24) locks conformance and install verification.
- [#23](https://github.com/askgina/plugins/issues/23) orders the work and defines rollback.
- On 2026-08-26, the delivery owner kept the repository private and authorized least-privilege GitHub authentication for remote marketplace clones. This supersedes the credential-free clause in #24 while preserving isolated plugin and MCP authentication boundaries.

## Resulting source tree

```text
.agents/plugins/marketplace.json
plugins/ask-gina/
  .codex-plugin/plugin.json
  .mcp.json
  assets/icon.svg
  skills/<skill>/{SKILL.md,agents/openai.yaml}
  targets/{claude,cursor,copilot,gemini}/...
```

`plugins/ask-gina/skills/` remains the only authored skill tree. The plugin root becomes the directly loadable OpenAI source. Non-OpenAI target overlays remain under `targets/`. Generated targets and receipts remain ignored output under `dist/`.

The marketplace descriptor has no version field. Version equality applies to versioned package and plugin manifests, release constants, generated archives, and receipts.

## Implementation

1. Add `.agents/plugins/marketplace.json` with marketplace name `ask-gina-plugins`, one local source at `./plugins/ask-gina`, installation policy `AVAILABLE`, authentication policy `ON_INSTALL`, and category `Finance`.
2. Move the OpenAI manifest, MCP configuration, and icon from `plugins/ask-gina/targets/openai/` to the plugin root. Delete `targets/openai/`. Do not add aliases, duplicate skills, or symlinks.
3. Update `tools/sync-plugin-skills.ts`. `assertSourceIsPortable` must require the root OpenAI files and reject a legacy OpenAI overlay. `materializeTarget` must select root OpenAI files for OpenAI and retain overlay copying for the other hosts.
4. Update `tools/pack-artifacts.ts`. OpenAI version validation reads the root manifest. OpenAI staging selects only `.codex-plugin/`, `.mcp.json`, `assets/`, and canonical `skills/`. Other hosts keep their existing path.
5. Update `tools/check-target-conformance.ts` with an exact repository-marketplace and root-source check. Reject malformed policy, path escape, external symlinks, missing declared files, a legacy OpenAI overlay, and version mismatch on versioned files.
6. Update `tools/verify-artifacts.ts` and existing archive tests so the OpenAI archive remains lean and foreign-host-free.
7. Migrate Codex evaluator consumers from MCP server name `gina` to `ask-gina`. Move installed-plugin preflight from the Claude MCP path to root `.mcp.json`. Update the matching evaluator tests.
8. Update plugin-core, sync, conformance, pack, verifier, and evaluator tests at their existing boundaries. Update `docs/architecture.md` to distinguish root OpenAI source, non-OpenAI overlays, generated targets, and ignored artifacts.
9. Add an isolated Codex marketplace smoke command. It must use a temporary `HOME`, config, and cache, exercise the remote owner/repository plus `--ref` syntax proved by #21, inspect the installed files, and remove the plugin and marketplace on every exit. For the private repository, accept one dedicated read-only repository token through `CODEX_MARKETPLACE_REPOSITORY_TOKEN`, write it only to a mode-0600 temporary token file, expose a token-free temporary `GIT_ASKPASS` helper only to `marketplace add`, delete both files before plugin installation, and never pass the token itself to Codex's environment or arguments.
10. Add the smoke to CI only on a trusted same-repository `push`, never in a pull-request job that executes PR-controlled code. Pull requests keep all credential-free static and artifact gates. Treat `ON_INSTALL` as listing metadata in this automated check; it does not prove OAuth or a live MCP connection.

## Verification

Before review and merge, run:

```sh
bun run check
bun run test
bun run check:target-conformance
bun run artifacts
bun run verify:artifacts
bun run check:public-boundary
# Provide CODEX_MARKETPLACE_REPOSITORY_TOKEN through the process environment.
bun run check:marketplace:codex -- --ref <published-pr-sha>
```

Run the authenticated remote smoke from the same immutable PR-head SHA's trusted `push` workflow, not its pull-request workflow. Run an external review after these commands pass. Fix every accepted finding and rerun the affected proof. Merge only a published PR revision with green required checks.

Before the initial merge, manually verify the supported ChatGPT host flow described in #24. Record the tested commit, client and platform, install or connection evidence, and one successful skill and tool response. Codex CLI installation alone does not prove host authentication.

After merge, repeat the isolated authenticated remote Codex sequence against the immutable `main` commit SHA. The `main` push workflow is acceptable proof when it reports that exact SHA. Remove all temporary repository credentials, plugin, marketplace, home, config, cache, build, and worktree state.

## Rollback

Do not merge if static checks, the isolated Codex smoke, manual ChatGPT verification, or review fails.

If the merged revision fails its remote proof, revert the implementation merge commit. That restores the old OpenAI overlay and removes the root marketplace source as one change. Any replacement must repeat review, CI, manual ChatGPT verification, and the post-merge remote proof.
