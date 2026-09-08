# Saved-login authentication and isolation

Research date: 2026-09-08. This report answers ticket #52 from primary documentation and versioned source. It does not choose the evaluator policy. No credential store, login command, model call, or MCP call was used. Runtime and event fidelity belong to the sibling SDK/runtime report.

## Result

"Existing login" is product-specific. A native Codex run can reuse a Codex ChatGPT login; native Claude Code can reuse its own login; native Pi can reuse a Pi login. None of those facts authorizes reading a token from one product and presenting it to another API as a key. Gina MCP authorization is independent in every case.

| Path | Saved login | Isolation result | Status |
| --- | --- | --- | --- |
| Native Codex CLI 0.153.4 | Codex ChatGPT OAuth | Supported through its credential store. An isolated `CODEX_HOME` needs a supported `auth.json` handoff and serialized refresh write-back. | **SUPPORTED, with mutable-store custody** |
| Codex SDK 0.153.4 | Same local Codex runtime, but automation docs name `CODEX_API_KEY` | No documented constructor or environment contract for selectively borrowing a saved login. | **UNKNOWN** pending an authorized SDK smoke |
| Native Claude Code 2.1.263 | Claude Code login | A different `CLAUDE_CONFIG_DIR` selects a different file and macOS Keychain entry. No documented selective copy/import path exists. | **SUPPORTED only by sharing the store; isolated reuse UNKNOWN** |
| Claude Agent SDK 0.3.263 | Claude Code credentials are part of the spawned CLI environment | Anthropic tells third-party products to use API-key methods unless approved for claude.ai login. | **UNSUPPORTED for unapproved third-party saved-login use** |
| Native Pi 0.85.1 | Pi's own OAuth store | `PI_CODING_AGENT_DIR` relocates the whole home; SDK `authPath` can select a dedicated auth file. Both are writable for OAuth refresh. | **SUPPORTED, with mutable-store custody** |
| AI SDK Harness Codex 1.0.104 | None in adapter contract | API key or AI Gateway variables only. | **UNSUPPORTED** |
| AI SDK Harness Claude Code 1.0.106 | None in adapter contract | API key, bearer, Gateway, or host `apiKeyHelper`; no saved OAuth store. | **UNSUPPORTED** |
| AI SDK Harness Pi 1.0.104 | Pi login via `agentDir` | Runs Pi in the host process and reads the named home's auth, models, and settings. | **SUPPORTED, but not credential-isolated** |

## Current Ask Gina boundary

At baseline `ff235a4`, `live.ts` unconditionally loads non-empty `ASK_GINA_ACCESS_TOKEN` and `OPENAI_API_KEY` after setting up either runner. The Codex trial then receives that API key. This guard is why a valid saved Codex login cannot currently start a run. It is not a failed OAuth attempt. [[Ask Gina preflight](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/bin/live.ts#L579-L608)]

The launcher otherwise has a strong isolation contract. It creates a scoped temporary `CODEX_HOME` and work directory, installs and checks the plugin there, seeds only Gina's MCP credential in that temporary home, and launches an attested executable with `extendEnv: false`. The trial denies reads from `CODEX_HOME`, strips home/XDG variables from the model-callable shell, excludes `OPENAI_API_KEY` there, disables shell network and web search, and removes the temporary tree when the Effect scope closes. [[runtime setup](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/bin/live.ts#L285-L368)] [[trial command](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/codex-cli.ts#L485-L516)] [[child environment](https://github.com/askgina/plugins/blob/ff235a40e9063a3cc6d9846ad7e7c1f3f01a76a6/packages/evals/src/codex-cli.ts#L756-L833)]

Any saved-login design must preserve those boundaries. Model auth must not enter the model-callable shell. Gina's bearer must remain only in its separate temporary MCP credential store, never as provider auth.

## Native products

### Codex

The version pin is Codex CLI `0.153.4`, tag `rust-v0.153.4`, commit `3d2ee51`. Codex supports ChatGPT OAuth and Platform API keys as different auth modes. `codex exec` reuses the saved CLI login. `CODEX_HOME`, default `~/.codex`, contains auth, config, sessions, logs, skills, and plugins. File storage uses `$CODEX_HOME/auth.json`; keyring storage keys its entry to the canonical home. Codex owns refresh and writes refreshed tokens back. [[release](https://github.com/openai/codex/releases/tag/rust-v0.153.4)] [[auth storage](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/login/src/auth/storage.rs)] [[auth manager](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/login/src/auth/manager.rs)]

OpenAI documents one supported handoff for trusted private CI: create file-backed `auth.json` with Codex, restore it to the runner, run Codex normally, then persist the refreshed file. Jobs sharing it must be serialized. This is a credential copy and mutable write-back arrangement, not a read-only mount. It is the only source-backed route here that combines an existing ChatGPT login with a separate `CODEX_HOME`. [[CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth)]

**UNSUPPORTED:** extracting `tokens.access_token` and supplying it as `OPENAI_API_KEY`, `CODEX_API_KEY`, or `--with-api-key`. Codex's source returns no API key for ChatGPT auth. `--with-access-token` accepts supported enterprise Codex access tokens, not arbitrary browser-session extraction. [[manager](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/login/src/auth/manager.rs)] [[access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)]

**UNKNOWN:** the operator's active file-versus-keyring mode, account entitlement at run time, device-flow availability, and whether the TypeScript SDK inherits a file-backed saved login in the proposed sandbox. Source inspection cannot settle those deployment facts.

### Claude Code

The version pin is CLI `2.1.263`; its public repository publishes docs and changelog, not the implementation. Claude Code stores credentials in macOS Keychain or `.credentials.json` under `~/.claude`, with mode `0600` on Linux. `CLAUDE_CONFIG_DIR` relocates the file and keys the macOS Keychain entry to that directory. Claude Code owns `/login`, `/logout`, expiry handling, and refresh. [[authentication](https://code.claude.com/docs/en/authentication)] [[2.1.263 changelog](https://github.com/anthropics/claude-code/blob/ab9b2cf7bb9e4f98ff264c07a22e46d83c29c558/CHANGELOG.md)]

A native process pointed at the personal config directory can reuse the login, but it receives mutable credentials plus settings and history. A fresh config directory is isolated but has no existing login. Anthropic documents `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN` for automation, but that mints a separate token; it is not extraction or reuse of `.credentials.json`. Copying the credential file or Keychain item into a new home has no first-party support contract, so isolated saved-login handoff is **UNKNOWN**.

The Agent SDK spawns a Claude CLI subprocess. Its hosting guide requires per-tenant `CLAUDE_CONFIG_DIR`, working directory, settings isolation, and egress rules. Anthropic also says third-party Agent SDK products may not offer claude.ai login or rate limits unless approved and should use API-key authentication. [[SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting#multi-tenant-isolation)] [[SDK policy](https://code.claude.com/docs/en/agent-sdk/overview#get-started)]

### Pi

The version pin is `@earendil-works/pi-coding-agent` `0.85.1`, commit `d981de12`. Pi supports its own ChatGPT Plus/Pro and Claude Pro/Max OAuth logins. It stores tokens in `~/.pi/agent/auth.json`, refreshes them when expired, and clears them with `/logout`. `PI_CODING_AGENT_DIR` moves the whole home. Pi has no built-in sandbox; host or container isolation is required. [[providers](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/providers.md)] [[environment](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/environment-variables.md)] [[security](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/security.md)]

The native SDK supports `ModelRuntime.create({ authPath, modelsPath })`, so a dedicated Pi auth file is a supported location. The file backend locks and rewrites that file on credential modification; it is not read-only during OAuth refresh. [[SDK example](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/sdk/09-api-keys-and-oauth.ts)] [[auth storage](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/auth-storage.ts)]

**UNSUPPORTED:** treating Pi's saved OAuth blob as an API key, or claiming `--session-dir` isolates credentials. **UNKNOWN:** whether a read-only credential store can complete an actual turn when refresh is needed. No credential-bearing check was run.

## AI SDK HarnessAgent adapters

These experimental adapters are pinned to Vercel AI commit `c3c189c`. The Codex adapter resolves only API key/Gateway inputs and forwards `CODEX_API_KEY` into its sandbox bridge. It has no `CODEX_HOME`, saved-store, or `CODEX_ACCESS_TOKEN` setting. [[Codex auth source](https://github.com/vercel/ai/blob/c3c189c068baefe62808b4eca5432fe092dc37cb/packages/harness-codex/src/codex-auth.ts)]

The Claude adapter resolves API key, bearer, Gateway, and base URL values. In default auto mode it may read `~/.claude/settings.json` and execute `apiKeyHelper` in the host process. An explicit authentication record stops ambient discovery, but saved Claude OAuth is still absent. The credential-forwarding callback controls what enters the sandbox, not what the host adapter may discover. [[Claude auth source](https://github.com/vercel/ai/blob/c3c189c068baefe62808b4eca5432fe092dc37cb/packages/harness-claude-code/src/claude-code-auth.ts)] [[adapter docs](https://ai-sdk.dev/providers/ai-sdk-harnesses/claude-code#adapter-settings)]

The Pi adapter is different. `createPi({ agentDir })` explicitly reuses a Pi CLI home, while Pi itself runs in the host Node process and only filesystem/shell operations use the sandbox. The adapter disables filesystem extension discovery, but reads auth, models, and settings from `agentDir`; OAuth refresh can write there. Omitting `agentDir` creates and deletes a temporary host directory but loses saved-login reuse. [[Pi harness source](https://github.com/vercel/ai/blob/c3c189c068baefe62808b4eca5432fe092dc37cb/packages/harness-pi/src/pi-harness.ts)] [[Pi session source](https://github.com/vercel/ai/blob/c3c189c068baefe62808b4eca5432fe092dc37cb/packages/harness-pi/src/pi-session.ts)]

## Separately authorized verification

Source research does not prove any live login, entitlement, refresh, endpoint, or evaluator acceptance. A future authorization should name one versioned executable and one credential custodian, then permit only this sequence:

1. Prepare a private, evaluator-only credential store through the product's supported handoff. Never read or print its contents in the harness.
2. Run a secret-free status/preflight that reports only auth mode and selected endpoint. Fail on fallback, missing isolation, or provider mismatch.
3. Execute one bounded model-only trial with Gina disabled, then one read-only Gina trial using a separately issued Gina credential. Record only sanitized mode, version, endpoint class, exit class, and tool evidence.
4. Confirm refresh write-back went only to the designated store, destroy temporary homes/sandboxes, and revoke or retire any copied or newly minted credential according to its owner's procedure.

Until that explicit authorization and proof exist, all live compatibility and entitlement claims remain **UNKNOWN**.