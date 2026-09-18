# Reasoning sweep coverage audit — September 18, 2026

The retained campaign plan contains 35 model/settings and 3,675 attempts. Its row IDs exactly match the two published reasoning-sweep result files. Every setting dispatched all 105 planned attempts across Spot, Perps and Predictions. There are no pending attempts or missing slots. This verifies the planned matrix; it does not establish that the plan included every level supported by each provider.

Only 13 settings have complete grading. The remaining 22 contain 745 ungraded attempts: 392 OMP MCP connection failures, 203 Muse process failures, 142 timeouts, six OMP provider/process failures, one Devin process failure and one OMP startup failure. Underlying error tags are retained in the public projection; private summaries label the MCP errors `connection-failed`.

## Graded attempts by setting

Every denominator below is 105. Settings are ordered by configured reasoning level.

| Model                      | Graded attempts by setting                                               | Fully graded settings |
| -------------------------- | ------------------------------------------------------------------------ | --------------------- |
| anthropic/claude-fable-5-1 | low: 105/105; medium: 105/105; high: 105/105; max: 75/105                | 3/4                   |
| anthropic/claude-opus-5    | low: 105/105; medium: 105/105; high: 102/105; max: 85/105                | 2/4                   |
| devin/gemini-3-8-flash     | medium: 105/105; high: 105/105                                           | 2/2                   |
| devin/swe-2                | medium: 104/105; high: 102/105; max: 102/105                             | 0/3                   |
| muse-spark-1.3             | minimal: 85/105; low: 77/105; medium: 59/105; high: 50/105; max: 45/105  | 0/5                   |
| openai-codex/gpt-5.6-sol   | low: 104/105; medium: 101/105; high: 65/105; max: 36/105                 | 0/4                   |
| openai-codex/gpt-5.6-terra | low: 105/105; medium: 105/105; high: 79/105; max: 31/105                 | 2/4                   |
| openai-codex/gpt-6-astra   | low: 105/105; medium: 105/105; high: 105/105; xhigh: 54/105; max: 32/105 | 3/5                   |
| xai-oauth/grok-4.6         | low: 105/105; medium: 93/105; high: 46/105; xhigh: 38/105                | 1/4                   |

## Interpretation and next work

- Astra low, medium and high each retain an equal-category Overall score of 63.9601%; Gemini high retains 23.3143% and medium 38.9839%. These are tool-use conformance scores, not general model capability or answer-quality rankings.
- The previous table selected one setting per model, hiding other recorded results. The leaderboard now shows every model, reasoning setting and campaign in its own stable row: 35 latest-sweep settings plus five earlier records across ten models. Each row includes category outcomes, grading coverage, timing and estimated cost sample counts, client, budget and evidence links. Campaign and grading filters narrow the view explicitly; opening evidence or chat does not replace a setting or change the row order.
- The existing experiment used 120-second timeouts for OMP and Muse, versus 300 seconds for Devin. Clients and reasoning controls also differ. Complete grades alone do not remove those comparison differences.
- Diagnose and repair MCP connection failures and native process/provider errors before another campaign; verify readiness with preflight cases from all three families.
- Audit retained failure traces for usable completions and verify the deterministic grader against representative pass/fail examples. Recovery must preserve original attempt identity and record corrections. Missing or interrupted execution cannot be turned into a completed grade.
- For a stronger comparison, freeze the task suite, grader, model/settings matrix, common timeout/budget policy, environment and retry rules before running a balanced campaign across the intended matrix. Preserve the old campaign and all retry/failure history; do not silently replace only bad scores.
- Report both execution reliability and conformance, with sample counts and uncertainty. Infrastructure errors remain separate from graded task failures. No recovery or rerun has been performed as part of this UI correction.
