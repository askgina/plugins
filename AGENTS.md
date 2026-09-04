# Agent instructions

## Agent skills

Project-local skills live only under `.agents/skills/`. Treat `skills-lock.json` as their provenance lock; do not create or use agent-specific mirrors such as `.claude/skills/`.

Public Mintlify source lives under `docs/`. Internal engineering Markdown lives under `ai_docs/`; when generic vendored skill guidance names `docs/adr/` or `docs/agents/`, use the corresponding `ai_docs/` path in this repository.

### Issue tracker

Track issues, specifications, and Wayfinder maps in `askgina/plugins` GitHub Issues. See `ai_docs/agents/issue-tracker.md`.
