# Native cost estimates — 2026-09-18

The sweep assigned every run `pricing: null`, so the leaderboard could not
derive prices from its legacy rate table. Retained native usage provides enough
evidence to estimate costs for all 35 configurations without changing any grade.

The user explicitly authorized including the aggregate cost records in the
public eval bundle, requested costs for every model, and authorized commit/push
on September 18. This followed an automatic review rejection of public inclusion
without explicit approval. No chat content or credentials are included.

## Method and coverage

The separate `native-cost-estimates.json` contains 105 family aggregates covering
all 2,930 graded attempts. Completed attempts with failing grades are included;
745 timeouts/runtime failures remain excluded. An empty completed population
contributes zero samples, never a displayed zero-dollar task.

- OMP: sum the native assistant messages' `usage.cost` components, including
  cache reads/writes. These are client-recorded estimates, not verified invoices.
- Devin Gemini: apply the selected variant's retained model catalogue rates to
  native final metrics. Rates per million: $0.75 uncached input, $0.08 cached
  input, $3.75 output. Inclusive input is reduced by cached input before pricing.
- Devin SWE-2: the retained selected variants explicitly say `cost_tier: Free`.
  The displayed $0 applies to that model tier; it excludes subscription fees.
- Muse Spark 1.3: apply the [official Meta standard API rate card](https://dev.meta.ai/docs/pricing-rate-limits),
  checked September 18, to native `model_completed` usage: $1.25 per million
  uncached input, $0.15 cached input, $4.25 output. This is an API-equivalent
  token estimate, not the Muse Code subscription charge. Reasoning is already
  included in output usage and is not added a second time. Native cache writes
  are checked to be zero. The contributor SKU is not substituted.

Older campaigns retain their existing labelled price derivations. These estimates
cover model tokens, not tools, infrastructure, subscriptions, or total campaign
spend. Every displayed estimate includes its sample count and excluded attempts.

## Evidence checks and reproduction

`tools/project-eval-native-costs.py` checks each original summary's SHA-256 against
the published row. Included terminal records must match public attempt identity,
model, target, token counts, and grade. The summed native input/output must match
each observation. Native model identities and unique message/event IDs are checked.
OMP costs must be finite, nonnegative, and reconcile to their components; nonzero
usage at an unknown zero rate is rejected. Devin rates require the exact selected
variant. A zero-dollar nonempty population requires the catalogue's explicit Free
tier. Family sample counts must equal published graded counts. A mismatch aborts
generation instead of silently dropping evidence or substituting a price.

```sh
python3 tools/project-eval-native-costs.py \
  --source-root <retained-publication>/derived \
  --output apps/evals/src/results/2026-09-16/reasoning-sweep/native-cost-estimates.json
python3 -B tools/test_project_eval_native_costs.py
```

## Privacy review

Reviewed the generator's output construction and the full projection's field
allowlist. Records contain only already-public model/row/family/target identities,
dates, numeric cost/token/cache counts, fixed method/source labels, rate cards,
the public Meta pricing URL, and SHA-256 provenance digests. The evidence digest
hashes a sorted list of attempt identity plus source terminal/native file hashes;
that underlying list remains private. No message, answer, tool payload, session
ID, credential, provider payload, or local path is copied.

The exact field allowlist is tested, and the public-artifact scanner remains
enabled. Browser ingestion binds every aggregate back to its current model,
target, source summary, and completed sample count. Original results and raw
native evidence are unchanged.

Reviewed projection SHA-256:
`ce34869373a72390ca458c721f201ebcb14180e789be9f19095ca301063d8c6a`.
Only this new exact artifact is added to the existing allowlist.
