# Maintaining Gina documentation

The public Mintlify source is `docs/`. Track changes in [askgina/plugins issues](https://github.com/askgina/plugins/issues); this overhaul is [#42](https://github.com/askgina/plugins/issues/42). Internal research, verification evidence, templates, and inventories belong in `ai_docs/`.

## Write for the task

Lead with what the reader can accomplish. Explain Gina before its protocols. Use one primary purpose per page: a guided tutorial, task instructions, conceptual explanation, or factual reference. Keep this classification editorial; do not add another navigation layer.

Use sentence-case headings and actual UI labels. Define MCP, plugin, skill, and authentication separately. Prefer a specific prompt and expected result over “try it out.” Preserve distinctions between research, preparation, submission, and settlement. Use “Write access (Degen mode)” in navigation and the literal “Full access — view and execute” label when describing Agent Setup.

## Verify claims before publishing

- Check tool names against `packages/contracts/src/index.ts` for Gina Read and the current server registry for each write venue. Do not infer write tools from the research plugin.
- Check host setup against primary host documentation. Record evidence in `ai_docs/docs-host-verification.md`. Source adapters do not prove marketplace approval. Mark unverified availability and authenticated tests explicitly.
- Store installation instructions once per client or venue; link quickstarts to them.
- Preserve product-guide routes and existing frontmatter. The chatbot consumes eight explicit corpus entries with reciprocal `relatedSlugs`. New pages are public docs but are not automatically added to that corpus. Coordinate corpus additions in the chatbot repo.
- Do not call a proposed flow “tested” until it was run. Keep UI-source verification separate from authenticated end-to-end verification.

## Screenshots

Capture actual app components with a demo account or Storybook fixture. Do not fabricate product UI. Use local images under `docs/images/product/`, crop around the relevant control, keep each image under 1 MB, and include descriptive alt text plus a caption. State when values are sample data. Never capture credentials or a real user's financial information. Record source component, fixture, capture date, and limitations in `screenshots.md`.

Essential instructions must remain understandable in Markdown without images. Simulated and live run labels must be explained in text.

## Checks and preview

```sh
node --test tools/docs/check.test.mjs
node tools/docs/check.mjs
node tools/docs/check.mjs --external
cd docs
mint dev --port 3005
```

Inspect desktop and mobile navigation, code blocks, tables, screenshots, and one path from homepage to first request. In the Mintlify preview, check affected pages and redirects; after deployment, verify `/llms.txt`, supported full-text/Markdown exports, and removal of retired content. The production index remains unchanged until deployment.

CI covers navigation, component and Markdown links, local images, redirects, retired instructions, tool-catalog parity, scopes, skill names, corpus metadata, and the approved crawler policy. External URL checks can fail because of host access controls; investigate the result instead of declaring the target nonexistent.

## Moving or retiring content

Every public MDX page must be in navigation. Remove retired source so search and agent exports cannot retrieve stale instructions, add a redirect to the replacement, and update internal links to use the replacement directly. Preserve useful deep links. Use the inventory to record keep/rewrite/merge/retire decisions.

## Page templates

### Tutorial

```md
---
title: "Complete a specific first task"
description: "The result the reader will get."
---

By the end, you will [observable outcome]. You need [prerequisites].

## 1. Connect

[Exact setup link and permission choice.]

## 2. Try the task

[Copyable prompt or command.]

Expected: [recognizable result and how to verify it].

## If it fails

[Smallest recovery action and troubleshooting link.]

Next: [one useful follow-up task].
```

### Task guide or reference

Begin with the task or capability. For a guide, list prerequisites, exact steps, expected result, and relevant limitations. For a reference, use a table of verified interfaces and examples, then link to a tutorial. Avoid duplicating setup configuration or generic safety text on every page.

## Chatbot corpus compatibility

The existing eight corpus pages require a source H1 matching frontmatter and an exact set of seven metadata keys. Included pages must be plain Markdown, and the assembled included corpus must stay under 12,000 characters. Use Markdown image syntax and text captions in those pages. `docs/style.css` hides the redundant source H1 in the web rendering because Mintlify already renders the page title. Recheck the selector when upgrading Mintlify.
