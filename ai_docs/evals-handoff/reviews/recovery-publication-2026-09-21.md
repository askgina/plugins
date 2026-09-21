# Recovery publication — 21 September 2026

Frozen source snapshot: 2026-09-21 09:55:28 UTC. The numeric status artifact
contains counts and integrity hashes only; native evidence and credentials stay
outside the repository.

Astra xhigh/max and all five Muse settings are fully graded. Grok remains
incomplete; the snapshot preserves its remaining execution gaps. Astra low,
medium and high were already complete in the original published campaign.

This publication retains the original sweep and adds the recovery campaign
separately. Completed failing grades are final. Only execution gaps are retried,
and the first completed grade is selected. Longer 300s/600s attempts are labelled
and are not equivalent to the original 120s benchmark.

Draft integration work: bind every selected result and retry to its redacted
public transcript, reconcile completed-attempt token cost estimates, expose
the separate campaign in existing browsing views, and run publication, grading,
privacy, build, lint, and browser checks before marking the PR ready.
