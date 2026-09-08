# Native Codex personal-login reuse and eval configuration

Research date: 2026-09-08. This source-only report resolves [the personal-login separation research question](https://github.com/askgina/plugins/issues/53), not the remaining authentication-policy decision. The owner requires an already-saved personal Codex login with no additional login. No credential store, keyring, authentication command, model call or MCP call was accessed.

## Finding

The reviewed native Codex release, `rust-v0.153.4`, couples model authentication to `CODEX_HOME`. It does not expose a first-class independent auth-store path that lets a temporary eval home borrow the personal login while all eval configuration, plugin installation and MCP credential state remain elsewhere.

This is **not** a finding that local personal-login evals are impossible. Native execution against the personal `CODEX_HOME` can reuse its login. It means the policy must distinguish that same-home mode from the stronger requirement that every eval-owned file live outside the personal home. Whether an explicitly managed eval profile can coexist safely with personal state remains a policy choice and requires later runtime proof.

## Evidence

The evaluator baseline is [`askgina/plugins@ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6`](https://github.com/askgina/plugins/tree/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals). Native source references below use the `rust-v0.153.4` release tag, not moving main.

| Source fact | Evidence |
| --- | --- |
| `find_codex_home` resolves `CODEX_HOME` or the normal user home plus `.codex`. An explicit directory must exist and is canonicalized. | [Home selection](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/utils/home-dir/src/lib.rs) |
| `Config::auth_config` sets `AuthConfig.codex_home` from the same loaded `Config.codex_home`. The bootstrap path also receives that home. | [Auth/config binding](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/config/auth_keyring.rs) |
| File-backed model auth is `auth.json` under that home. Direct keyring and ephemeral-store identities also derive from the canonical home; changing storage mode is not an independent auth-root selector. | [Credential storage](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/login/src/auth/storage.rs) |
| Authentication loading and refresh persistence use the configured home/backend. Native Codex owns refreshed token writes; a different home selects a different store. | [Auth manager](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/login/src/auth/manager.rs) |
| Plugin cache/data and marketplace installation paths derive from the Codex home. | [Plugin store](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core-plugins/src/store.rs), [marketplace installations](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core-plugins/src/installed_marketplaces.rs) |
| MCP file credentials use `.credentials.json` under the home. Secrets-backed storage also derives from that home. | [Configuration types](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/config/src/types.rs), [local secrets](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/secrets/src/local.rs) |
| Profiles and session configuration overrides operate on the selected configuration root. They do not supply an independent personal-auth-store handle. `--strict-config` is not a home-isolation mechanism. | [Shared CLI options](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/utils/cli/src/shared_options.rs), [environment documentation](https://learn.chatgpt.com/docs/config-file/environment-variables) |

The parent independently inspected the versioned home-selection and auth/config-binding source. The remaining references were inspected by the read-only research worker. No runtime behavior is attested by those reads.

## Why changing the evaluator's home path is insufficient

At the evaluator baseline, `setupCodexRuntime` creates a scoped temporary home and working directory. It creates `config.toml`, installs the marketplace/plugin inside that home, validates installed skill bytes, and writes Gina's MCP credentials there. Its child environment maps `HOME`, `CODEX_HOME` and XDG paths to that same directory. Both existing live routes still require `OPENAI_API_KEY`. See [live setup and preflight](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/bin/live.ts).

The trial writer reads/writes the selected home's eval configuration and launches ephemeral Codex execution. Its restricted profile denies model-tool access to the Codex home, disables built-in web search and sandbox networking, and separately enables the allowlisted Gina MCP path. See [profile construction](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/codex-cli.ts#L485-L535) and [trial construction](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/codex-cli.ts#L764-L798).

That temporary-home setup and its cleanup cannot simply be redirected to a personal home. A personal-login mode must distinguish user-owned state from evaluator-owned state and must not overwrite unrelated configuration, replace personal plugin versions silently, seed over existing MCP credentials, or apply temporary-home deletion semantics to the personal directory.

## Options and limits

| Approach | Source result and remaining boundary |
| --- | --- |
| Native execution using the personal `CODEX_HOME` | Native login reuse exists. Eval-specific profile/plugin/MCP setup and ambient-state control need an explicit local policy and subsequent proof. No safety claim follows from changing one path. |
| Temporary eval home plus a separate native personal-auth pointer | No such first-class split was established in the pinned source. Do not invent an auth-path flag or assume keyring mode provides it. |
| A separate eval-home login on the same account | The owner rejected the additional-login requirement. It is not the selected solution. |
| Whole-home copying, auth-file symlinks or custom token-copy/refresh logic | Not established as a supported solution here. In particular, refresh/write-back behavior cannot be inferred from a file appearing readable. |
| Supplying an OAuth access token as an API key | Not a supported substitute for native saved-login authentication. |

The [advanced Codex CI handoff guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth) concerns copied auth state with serialized write-back and excludes public/open-source repositories. Consumer CI execution is outside this map. That restriction neither establishes a local split-store mechanism nor prohibits ordinary native local login reuse.

## Decision now required

The authentication-policy ticket must decide whether the local runner may use the personal Codex home with explicitly managed eval-only setup, preserving unrelated state and the approved restricted profile. This is different from allowing arbitrary personal-home mutation or exposing its credentials to model tools.

If all eval-owned configuration, plugins and MCP credentials must instead remain outside the personal home, the reviewed runtime lacks the separate auth-store handle needed for the chosen no-additional-login requirement. That combination cannot be marked supported on this evidence. Do not silently substitute API keys or the rejected extra login.

Any selected same-home design still needs separately authorized proof of restricted configuration, exclusion of unrelated plugins/rules/MCP servers, credential visibility, native refresh ownership and cleanup limited to evaluator-owned artifacts. Local entitlement, real login reuse, refresh and model/MCP execution remain unproven.
