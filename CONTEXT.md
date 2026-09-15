# Ask Gina evals

Vocabulary for evaluation results that the framework exports and the evals app browses. Decisions live in the `askgina/plugins` Wayfinder tickets; this file only fixes the words.

## Language

### Trials and attempts

**Planned slot**:
One case and repetition the run plan says should execute.
_Avoid_: trial (when the slot never ran), expected attempt

**Attempt**:
One evaluator dispatch of a planned slot, with its own record and verdict. A recovery dispatch is a separate attempt.
_Avoid_: trial, rerun, retry (transport retries are nested request events, not attempts)

**Started**:
An attempt that was dispatched, whatever it did afterwards. The headline denominator.
_Avoid_: graded, observed, scored

**Execution status**:
Whether an attempt ran and how it ended: completed, timed out, runtime failure, pending, unstarted, unknown.
_Avoid_: outcome, verdict

**Unstarted**:
A planned slot an authoritative plan and status source shows was never dispatched.
_Avoid_: missing, absent, not found

**Unknown**:
A planned slot with no authoritative record of whether it started.
_Avoid_: unstarted, incomplete

**Runtime failure**:
A started attempt that ended without producing an observation, for a reason other than the task deadline.
_Avoid_: timeout, error, fail

### Grading

**Grading verdict**:
The grader's judgement of a completed attempt: pass, fail, or not graded.
_Avoid_: outcome, result, score

**Not graded**:
A started attempt the grader never judged. Carries no failure category.
_Avoid_: unscored, fail, timeout

**Conformance**:
What every retained grader measures: whether the agent routed, argued and completed as the case expected. Never answer accuracy.
_Avoid_: accuracy, correctness, quality

**Check**:
One named grader dimension on an attempt (routing, arguments, safety, completion, skill activation) with outcome pass, fail, not applicable or not evaluated.
_Avoid_: dimension, criterion, score

**Failure category**:
A closed-vocabulary label derived from a failed check on a completed attempt.
_Avoid_: error tag, reason, category (for runtime failures)

**Attribution**:
Who a runtime failure is blamed on: infrastructure, agent, or unattributed.
_Avoid_: cause, error

### Coverage and metrics

**Dispatch coverage**:
Whether every planned slot started: complete, incomplete (proven unstarted slots), or unknown.
_Avoid_: coverage (bare), completeness

**Grading coverage**:
Whether every started attempt was graded: complete or partial.
_Avoid_: scored coverage

**Headline pass rate**:
Passes divided by started attempts. The only sort key.
_Avoid_: pass rate (bare), score, success rate

**Graded-only rate**:
Passes divided by graded attempts. A labelled diagnostic shown only in run detail and model profile.
_Avoid_: adjusted pass rate, effective pass rate

**Task duration**:
The interval from dispatch through final model or tool completion.
_Avoid_: latency, duration (bare), wall time

**Wall duration**:
Elapsed time around the whole attempt, including setup, cleanup and settlement.
_Avoid_: task duration, latency

**Sample count**:
How many attempts a statistic was computed over, always stated with its population (started, completed or graded).
_Avoid_: n, observations (bare)

### Evidence

**Evidence capability**:
How much of a run a source retains: detailed, partial, aggregate only.
_Avoid_: detail level, fidelity

**Not retained**:
A fact the source never captured or the bundle does not carry.
_Avoid_: missing, withheld, unavailable (bare)

**Not recorded**:
A single measurement absent on one attempt inside an otherwise detailed source.
_Avoid_: zero, null, missing

**Withheld**:
A fact that exists in the source and is excluded from the public projection by policy or review.
_Avoid_: not retained, redacted, private

**Case binding**:
How a historical attempt is tied to a case definition: bound by suite, bound by catalog sha, or unbound.
_Avoid_: joined, matched, linked

**Publication reviewer**:
The role that approves exact export content before it enters a public index. Held by the owner today.
_Avoid_: approver, sanitizer, CI

### Comparison

**Evidence category**:
The comparison class a run belongs to: controlled OpenRouter, native agent, or labels only.
_Avoid_: host, provider, tier

**Configuration availability**:
Whether a run's configuration is pinned or labels only.
_Avoid_: pinned (as a boolean), verified

**Eligibility reason**:
A machine-readable code explaining why a run is unranked or outside a comparison. Reasons are additive.
_Avoid_: exclusion, note, explanation (free text)
