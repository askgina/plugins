# Public eval transcripts

The September 16 reasoning sweep has 3,675 public transcript documents, one for
every retained attempt across 35 model/settings rows. These are static files in
`apps/evals/public/transcripts`, fetched on demand by both the deployed site and
the development UI. No local evidence server or private filesystem is needed.
The five historical leaderboard configurations do not have linked chat captures.

The reader is available from Leaderboard → Chat and from an attempt in Tasks.
Expand all opens every message, tool call, tool result, recorded task input, and
capture-details section and removes nested output height limits. Collapse all
restores compact reading. Attempt changes reset the reader.

## Publication boundary

`tools/export-public-conversations.py` reads a retained private bundle and two
published sweep summaries. It verifies each source file's length/hash, summary
hash, source commit, catalog, route, and attempt identity. Only visible messages,
recorded task inputs, gap codes, capture flags, and public identity/provenance
are projected. Native files, raw sessions, account databases, forwarded receipts,
hidden reasoning, and arbitrary source metadata are never copied.

The known-secret file is read only in memory. Decoded strings and keys, nested
JSON, Unicode escapes, literal variants, and credential patterns are scrubbed.
Duplicate JSON keys fail closed. Addresses, emails, local paths, private hosts,
and private account fields are marked with explicit redaction placeholders.
Conversations using private account tools conservatively redact non-user text,
results, and arguments while retaining message/block order and tool names/IDs.
This includes 613 transcripts with private account redactions. Redactions are
labelled separately from capture completeness; 3,265 captures were complete and
410 have original capture gaps. No missing content is reconstructed.

Independent prepublication checks compared all 28,232 messages and 33,652 blocks
against retained sources, preserving role, sequence, block type/order, task-input
count, gap count, and capture flags. All 3,675 documents passed strict public
schema validation and a second decoded-value scan for the known credential
literals, credential prefixes, addresses, emails, and host paths. Diagnostics
contain only categories and counts.

The index binds every document to its bytes/SHA-256; its digest is pinned in
`public-transcript-manifest.ts`. Build checks reject modified, missing, extra,
unreviewed, or symlinked transcript files. Existing restrictions on raw evidence
and historical Claude artifacts still apply. Browsers verify the pinned index,
selected document bytes, strict schema, and all nine reference fields before
rendering escaped text. A failed request can be retried.

To regenerate, run the exporter with `--source`, `--public-results`, `--output`
(outside the repository initially), and `--secret-file`. Review/audit the output
before copying it into the public directory or updating the pinned index hash.
Never commit the known-secret file or retained private bundle. Generated JSON is
excluded from formatting because its exact bytes are pinned.

## September 21 recovery publication

The recovery campaign adds 689 public captures for selected VM executions and
closed retries, bringing the combined index to 4,364 documents. Original
transcript bytes remain unchanged. New captures include 520 complete transcripts
and 169 with explicit capture/execution gaps. The chat reader's Execution history
selector exposes each retained retry and its time budget. Full visible messages
are available on the deployed web app with the existing formatted/Source and
Expand all controls.

`tools/project-eval-recovery.py` verifies the immutable VM snapshot and projects
only public fields using the same redactor. Numeric result artifacts must pass
the existing strict schemas and an additional frozen hash allowlist. See
[the recovery publication record](reviews/recovery-publication-2026-09-21.md)
for selection policy, counts, costs, privacy checks, and reproduction details.
