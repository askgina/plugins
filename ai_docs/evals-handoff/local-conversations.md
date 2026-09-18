# Local attempt conversations

The task explorer links each September 16 sweep attempt to the retained private
conversation using campaign, configuration row, family, case, and repetition.
The local reader verifies the source-summary hash, source commit, catalog,
target, document identity, byte length, and conversation SHA-256 against the
bundle manifest. Older runs without a matching reference remain unlinked.

Set `EVAL_TRANSCRIPTS_DIR` in `apps/evals/.env.local` to the directory containing
the private bundle's `manifest.json` and `chats/`, then run `bun run evals:dev`.
Local environment files are ignored by Git. Do not use a `VITE_` prefix for this
setting or put the private bundle under `src/` or `public/`.

Open Tasks, choose a task and model, select an attempt, then expand Conversation.
Only that conversation is fetched. Closing it or changing attempts cancels the
pending request. Messages remain in captured order; tool arguments and results
expand inline. Retained text is rendered as text, without executing HTML or
loading embedded resources. Capture gaps, model-observed truncation, missing
supporting files, and missing final answers are distinct from grading.

The Vite middleware only serves loopback, same-origin development requests, with
no-store responses. It resolves only manifest-listed chat paths inside the bundle.
It is absent from production builds and preview servers. Public builds continue
to use the existing artifact checks and display an availability explanation.
Publishing conversations still requires an approved public export or a separately
authenticated evidence service; this local integration does not publish them.

Checks: `bun run lint`, `bun run evals:typecheck`, `bun run evals:build`, and
`bun --bun node_modules/.bin/vp test --run apps/evals/__tests__ tools/__tests__/eval-conversations.test.ts`.
