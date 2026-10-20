# Can Spot MCP run lp-pool-scan

Research for #174, part of #168. Written 2026-10-20.

Sources read:

- t-y-b-b/nextjs-ai-chatbot at `67767a3ffe961189e310993bb3c911f72b72992a`. Paths below without a repo prefix are in this repo.
- askgina/plugins at `0805b519820874c392474bb445610437cded284c`. Paths below starting with `plugins:` are in this repo.

## Answer

No. The Spot MCP `bash` tool cannot run `skills/spot/lp-pool-scan/scripts/lp_pool_scan.py` today, and a Python-free port would still fail on time limits and the network review path.

Three blockers, any one of them enough:

1. The sandbox has no `python3`. The just-bash interpreter only registers Python when constructed with `python: true`, and the app never sets it.
2. One `bash` call runs for at most 120 seconds. The scanner's daily `top` mode takes about 5 to 10 minutes and `wide` about 45 minutes.
3. The scanner's Robinhood Chain RPC reads are JSON-RPC POSTs. The sandbox classifies a POST to `/` as `mutating_external_state`, which has a budget of 10 reviews per hour.

So Spot MCP should serve `lp-rebalancing-playbook` and not `lp-pool-scan`. Ship the scanner in the `ask-gina-spot` package with `mcpServed: false`, for local agents such as Claude Code, Codex and Cursor that have Python and normal network access.

## What the Spot MCP bash tool runs on

The Spot MCP `bash` tool creates an AgentFS sandbox per call through `createAgentFsEffect`, passing the signed-in user id:

- `app/actions/wallet/tools/mcp/sandboxBash/index.ts:1185-1193` calls `createAgentFsEffect({ ..., userId: context.userId, abortSignal })`.

`createAgentFsEffect` builds a just-bash interpreter:

- `lib/ai/sandbox/agentfs-sandbox.ts:7` imports `Bash` from `just-bash`. The app pins `just-bash` 3.4.2 at `package.json:264`.
- `lib/ai/sandbox/agentfs-sandbox.ts:499-509` constructs `new Bash({ fs, cwd: "/workspace", env: { HOME, PATH }, customCommands, defenseInDepth: false, fetch })`. It passes no `python` or `javascript` option.

just-bash only adds the Python commands when asked:

- `node_modules/just-bash/README.md:485-499` says Python is CPython compiled to WASM, opt-in with `python: true`, and that "the `python3` and `python` commands only exist when `python: true` is configured".

The sandbox also tells the model this directly. `lib/ai/sandbox/agentfs-sandbox.ts:675-676` adds the hint "python is unavailable; use awk/sed or ts-exec for scripted edits." whenever a command mentions `python` or `python3`.

The only other `new Bash(` in the app is `lib/effect/services/agentfsBashTool.ts:270-277`, which also sets no `python` option.

Scheduled runs use the same sandbox factory. `lib/automations/workflow/executor.ts:577` and `lib/ai/sandbox/host-tool-session.ts:54-61` both call `createAgentFsEffect`. A scheduled LP review therefore cannot run the scanner either. That answers the script half of the TODO at `plugins:docs/spot-mcp/lp-scheduled-monitoring.mdx:18`.

### ts-exec is not a way around it

`ts-exec` runs TypeScript in a Node `vm` context. Its globals are listed at `lib/ai/sandbox/agentfs/commands.ts:2566-2591`: `console`, `sql`, `sqlQuery`, `kv`, `fs`, `args`, `callHostTool`, `callTool`, `tools`, `flush`, `exec` and workflow fields. There is no `fetch`. `require()` is unsupported, per the warning at `lib/ai/sandbox/agentfs/commands.ts:1409-1410`. A TypeScript port would have to send every HTTP request through `exec("curl ...")`, which lands on the same reviewed network path described below.

## Outbound HTTP from the sandbox

There is no fixed host allowlist. Each request is reviewed.

- `curl` and the custom `wget` exist only when a user id is present. `lib/ai/sandbox/agentfs-sandbox.ts:487-508` wires `makeSandboxSecureFetch({ userId, ... })` as the just-bash `fetch` and adds `wgetCommand`. Without a user, network stays off.
- Reviews use an LLM judge, `BASH_NETWORK_AUTOREVIEW_MODEL_ID = "~google/gemini-flash-latest"` at `lib/ai/sandbox/network-autoreview.ts:156`. A review decision comes from `allowlist`, `llm` or `static` sources, `lib/ai/sandbox/network-autoreview.ts:159`. Judge approvals can be stored as per-user allowlist entries with a TTL, `lib/ai/sandbox/network-autoreview.ts:680-712`.
- Local and private hosts are refused, `lib/ai/sandbox/network-autoreview.ts:1563`.
- Requests get a candidate class at `lib/ai/sandbox/network-autoreview.ts:1161-1189`. GET and HEAD are `public_read`. A POST is `read_via_post` only when the path matches `search`, `query`, `graphql`, `validate`, `preview`, `simulate`, `estimate` or `quote`, `lib/ai/sandbox/network-autoreview.ts:1218-1226`. Any other POST is `mutating_external_state`.

Default limits, from `lib/ai/sandbox/network-autoreview-config.ts:43-71` and `lib/ai/sandbox/network-autoreview.ts:127-154`:

| Limit                                  | Default       |
| -------------------------------------- | ------------- |
| Reviews per user per hour              | 300           |
| Executions per user per hour           | 600           |
| Reviews per host per hour              | 150           |
| Executions per host per hour           | 300           |
| Distinct hosts per day                 | 50            |
| Distinct URLs per day                  | 300           |
| Response size                          | 10,485,760 B  |
| Response bytes per day                 | 250,000,000 B |
| `read_via_post` reviews per hour       | 20            |
| `mutating_external_state` reviews/hour | 10            |
| Mutating attempts per day              | 25            |
| Body requests per host per minute      | 5             |

Time limits:

- The Spot MCP `bash` input accepts `timeoutMs` up to 120,000, `app/actions/wallet/tools/mcp/sandboxBash/index.ts:1036-1041`.
- The default is 60,000 ms, `lib/ai/sandbox/config.ts:21` and `lib/ai/sandbox/config.ts:66-67`.
- Process state does not persist between `bash` calls, per the Spot instructions at `lib/mcp/spot-tool-registry.ts:286`.

## What the scanner needs

From `plugins:skills/spot/lp-pool-scan/scripts/lp_pool_scan.py` and its `SKILL.md`:

- Python 3.9 or later, stdlib only, `plugins:skills/spot/lp-pool-scan/SKILL.md:21`. It imports `urllib.request` and `threading`, `lp_pool_scan.py:11-12` and `lp_pool_scan.py:57`.
- Runtime of about 5 to 10 minutes for `--universe top` and about 45 minutes for `wide`, `plugins:skills/spot/lp-pool-scan/SKILL.md:16-17`.
- Per-host pacing with sleeps, 2.1 seconds between GeckoTerminal calls, `lp_pool_scan.py:52-54`. On HTTP 429 it waits 65 seconds for GeckoTerminal, `lp_pool_scan.py:110`.
- A disk cache, snapshots and reports under `--out`, `lp_pool_scan.py:18-23` and `lp_pool_scan.py:70-76`.
- Robinhood Chain reads as batched JSON-RPC POSTs of up to 40 calls, `lp_pool_scan.py:132-144`. The `http` helper turns any `data` argument into a POST body, `lp_pool_scan.py:96-99`.

Hosts it contacts, ten in total:

| Host                              | Where                        | Method   |
| --------------------------------- | ---------------------------- | -------- |
| `api.geckoterminal.com`           | `lp_pool_scan.py:26`         | GET      |
| `api.dexscreener.com`             | `lp_pool_scan.py:27,583,591` | GET      |
| `api-v3.raydium.io`               | `lp_pool_scan.py:28`         | GET      |
| `rpc.mainnet.chain.robinhood.com` | `lp_pool_scan.py:29`         | POST RPC |
| `api.gopluslabs.io`               | `lp_pool_scan.py:30`         | GET      |
| `api.rugcheck.xyz`                | `lp_pool_scan.py:31`         | GET      |
| `api.robinhood.com`               | `lp_pool_scan.py:480`        | GET      |
| `api.xstocks.fi`                  | `lp_pool_scan.py:487`        | GET      |
| `api.orca.so`                     | `lp_pool_scan.py:675,776`    | GET      |
| `dlmm.datapi.meteora.ag`          | `lp_pool_scan.py:679,779`    | GET      |

`RH_RPC` can be overridden by environment variable, `lp_pool_scan.py:29`.

## Fit, requirement by requirement

| Scanner needs                  | Spot MCP sandbox gives                              | Fits    |
| ------------------------------ | --------------------------------------------------- | ------- |
| `python3`                      | No Python command                                   | No      |
| 5 to 45 minutes in one process | 120 seconds per call, no process state across calls | No      |
| JSON-RPC POSTs to the RPC root | Candidate class `mutating_external_state`, 10/hour  | No      |
| GETs to 9 public hosts         | Reviewed `public_read`, 50 distinct hosts per day   | Yes     |
| Many distinct URLs per run     | 300 distinct URLs per day                           | Unknown |
| Disk cache and snapshots       | AgentFS files under `/workspace`                    | Likely  |

The judge can reclassify a request, so the RPC row describes the candidate class only. I did not measure how many distinct URLs a `top` run fetches, so that row stays unknown.

## Recommendation

1. Spot MCP serves `lp-rebalancing-playbook` through the MCP skills extension, as D3 asks. It is rules and needs only live reads.
2. `plugins/ask-gina-spot/plugin.yaml` lists `lp-pool-scan` with `mcpServed: false`. The skill still ships in the plugin package for local agents.
3. Inside Spot MCP, agents use native reads for live state instead of the scanner. `getLpPositions`, `getPoolState` and `getRecentPoolSwaps` are captured Spot reads, `lib/mcp/spot-tool-registry.ts:290`. `getLpPerformance` and `previewConcentratedPosition` are described at `plugins:docs/spot-mcp/lp-analytics.mdx:24` and `plugins:docs/spot-mcp/lp-analytics.mdx:32`. None of these rank pools across public data, so pool discovery stays a local-agent job.
4. Turning on `python: true` would remove only blocker 1. just-bash calls it extra security surface, `node_modules/just-bash/README.md:485`. That needs its own security review, and the 120-second limit and POST budget would still block `top` and `wide`.
5. Update `plugins:docs/spot-mcp/lp-scheduled-monitoring.mdx:18`. A scheduled run cannot run the scanner script.
