# Completed Grok 4.7 Low recovery publication

All nine selected Low recovery slots finished by `2026-09-22T12:42:24.022Z`.
Five produced grades (two passes and three failures); four ended with execution
errors. This publishes the complete 105-slot Low view, including its unresolved
execution failures. It does not claim complete grading.

| View                        | Planned | Graded | Passed | Failed | Ungraded |
| --------------------------- | ------: | -----: | -----: | -----: | -------: |
| Original Low                |     105 |     87 |     68 |     19 |       18 |
| Low with completed recovery |     105 |     92 |     70 |     22 |       13 |

The new `grok47-low-recovery-20260922` campaign retains 96 original slots and
selects the nine recovery attempts, including their four execution failures.
Every original graded result is retained exactly. The other thinking levels
remain on their original publication until their recovery results are published.

Original slots keep their 120-second budget. Every Low recovery attempt used
720 seconds. The 114 recorded executions (105 original plus nine retries), their
outcomes, budgets and terminal hashes are included in the numeric download. The
new cohort cannot compare as the original fixed-budget run. Low remains unranked
because 13 slots have no grade; cost remains unknown.

The result cell shows a provisional graded-only percentage, with execution
completion on its own line. Low's 79.3% is the equally weighted average of
11/12 Spot, 36/47 Perps and 23/33 Predictions grades. The 13 ungraded slots are
excluded from this conditional display rate, which is never used for sorting,
quality rankings, comparison eligibility or efficiency charts. Fully graded
settings keep their existing scores. A provisional Overall requires grades in
all three compatible categories and finished processing in every selected slot.

`tools/project-eval-grok47-low-recovery.py` runs beside the private VM evidence.
It verifies both campaigns' source/config/code/manifest hashes, all 420 original
terminal bindings, the nine completed Low recovery slots, selected native and
transcript hashes, model/effort identity for grades, and exact equality with the
published original Low projection. It rejects replacing an existing pass or
failure and rejects unfinished or differently budgeted retries.

The exporter reuses the pinned original numeric projection helper. It publishes
only allowlisted measurements, public identifiers, execution history and hashes.
Conversations, tool arguments, provider error text and hidden reasoning remain on
the VM. No model or MCP calls are made to publish these results.

Public artifacts in `apps/evals/src/results/2026-09-22/grok-4.7/`:

- `low-recovery.json`, SHA-256
  `f1b51cf3fea244e9928f70bbce37bcc5fa130c34c18fa119009b5f7b3ce4f1e5`.
- `low-recovery-snapshot.json`, SHA-256
  `6c74ad1fd6f5d61605ce50593787b4fcd9d5ed44cf8f3f3c2b743680ca4b8b58`.

Both are pinned by the public artifact guard. Original `results.json` and
`snapshot.json` remain unchanged. The two historical regrade receipts receive
only a canonical-source input-hash refresh; their grading entries stay identical.

The leaderboard's latest view and Grok 4.7 model settings select the Low recovery
by date. Medium, High and xHigh retain their original campaign rows. Both the
original and recovery downloads are available on the model page. The execution
history selector shows recorded budgets and outcomes without inventing a public
conversation or borrowing another execution's transcript.

Validation covers exact totals, original-grade preservation, latest-view
selection, unchanged price checks, cohort separation, private-content omission,
execution histories, exporter bindings, app typechecking/build, and lint.
