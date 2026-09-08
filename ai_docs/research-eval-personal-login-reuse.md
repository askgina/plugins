# Native Codex personal-login reuse and eval configuration

Research date: 2026-09-08. This source-only report resolves [the personal-login separation research question](https://github.com/askgina/plugins/issues/53), not the remaining authentication-policy decision. The owner requires an already-saved personal Codex login with no additional login. No credential store, keyring, authentication command, model call or MCP call was accessed.

## Finding

The reviewed native Codex release, `rust-v0.153.4`, supports caller-supplied `--config` settings and `--ignore-user-config`, which skips personal `config.toml` while retaining authentication through `CODEX_HOME`. This establishes a native configuration/authentication separation mechanism for an SDK-facing adapter. The stock TypeScript SDK supplies configuration overrides but does not expose that ignore flag.

Native storage paths remain coupled to `CODEX_HOME`. No independent auth-store path was established for a different temporary home, but a separate home is not required merely to keep evaluation settings in caller code. This report does not establish separation of every plugin/MCP storage path or exclusion of every ambient configuration layer.

This is not a finding that local personal-login evals are impossible or that eval configuration must be written into the personal home. Native execution against the personal `CODEX_HOME` can reuse its login. The owner subsequently clarified that eval configuration must live at the AI SDK/application level and point to existing local authentication. Independent on-disk roots and programmatically supplied session configuration are different questions.

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
| Native execution using the personal `CODEX_HOME` | Native login reuse exists. Caller-supplied session configuration is distinct from writing an eval profile into that home. Ambient-state exclusion, plugin/MCP setup and credential visibility still require proof. |
| Temporary eval home plus a separate native personal-auth pointer | No such first-class split was established in the pinned source. Do not invent an auth-path flag or assume keyring mode provides it. |
| A separate eval-home login on the same account | The owner rejected the additional-login requirement. It is not the selected solution. |
| Whole-home copying, auth-file symlinks or custom token-copy/refresh logic | Not established as a supported solution here. In particular, refresh/write-back behavior cannot be inferred from a file appearing readable. |
| Supplying an OAuth access token as an API key | Not a supported substitute for native saved-login authentication. |

The [advanced Codex CI handoff guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth) concerns copied auth state with serialized write-back and excludes public/open-source repositories. Consumer CI execution is outside this map. That restriction neither establishes a local split-store mechanism nor prohibits ordinary native local login reuse.

## Owner clarification

The [owner's answer](https://github.com/askgina/plugins/issues/51#issuecomment-5585295249) was: "yo we want configuration to be at the ai sdk level but point to our local auth please thx".

Neither offered personal-home setup option was selected. The chosen requirement is AI SDK/application-owned evaluation configuration referencing the existing native local authentication. The earlier report's framing of eval-profile coexistence versus fully separate storage roots was too narrow. Do not treat that framing as the owner's requirement or as a blocker on SDK/session-supplied settings. Do not write eval settings into personal `config.toml`, mandate another login or substitute API-key auth on this authority.

The exact adapter still needs separately authorized proof of restricted configuration, exclusion of unrelated plugins/rules/MCP servers, credential visibility, native refresh ownership and cleanup limited to evaluator-owned artifacts. Local entitlement, real login reuse, refresh and model/MCP execution remain unproven.

## SDK configuration with native local auth

The follow-up inspected native Codex `rust-v0.153.4` and Vercel AI `6359fd58fe68eaade096b5d923bac26de84ca3bd`. These are distinct source snapshots, not a tested compatible package pair. The reviewed stock Vercel adapter pins an older Codex SDK, so its transitive runtime must not be assumed to expose newer flags.

### Native option flow

The Codex TypeScript SDK accepts `config` and `configOverrides`, serializes them into repeated CLI `--config` arguments, and does not write personal `config.toml`. Thread options supply model, working directory, sandbox policy, network access and web search settings. An explicit `env` replaces inherited process environment; it can retain the existing `CODEX_HOME` for the native process. API-key injection is a separate optional path, not a way to pass saved OAuth tokens. See [SDK options](https://github.com/openai/codex/blob/rust-v0.153.4/sdk/typescript/src/codexOptions.ts), [subprocess construction](https://github.com/openai/codex/blob/rust-v0.153.4/sdk/typescript/src/exec.ts) and [documented override precedence](https://github.com/openai/codex/blob/rust-v0.153.4/sdk/typescript/README.md#passing---config-overrides).

Ordinary overrides are overlays, not removal of ambient settings. Native exec separately exposes `--ignore-user-config`, documented as "Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`." It also exposes `--ignore-rules` for execpolicy rules and `--ephemeral` for session persistence. These flags have separate purposes. In particular, skipping execpolicy rules does not prove that all instructions, skills or project configuration are excluded. See [native flags](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/exec/src/cli.rs) and [loader wiring](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/exec/src/lib.rs).

The reviewed TypeScript SDK does not emit `--ignore-user-config` or expose an option for it. Therefore the native CLI supports the needed personal-config exclusion, but the wrapper is not sufficient unchanged. An SDK-facing local adapter can supply the native flags; that is an implementation boundary, not a completed implementation. The parent independently verified the native flag declaration and SDK documentation.

### Stock Vercel adapter limit

The stock Codex harness does not throw merely because an API key is absent. Its auth resolver returns no key in that case. This corrects the stronger reading of the earlier saved-login report. However, the adapter has no first-class host-local credential-store selector and starts Codex through a sandbox bridge. Base URL, Gateway and header options can also select an API-key provider. Empty auth settings alone do not prove local login reuse. See [auth resolution](https://github.com/vercel/ai/blob/6359fd58fe68eaade096b5d923bac26de84ca3bd/packages/harness-codex/src/codex-auth.ts) and [bridge construction](https://github.com/vercel/ai/blob/6359fd58fe68eaade096b5d923bac26de84ca3bd/packages/harness-codex/src/bridge/index.ts).

That bridge already translates SDK-owned instructions, model and MCP settings into native configuration. Its web search is disabled unless enabled, so the earlier blanket statement that stock Codex web search cannot be disabled was too broad. But the adapter rejects built-in filtering, requires allow-all permission mode, and constructs a danger-full-access native thread. It cannot be declared compliant with the approved restricted baseline unchanged. Its skill materialization also is not installed-plugin activation proof. See [adapter](https://github.com/vercel/ai/blob/6359fd58fe68eaade096b5d923bac26de84ca3bd/packages/harness-codex/src/codex-harness.ts) and the bridge above.

AI SDK's [HarnessV1 contract](https://github.com/vercel/ai/blob/6359fd58fe68eaade096b5d923bac26de84ca3bd/packages/harness/src/v1/harness-v1.ts) provides the native-adapter integration boundary. The source-supported direction is AI SDK-facing configuration translated into native per-run settings and personal-config exclusion, with Codex retaining local auth custody. It is not OAuth extraction into an AI SDK Core provider, a required new login, or permission to mutate personal eval profiles. Implementing the adapter and proving the remaining isolation, plugin and MCP behavior belong to the later cutover plan.
