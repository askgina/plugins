# Reusable eval evidence and venue observation gaps

Research for [Research reusable eval evidence and venue observation gaps](https://github.com/askgina/plugins/issues/70), under [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65). Repository evidence is pinned to `6110ddb38a73ba30fa9722d05231b4e7e95a2742`. Public documentation was read on 2026-09-09. This is a source inventory and draft evidence-layer mapping, not an implementation, security audit, policy decision, or new evaluation run. No tests, builds, validation commands, credentials, model calls, or MCP calls were used. The retained OMP investigation was not reopened.

## Question and evidence boundary

The question is what the public evaluator actually observes and grades, and what additional evidence the two venue evaluation layers would need. The two layers are deterministic MCP contract/safety checks and natural-language agent task trials. They are separate evidence classes. A pass in one does not establish a pass in the other.

The existing evaluator can grade recorded Gina Read tool selection, selected argument constraints, and reported completion. It has reusable YAML, replay, aggregate, retained-attempt, and publication contracts. Its current live admission is for the combined Gina Read connection, not the dedicated Spot, Perps, or Predictions MCPs. A passing routing score is not proof that a venue action was authorized, executed, settled, or described accurately. [Contracts][contracts] [Live admission][live-admission] [Grader][grader]

The default live smoke has four cases and three distinct expected tools, plus a no-tool write refusal. It is not a one-tool smoke or a venue acceptance matrix. The larger family YAML has 37 cases and 27 distinct expected Gina Read tools. Neither count is a measured coverage result. [Live smoke][live-smoke] [Family YAML][family-readme]

The main evidence gap is below and beyond the recorded MCP call. The observation schema has no tool-result body, nested invocation records, authorization decision, or before/after account state. It can hold a final answer, but the grader does not evaluate answer grounding. Retained public artifacts remove arguments and final answers as well. [Observation schema][observation] [Grader][grader] [Public result schema][public-result]

Documented facts below come from pinned public source and docs.askgina.ai. Candidate mappings after that are classifications of those facts, not chosen cases or acceptance criteria.

## Source-derived inventory

Counts below describe declared cases and distinct **expected routing names**, not calls observed in a live run. Forbidden-tool mentions do not count as expected tools. Sequences contribute each expected name once to the distinct-name count. Suites overlap, so their counts are not additive coverage.

| Source | Cases or records | Distinct expected tools and evidence boundary |
| --- | ---: | --- |
| `GINA_READ_TOOL_CATALOG` | 30 entries | 3 portfolio, 4 Spot, 14 Perps, 9 Predictions. These are Gina Read names and annotations, not venue execution schemas. [Catalog][catalog] |
| `GINA_CONNECTED_TOOL_NAMES` | 31 names | The 30 reads plus `gina.renderReadOnlyDashboard`. The renderer is not a thirty-first read. [Connected names][connected] |
| `packages/evals/src/fixtures/ask-gina-routing-smoke.yaml` | 4 cases | 3 tools: `gina.listScheduledPrompts`, `spot.getSimplePrice`, `gina.getAccountAddresses`; fourth case expects no call for a buy request. All answers are `not_scored`; no argument requirements. [Source][live-smoke] |
| `packages/evals/src/fixtures/model-smoke.yaml` | 3 cases | One expected tool, `fixture.lookupLabel`, and a no-tool case. The 3 synthetic observations include an intentional wrong `fixture.listLabels` call. [Suite][synthetic-suite] [Observations][synthetic-observations] |
| `plugins/ask-gina/evals/model/v1/smoke.yaml` | 12 cases | 10 expected tools. Separate listed-plugin seed, including an address-to-positions sequence and no-tool cases. Its companion contains 12 synthetic observations and two intentional routing failures. [Suite][plugin-smoke] [Companion][plugin-observations] [Evidence label][family-readme] |
| `plugins/ask-gina/evals/model/v1/activation.yaml` | 25 cases | Skill expectations are separate from routing. Includes education, ambiguity, account/auth prompts, cross-skill boundaries, and write refusal. These are declared tasks, not evidence that their requested conditions occurred. [Source][activation] |
| `families/portfolio.yaml` | 3 cases | 3 expected portfolio tools. [Source][portfolio-family] |
| `families/spot.yaml` | 4 cases | 4 expected Spot read tools. [Source][spot-family] |
| `families/perps.yaml` | 17 cases | 14 expected Perps read tools, including HIP-3 variants and a create-table/query sequence. [Source][perps-family] |
| `families/predictions.yaml` | 13 cases | 6 expected tools. Eight cases route to `predictions.searchPredictionMarkets`, including expiry and recurring-series discovery. [Source][predictions-family] |
| `packages/evals/src/corpus/` | 7 one-case files | 4 positive read expectations and 3 negative cases. This is a different YAML shape from model suites. [Directory][package-corpus] |
| `plugins/ask-gina/evals/` top-level YAML | 7 one-case files | Same positive/negative categories, but not byte-identical to the package corpus. [Directory][plugin-corpus] |

For the four family files, `3 + 4 + 17 + 13 = 37` cases and `3 + 4 + 14 + 6 = 27` distinct expected catalog names. The three catalog names not expected by those family files are `predictions.getExpiringMarkets`, `predictions.getSeriesMarket`, and `predictions.getPredictionMarketDetails`. This is a statement about family routing expectations only. It is not a claim that those capabilities are unavailable or that all other tools have passed. The default smoke expects 3 of the 30 read names, so 27 are not smoke routing targets. A claim of "29/30 uncovered" would use the wrong numerator. [Catalog][catalog] [Family YAML][family-readme]

The seven small corpus files are `positive-spot-read.yaml`, `positive-perps-read.yaml`, `positive-predictions-read.yaml`, `positive-shared-read.yaml`, `negative-unknown-tool.yaml`, `negative-scope-escalation.yaml`, and `negative-read-scope-write.yaml`. The last supplies a `tools/call` request for `bash` under `tools:read` and expects MCP error `-32000`. That is a Gina Read rejection fixture, not successful venue sandbox execution. The unknown-tool fixture expects the same error code for an unavailable tax-report tool. No TypeScript reference to these filenames or to `src/corpus` was found under `packages/evals`. They are declared fixtures, not proven live-grader inputs. [Package corpus][package-corpus] [Read-scope bash fixture][bash-negative]

There is a concrete expectation mismatch: the same "expire this week" prompt expects `predictions.getExpiringMarkets` in the package corpus and `predictions.searchPredictionMarkets` in the plugin corpus. The family expiry case also expects search. The sources establish the mismatch, not which expectation a future venue suite should adopt. [Package expiry][package-expiry] [Plugin expiry][plugin-expiry] [Family expiry][family-expiry]

## Three action locations, two evaluation layers

The action locations below are not the two evaluation layers in [Spot, Perps and Predictions MCP evaluations](https://github.com/askgina/plugins/issues/65). A contract/safety check and an agent task trial can concern the same action location while proving different things.

| Action location | Publicly documented behavior | Current evaluator evidence |
| --- | --- | --- |
| Client-native tools | A client can have its own shell, file reads, skills, or web tools. These are not Gina's remote sandbox. | Native adapters restrict these actions and record skill activation separately from MCP routing. A local `command_execution` is not automatically an MCP `bash` call. [Native runner overview][native-readme] [Codex parsing][codex-parsing] |
| Direct MCP call | Gina Read exposes named reads. Spot documents 23 native tools plus a separate `bash`. | Current live runners target Gina Read's named catalog. They can produce canonical call names, arguments, error summaries, and result byte counts. They do not currently admit the Spot native execution catalog. [Spot boundary][spot-doc] [Live admission][live-admission] |
| MCP `bash` sandbox and nested `host-tools` | Perps and Predictions document one MCP tool, `bash`; commands inside it discover and invoke their allowed host tools. Spot offers its allowlist through both native tools and `bash`. | No current positive venue-bash suite or nested-call observation contract was found in the inspected sources. An outer `bash` request would establish a requested command string, not each executed inner call or its outcome. [Perps docs][perps-doc] [Predictions docs][predictions-doc] [Observation schema][observation] |

The access documentation distinguishes Gina Read at `/ai/gina/mcp` with `tools:read` from the three venue URLs with `tools:execute`. Spot's documented 23 native tools comprise 7 market reads, 5 LONG/Robinhood reads, 3 account-support tools, 3 preparation/execution tools, and 5 scheduling tools. Perps documents market/account reads, order management, leverage/margin, funding, HIP-3, and sandbox SQL workflows. Predictions documents discovery, trading, orders, positions, and advanced workflows. These are documented product capabilities, not measured acceptance results. [Access comparison](https://docs.askgina.ai/mcp-access/index.md) [Spot][spot-doc] [Perps][perps-doc] [Predictions][predictions-doc]

OMP's local Docker runtime and host-side Gina MCP path are another client execution arrangement. They are not the remote venue MCP sandbox. The public README places Gina execution on the host and native OMP in Docker. A host-side Gina read is not evidence that a venue `host-tools` command ran. [Runner boundary][omp-readme]

## Capability and evidence matrix

"Observed" here means a field the adapter can produce from its execution events, not a fresh observation made for this report. Supplied replay YAML can populate the same fields without any live execution.

| Capability | Evidence available to grading | What retained or public evidence establishes | Precise gap |
| --- | --- | --- | --- |
| Direct tool selection and order | `tool_calls[].name` and contiguous zero-based `sequence`; exact, one-of, sequence, or no-tool expectations. | Routing verdict and aggregate counts; optional per-attempt verdict. | Names include failed calls. Correct order does not prove successful effects. [Loader][loader] [Grader][grader] |
| Direct call arguments | JSON argument object; required subset, forbidden paths, optional exact equality. Grader chooses the first call or first matching named tool. | Argument verdict, not retained argument values. | No general per-step constraints or binding to values returned by earlier calls. No argument expectation means a pass without checking argument correctness. [Grader][grader] |
| Result contents | Adapters see MCP output but reduce it to optional byte count and error summary for the observation. | Counts/diagnostics and completion verdict. | No result-body or `structuredContent` field for independent semantic checking. Byte count is not result fidelity. [Responses extraction][responses-calls] [OpenRouter extraction][openrouter-calls] |
| Nested host-tool selection and arguments | No nested call kind, parent-call relation, or inner argument/result record. | No independent nested execution claim. | Parsing an outer command string would describe intent only; it does not show which commands actually executed, were denied, or partly completed. [Observation schema][observation] |
| Authorization and forbidden actions | Forbidden names and optional `requested_scope`. Native Codex/Claude stamp the read scope; other adapters need not supply it. | A scope/name check summary where evaluated. | Requested scope is not the granted scope or server authorization decision. No account-bound authorization receipt. [Grader][grader] [Native call extraction][native-calls] |
| No-tool refusal | Empty MCP call list can pass routing `none`. | No recorded MCP call in that observation. | It does not independently establish refusal wording or absence of every external side effect. A forbidden-scope check with no calls is unscored. [Grader][grader] |
| Answer grounding | Optional `final_answer`; YAML permits `grounded`, `manual`, `not_scored`. | Public `answerAccuracy` is unavailable-only; public artifacts exclude final answers. | The grader never reads `expected.answer` or compares claims to result facts. [Contracts][contracts] [Grader][grader] [Public result schema][public-result] |
| State and side effects | Tool names and arguments can describe a requested preparation, query, or action. | No financial-outcome claim in the public result contract. | No before/after state, settlement, balances, order lifecycle, schedule lifecycle, or proof that a prohibited change did not occur. [Observation schema][observation] [Public contract][public-reference] |
| Tool failure and incomplete generation | Optional call error and trial status/error; any recorded call error fails completion. | `trial_or_tool_failure`, separate failed attempts, aggregate failed counts. | Some runner errors occur before an observation exists. An absent report is not a retained failed-attempt record. [Grader][grader] [Responses completion][responses-completion] [OpenRouter completion][openrouter-completion] |
| Partial domain outcome | Observation status supports completed, failed, blocked; no domain-specific partial-result structure. | Binary conformance verdicts. | Partial fill, pending settlement, empty valid result, provider-unavailable result, and partial account coverage have no distinct graded result semantics. [Observation schema][observation] [Attempt schema][attempt-schema] |
| Skill activation | Separate optional `activated_skills`; exact/none grading only when expectation and observation both exist. | Separate activation dimension, sometimes not applicable. | Metadata loaded or a correct MCP route is not activation. Adapter evidence is not uniform, as described below. [Grader][grader] [Native runner overview][native-readme] |
| Performance | Trial duration, optional token counts, sum of available result bytes. | Latency/token samples and diagnostic distributions. | YAML performance limits are not pass/fail predicates. Missing result bytes contribute zero to the current sum; that is not proof of zero-byte output. [Grader][grader] |
| Provenance | Run/suite/catalog identity, settings labels, exact report/capture hashes, optional configuration identity. | Identifies declared inputs and saved artifact bytes. | A digest does not independently attest the actual model, venue state, authorization, or execution. [Public reference][public-reference] [Configuration reference][configuration-reference] |

The family table-then-query case illustrates the limits without inventing a new scenario. It asks for use of the exact returned `tableName`, but declares only the two-name routing sequence. The generic argument grader has no cross-call result reference. Therefore a routing pass does not establish correct table-name reuse, actual table creation, or accurate SQL results. [Case][table-sequence] [Grader][grader]

Spot's public documentation already distinguishes a landed receipt from submitted/pending and quote estimates. The Product Guide states that missing provider data is not a zero balance and a transaction hash does not guarantee finality. The current observation and grader contracts cannot independently check those distinctions. This is an evidence gap, not a proposed execution or retry policy. [Spot outcomes][spot-doc] [Transactions and portfolio](https://docs.askgina.ai/product-guide/transactions-and-portfolio.md)

## Live admission and runner-specific limits

The reusable live loop admits expected routing names only from `isGinaReadToolName`, records the compiled catalog as `allowed_tools`, accepts 3 to 5 repetitions and at most 64 selected cases, and rejects anything except one user turn per case. Thus the schema can describe multi-turn cases that this live loop cannot execute. A multi-call sequence inside one user turn is different and is not rejected on that basis. [Admission][live-admission] [Selection][live-selection] [Manifest][live-manifest]

The production URL constant is Gina Read. Responses validates that exact URL and full allowed-tool catalog, then compares imported MCP names with the allowed list. These are Gina Read admission checks, not a generic venue URL override or a dedicated venue discovery check. The public catalog contract supplies names, family, and annotations; it does not supply venue input/output/state schemas. [Catalog][catalog] [Responses request][responses-request] [Responses completion][responses-completion]

| Runner evidence source | Distinct behavior relevant to reuse |
| --- | --- |
| OpenAI Responses | OpenAI-hosted `mcp_call` events supply names and argument JSON. Output becomes byte count; call failure becomes a generic error. Non-completed Responses payloads return a runner error rather than a failed observation. No native skill activation claim follows. [Call extraction][responses-calls] [Completion][responses-completion] |
| OpenRouter | Local AI SDK MCP calls are mapped back to canonical names. Missing result, invalid arguments, tool errors, and MCP `isError` are represented. If generation returns without a stop/nonempty answer, the adapter can return a failed observation with its calls. This does not mean every transport exception is retained. [Call extraction][openrouter-calls] [Completion][openrouter-completion] |
| Native Codex | MCP calls enter routing; recognized plugin-file reads enter activation separately. The parser adds a matching skill read before checking event completion or success, so this evidence is weaker than a guaranteed successful read. Other completed unsupported actions produce a failure. [Parsing][codex-parsing] |
| Native Claude | Skill/Read are separate from MCP calls; Bash is disallowed in the configured profile. Successful Skill/Read results supply activation. The public README says live Claude activation remains unverified. [Adapter][claude-activation] [Runner claims][native-readme] |
| Native OMP | Native ACP runs in local Docker; Gina MCP calls execute on the host. Successful native skill-read evidence is separate from task conformance. The README explicitly says synthetic runtime fixtures do not establish measured activation or production Gina connectivity. [Boundary and claim limits][omp-readme] |

Scope grading has a material interpretation limit. A recorded forbidden name or scope fails. But if a forbidden-scope constraint exists and there are no calls, or any call lacks `requested_scope`, the dimension is omitted unless an explicit violation was already found. Omitted safety and activation dimensions do not make the overall verdict fail. Even the smoke's no-tool buy refusal can therefore pass routing and overall conformance without a scored scope dimension. This is the current predicate, not authorization evidence or an authored safety policy. [Grader][grader]

Completion is binary: non-completed status or any recorded tool error fails. Earlier failed calls remain in the call list even if a later call succeeds, so routing and completion do not erase them. In contrast, a runner error before returning an observation interrupts the live loop. Sanitized replay requires complete coverage. The public incomplete-coverage DTO does not make that loop a partial-run capture mechanism. [Live loop][live-manifest] [Grader][grader] [Complete coverage gate][report-gate] [Public coverage contract][public-reference]

## Reusable YAML, capture, and provenance contracts

| Contract | Reusable content | Bounds and claim limits |
| --- | --- | --- |
| Suite v1 | Case identity/category/tags, user/assistant turns, expected routing, arguments, safety, skill, answer labels and performance declarations. | Some declarations are not scored; live selection is narrower than the schema. [Contracts][contracts] [Selection][live-selection] |
| Observation set v1 | Run manifest, model/target/case/repetition identity, ordered calls, status/error, optional catalog, activation, answer, and usage. | Loader checks duplicate attempts, manifest identity, status/error consistency and contiguous sequence. These checks establish record consistency, not authenticity of supplied YAML. [Observation][observation] [Loader][loader] |
| Replay and aggregate | Same deterministic rubric for supplied observations; counts, latency, bytes, token observations. | Sanitized aggregate requires complete replay coverage. No result payload or answer accuracy grade. [Grader][grader] [Aggregate][report-gate] |
| Opt-in attempt capture | Canonical `attempt-` hash of the run/case/repetition JSON tuple; per-check verdicts, bounded failure categories, duration and available token counts. | Exact saved-report-byte SHA-256 binding, exclusive mode `0600`; no raw observations or grader detail. Maximum 5,000 attempts. `available` means retained summaries, not verified financial evidence. [Attempt schema][attempt-schema] [Capture behavior][capture-readme] |
| Public result v1 | Synthetic/measured origin, benchmark identity, declared configuration identity, coverage and evidence availability, aggregate or retained attempt detail. | All results measure conformance and are unranked. Answer accuracy, USD cost and uncertainty are unavailable-only. Identifiers/models at most 128 characters; public indexes at most 1,000 publications. [Schema][public-result] [Bounds][public-bounds] |
| Public export | Independent expected suite/fixture/catalog provenance, report/capture byte hashes, optional component hashes, existing manual-review record and immutable revision relationships. | Declaration and byte integrity are not execution attestation. Synthetic preview and measured publication remain separate. This report adds no publication or configuration policy. [Public reference][public-reference] [Exporter reference][configuration-reference] |

Live output defaults to one sanitized aggregate, with retained attempt summaries only when requested. Raw prompts, final answers, arguments, provider payloads and child output are not persisted by that live path. Consequently an exported argument or completion verdict cannot be independently regraded from the export alone. [Retention][retention]

Repository source revision, catalog identity and suite label are separate identities. For example, `packages/contracts/src/index.ts` defines a `catalogSha`, while suites carry `catalog_version` strings. Neither label alone is a hash of venue state or a whole-run attestation. The existing configuration declaration hashes evaluator, skills, toolchain and run-settings records, but its reference explicitly describes a declaration rather than proof of the provider actually used. [Catalog identity][catalog-identity] [Configuration declaration][configuration-reference]

## Controlled fixtures, recordings, and live evidence

- Controlled synthetic observations are available in both smoke fixture sets. They deliberately include wrong-tool cases and establish repeatable grader inputs. The public handoff records a prior compiled synthetic replay with 2 passes out of 3; its successful exit meant replay/persistence succeeded, not an all-pass benchmark. This report did not rerun it. [Synthetic inputs][synthetic-observations] [Documented synthetic proof][handoff]
- Recorded observations can reuse the observation-set contract, including target labels for ChatGPT or browser replay. A target label does not itself supply a recorder or establish that a native product action happened. The schema retains call arguments and optional answer text, not full tool responses or nested venue events. [Targets and observation contract][observation]
- Live adapters exist for Responses, OpenRouter, Codex, Claude, and OMP. Source availability and synthetic native-runtime proof are not measured venue acceptance. The public handoff separately records missing authorized measured aggregate/new-run detail at that checkpoint. That historical statement is not a claim that no measured run has ever occurred. [Runner overview][native-readme] [Handoff limits][handoff-limits]
- A checked-in historical production baseline is documented for earlier 40/38/33-tool configurations. It is not a clean current 30-tool comparison or venue execution evidence. [Historical baseline description][baseline]

## Draft mapping to the two evaluation layers

This mapping classifies existing public YAML against the two layers. It does not choose scenarios, score weights, budgets, permissions, authentication, or publication rules. Corpus rows are declared fixtures. The live-grader rows use the observation and grading contracts cited above.

| Candidate from existing public YAML | Layer it most resembles | Current evidence | Missing for dedicated venue use |
| --- | --- | --- | --- |
| Corpus positive read (`spot.getSimplePrice`, `perps.getHyperliquidPositions`, expiry prompt, `gina.getAccountAddresses`) | Contract/safety check | Expected Gina Read name and `tools:read` outcome in a one-case fixture | Venue URL, `tools:execute` catalog, native Spot names or nested `host-tools` command, result/state oracle |
| Corpus unknown-tool and read-scope `bash` refusal | Contract/safety check | Expected MCP error `-32000` under Gina Read | Proof of the same refusal or allowlist on a dedicated venue server; nested-command outcome |
| Corpus requested `tools:execute` vs plugin `tools:read` | Contract/safety check | Expected `scope_rejected` label | Recorded granted scope, account class, or authorization receipt |
| Live smoke price/account/schedule routing | Agent task trial | Exact Gina Read tool and skill names; answers not scored | Result contents, account freshness, dedicated venue connection |
| Live smoke "buy BTC" refusal | Agent task trial | Expected no MCP call and forbidden `tools:execute`; scope dimension may be omitted | Independent proof that no write occurred; venue write-intent handling under execute access |
| Family confusion pairs and HIP-3 argument cases | Agent task trial | Exact or forbidden Gina Read names and some required arguments | Nested sandbox equivalents, result grounding, provider-context success |
| Family table-then-query sequence | Agent task trial | Two-name routing sequence only | Binding to returned `tableName`, table existence, SQL result correctness |
| Activation write-refusal and education/no-skill cases | Agent task trial | Separate skill and routing expectations | Uniform activation evidence across runners; answer review method |

| Evaluation layer | Existing material that maps to it | Evidence not supplied by current contracts |
| --- | --- | --- |
| Deterministic MCP contract/safety checks | Small positive/negative JSON-RPC/prompt corpus, consistent observation loading, exact routing/argument predicates, explicit error handling, byte-bound artifacts and report provenance. These can describe controlled expectations. | Dedicated venue URL/catalog/input/output contracts bound to a run; authoritative nested-call outcomes; actual authorization decisions; before/after state; denied-action no-change proof; empty, pending, partial and failed domain outcomes. |
| Natural-language agent task trials | Smoke, family and activation prompts; identified target/model/repetitions; direct-call sequence/argument observations; separate task and activation verdicts; aggregate and attempt summaries. | Answer-to-result grounding; fresh/complete account context; dynamic cross-call identifier reuse; evidence that the agent distinguishes preparation, submission and settlement; durable observation of nested sandbox workflows and partially completed tasks. |

## Open owner decisions

Model, authentication, isolation, and pinned comparison identity remain on existing issues [Specify cross-provider result identity and evidence semantics](https://github.com/askgina/plugins/issues/49) and [Choose runner authentication and isolation policy](https://github.com/askgina/plugins/issues/51). This inventory does not answer them. Safety-mode, grading, admission, and acceptance decisions remain open; the owner has already selected all three dedicated MCPs and two evaluation layers. No weights, budgets, or publication rules are chosen here.

The remaining unknowns are specific:

1. Whether each deployed venue's advertised native tools and sandbox allowlist match the public documentation. No venue was contacted.
2. What public, bounded record can independently show inner host-tool name, actual arguments, result, authorization decision and parent MCP call. None is defined by observation v1.
3. What authoritative state/result evidence distinguishes no-op, denied, prepared, submitted, pending, partially filled, settled, empty and unavailable outcomes for each venue capability. The public product descriptions are not evaluation fixtures.
4. What retained evidence and declared method would permit answer-grounding checks. `answer: grounded` currently supplies neither.
5. How a failed trial that never produces an observation would appear in a complete retained cohort. Current aggregate coverage rules do not resolve that gap.
6. Which interpretation resolves the two expiry corpus expectations. Their difference is visible at the pinned revision and remains unmodified here.

The existing artifacts support reuse of evaluation inputs and conformance reporting. They do not yet supply dedicated venue acceptance evidence or independent proof of work inside an MCP bash sandbox.

## Source list

[contracts]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/contracts.ts#L20-L135
[observation]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/contracts.ts#L20-L175
[grader]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/grading.ts#L81-L262
[loader]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/load-observations.ts#L64-L108
[live-admission]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/live.ts#L34-L92
[live-selection]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/live.ts#L149-L166
[live-manifest]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/live.ts#L186-L240
[catalog]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/contracts/src/index.ts#L5-L267
[connected]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/contracts/src/index.ts#L269-L331
[catalog-identity]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/contracts/src/index.ts#L388-L390
[live-smoke]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/fixtures/ask-gina-routing-smoke.yaml#L1-L74
[synthetic-suite]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/fixtures/model-smoke.yaml
[synthetic-observations]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/fixtures/synthetic-observations.yaml
[plugin-smoke]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/smoke.yaml
[plugin-observations]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/fixtures/synthetic-observations.yaml
[activation]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/activation.yaml
[family-readme]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/README.md#L22-L54
[portfolio-family]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/families/portfolio.yaml
[spot-family]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/families/spot.yaml
[perps-family]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/families/perps.yaml
[predictions-family]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/families/predictions.yaml
[package-corpus]: https://github.com/askgina/plugins/tree/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/corpus
[plugin-corpus]: https://github.com/askgina/plugins/tree/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals
[bash-negative]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/corpus/negative-read-scope-write.yaml
[package-expiry]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/corpus/positive-predictions-read.yaml
[plugin-expiry]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/positive-predictions-read.yaml
[family-expiry]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/families/predictions.yaml#L161-L209
[table-sequence]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/families/perps.yaml#L346-L365
[spot-doc]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/docs/spot-mcp/features.mdx#L6-L66
[perps-doc]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/docs/perps-mcp/introduction.mdx#L6-L33
[predictions-doc]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/docs/predictions-mcp/introduction.mdx#L6-L35
[native-readme]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/README.md#L179-L211
[omp-readme]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/README.md#L213-L259
[responses-calls]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/responses-api.ts#L160-L212
[responses-request]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/responses-api.ts#L234-L268
[responses-completion]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/responses-api.ts#L338-L394
[openrouter-calls]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/openrouter.ts#L261-L325
[openrouter-completion]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/openrouter.ts#L562-L581
[codex-parsing]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/codex-cli.ts#L671-L725
[native-calls]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/codex-cli.ts#L616-L654
[claude-activation]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/claude-cli.ts#L831-L881
[report-gate]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/src/report.ts#L100-L146
[attempt-schema]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/contracts/src/eval-results.ts#L179-L265
[public-result]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/contracts/src/eval-results.ts#L328-L409
[public-bounds]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/contracts/src/eval-results.ts#L16-L89
[capture-readme]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/README.md#L27-L64
[retention]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/packages/evals/README.md#L261-L266
[public-reference]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/ai_docs/evals-handoff/planning/PUBLIC_CONTRACT.md#L15-L86
[configuration-reference]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/ai_docs/evals-handoff/planning/EXPORTER_REFERENCE.md#L65-L79
[handoff]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/ai_docs/evals-handoff/HANDOFF.md#L28-L43
[handoff-limits]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/ai_docs/evals-handoff/HANDOFF.md#L71-L73
[baseline]: https://github.com/askgina/plugins/blob/6110ddb38a73ba30fa9722d05231b4e7e95a2742/plugins/ask-gina/evals/model/v1/README.md#L69-L75
