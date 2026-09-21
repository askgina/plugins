# Recovery publication — 21 September 2026

Frozen source snapshot: **2026-09-21 09:55:28 UTC** (10:55 BST). This is a
publication snapshot, not a live supervisor status feed.

| Provider/settings                    | Planned | Graded | Passed | Failed | Execution gaps |
| ------------------------------------ | ------: | -----: | -----: | -----: | -------------: |
| Astra xhigh, max                     |     210 |    210 |    108 |    102 |              0 |
| Muse minimal, low, medium, high, max |     525 |    525 |    296 |    229 |              0 |
| Grok low, medium, high, xhigh        |     420 |    383 |    239 |    144 |             37 |
| Total                                |   1,155 |  1,118 |    643 |    475 |             37 |

Astra low/medium/high remain fully graded in the original September 16 campaign.
Grok low is complete; medium has seven gaps and high/xhigh have 15 each. Of the
remaining 37 gaps, seven are timeouts and 30 are interrupted/failed executions.
Incomplete settings retain their counts and individual evidence without an
Overall quality rank.

## Result selection and comparability

The original sweep files and grades remain unchanged. Recovery is a separate
campaign with 33 family runs and 11 settings. Existing completed grades,
including failures, are final; only execution gaps are retried, and the first
completed grade is selected. Astra contributes 210 selected VM results. Muse
retains 316 baseline grades plus 209 recovered grades; Grok retains 282 baseline
grades plus 101 recovered grades. The new campaign is a reconciled result set,
not 1,118 additional independent trials.

Recovery combines retained 120-second trials and retries with 120/300/600-second
budgets. Cohort identity includes the recovery protocol; it cannot silently
compare as the original fixed-budget sweep. Rows show recorded budgets and chat
shows each execution's budget and outcome. Start timestamps come from retained
VM dispatch records (or the original run for an entirely retained setting).

100% graded does not mean 100% passed. Grades measure tool-use conformance, not
answer quality. Overall weights Spot, Perps, and Predictions equally, rather
than pooling their different task counts into one pass fraction.

## Public evidence and costs

The publication adds 689 public transcript documents for selected VM attempts
and closed failed retries. The original 3,675 transcript bytes are unchanged;
the combined hash-bound index contains 4,364 documents. Of the new captures,
520 are complete and 169 explicitly retain capture/execution gaps. Missing
messages are not reconstructed. Public messages, tool calls, tool results, and
recorded inputs are available through Leaderboard → Chat and Tasks. Execution
history selects earlier failures; Expand all opens retained content.

Private source files remain outside the repository. Projection checks snapshot,
terminal, native-source, and transcript hashes before export. Existing strict
public trial/observation/score schemas remain in force. The artifact guard adds
an exact hash allowlist for the two recovery result artifacts, and the browser
verifies transcript bytes and reference identity. Hidden reasoning, internal
Muse prompt context, credentials, local paths, addresses, private hosts, and
private-account payloads are excluded or explicitly redacted.

Recovery projection redaction counts: private account 1,692; local path 9,387;
address 21,921; credential 128; personal identifier 88; private host 144. A local
in-memory known-credential scan of all 691 projected JSON files found zero
matches, including decoded/nested strings and literal variants. An optional
upload for an additional VM-side credential scan was rejected by automatic
approval review and was not performed; the local scan was used instead.

All 33 family cost records reconcile their sample count to selected graded
trials. Retained baseline cost aggregates are preserved, and new selected
attempts use retained native token/cache usage. Muse uses the API-equivalent
rates recorded in the cost projector and checked against the provider pricing
page on September 21. These are token cost estimates, not OAuth subscription
invoices. Failed execution retries are excluded from headline cost and timing;
they are not presented as total recovery spending.

## Reproduction and validation

Run outside the repository with the immutable private snapshot:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/project-eval-recovery.py \
  --source /path/to/private-snapshot \
  --output /path/to/private-projection
```

Review the projection before installation. Copy results.json to the dated
recovery results directory and transcript files under public/transcripts.
Combine the original and recovery index entries/redaction counts, update the
mixed-campaign index identity and exporter/source hashes, and pin the index and
result-artifact SHA-256 values. Do not copy private inputs into the repository.

Validation covers snapshot count reconciliation, original campaign retention,
separate cohort identity, cost populations, every selected/retry chat's schema,
reference, length and hash, the strict publication guard, Python projection
checks, web tests, typecheck, lint, production build, and browser interaction.
