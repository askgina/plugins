# Release docs checklist

Use this list for every user-facing feature release: a new tool, venue, client, skill or flow. It covers what to publish so an agent can find the feature, connect, complete a first task and verify it without a human clicking through a UI. It also covers agentic SEO.

The public docs source is `docs/` in this repository. Edit it here first. The chatbot repository mirrors parts of it, and those mirrors are listed below. The decision to make this a release gate is recorded in [#173](https://github.com/askgina/plugins/issues/173), under map [#168](https://github.com/askgina/plugins/issues/168).

## Release gate

A feature release is not done until both checks pass.

1. **The deterministic gate passes.** Run `bun run docs:test` and `bun run docs:check`. CI runs the same checks in `.github/workflows/docs.yml`. The gate lives in `tools/docs/check.mjs` and enforces:
   - Every page has a frontmatter `description` that is one sentence on one line.
   - No page hardcodes a skill count such as "four research skills". Link to the skills page instead.
   - Every task page has a `## Check that it works` section.
2. **The jevify sweep shows no regression against the committed baseline.** Run the sweep as described in [Run the jevify sweep](#run-the-jevify-sweep), then run `node tools/docs/sweep/compare.mjs <results.json>`. It exits 1 when the number of self-serve pages falls, when more partial pages lack the verification heading, when a page newly reaches `drift_risk` 0.7 or higher, or when any page scores `description_ok` below 0.3.

Put the gate output and the compare table in the release pull request.

### Task pages and the baseline

A task page is any page inside a section folder, such as `spot-mcp/`, `connect/` or `product-guide/`. Top-level pages like `what-is-gina` are overviews and are exempt. A page also leaves the task set when its frontmatter has `pageType: reference`. Product-guide pages cannot add frontmatter keys because the chatbot corpus accepts an exact key set, so they leave the set with `kind: reference` or `kind: policy`.

Pages that lack the heading today are listed in `tools/docs/gate-baseline.json`, a sorted JSON array. The gate is a ratchet. A page that is not in the baseline and lacks the heading fails. A page that is in the baseline and now has the heading also fails, so add the heading and delete the entry in the same pull request. Never add a page to the baseline to get a release through. The five pages that still name a skill count are in `tools/docs/skill-count-allowlist.json`, which works the same way.

### The verification section

The heading is exactly `## Check that it works`. Under it, give one concrete prompt or command and the observable result to expect. For example, name the exact request to send and the tool call or answer that proves the connection. The sweep scores a page as self-serve only when an agent reading the page alone can reach that point, so state the endpoint, the auth step and the scope in the page text.

## Per page

- The frontmatter `description` says what the reader can do, in one sentence. Mintlify uses it as the page snippet and for the `llms.txt` line.
- The page names its prerequisites, the exact endpoint `https://askgina.ai/ai/<venue>/mcp`, the auth step and scope, and the exact tool names with example arguments. Check tool names against `packages/contracts/src/index.ts` for Gina Read and against the current server registry for each write venue.
- Every screenshot step has a text equivalent, and the alt text states the step. Essential instructions must work without images.
- Counts and lists that change, such as skills, tools, clients and chains, link to a generated or canonical page.
- The page says whether the feature reads or writes, what approval it needs, what it costs and what it does not do. Give refusal codes with their recovery step.
- "Try asking" prompts are real prompts. They can double as eval cases.
- The page is in `docs/docs.json` navigation. `node tools/docs/check.mjs` fails on orphan pages and broken links.

Authoring rules and page templates are in [`docs/authoring.md`](docs/authoring.md).

## Skills

- Every published skill lives at `plugins/<package>/skills/<id>/SKILL.md` inside a plugin package. A skill outside a package reaches no consumer.
- Each package declares its skills in the `skills:` list in `plugins/<package>/plugin.yaml`. Each entry has an `id` and an `mcpServed` flag that says whether the package's MCP endpoint serves it through the MCP skills extension.
- The generated catalog `skills/index.json` lists every declared skill with its package, path, description, MCP endpoint and files. Regenerate it with its generator and run the generator's `--check` mode before you push. CI fails on any `SKILL.md` that no package declares. The generator comes from the skills index task, [#179](https://github.com/askgina/plugins/issues/179).
- The chatbot reads only `skills/index.json`. Do not copy `plugin.json` or `openai.yaml` files into the chatbot.

## Chatbot mirrors

Two scheduled workflows in the private Ask Gina app repository copy from this repository. Both open a pull request with the repository `GITHUB_TOKEN`, so the full test workflow does not run on those pull requests. Run the tests by hand before you merge them.

- **Docs.** `mintlify-docs-sync.yml` runs daily at 05:17 UTC and on demand. It mirrors `docs/product-guide/` and `docs/connect/` into `plugins/ask-gina/docs/` and regenerates `lib/mcp/gina-connect-clients.generated.ts`. A new product-guide page reaches the Docs Agent only after it has corpus frontmatter, a reciprocal `relatedSlugs` entry and an entry in the chatbot `lib/docs/corpus.ts`. The assembled corpus stays under 28,000 characters.
- **Skills.** `plugin-skills-sync.yml` runs daily at 05:37 UTC and on demand. It copies the skills that `skills/index.json` lists. It fails when the index is missing or malformed, names a skill file that does not exist, leaves out an upstream skill, or names an MCP endpoint the app does not serve.

After you merge here, trigger the matching workflow from the chatbot repository instead of waiting for the schedule when the release depends on the mirror.

## Machine-readable surfaces in the chatbot

These live in the app repository, so the release pull request there is the proof.

- Tool descriptions, input and output schemas, and annotations for read-only and destructive tools are accurate.
- Guidance sits on the right surface: skills, guide and policy resources, refusal hints and typed next-step prompts.
- A skill is served on the MCP endpoint that owns its tools.
- OAuth protected-resource metadata exists for a new endpoint, and a browser GET of the endpoint redirects to the docs page.
- New client deep links and `claude mcp add` commands are regenerated by the docs sync.

## Distribution

- The first-request page, `docs/start/first-request.mdx`, shows the feature if it changes what a new user does first.
- Update the package's host manifests, such as those under `plugins/<package>/targets/`, and the root `marketplace.json` files in `.claude-plugin/`, `.cursor-plugin/` and `.agents/`. Bump versions the way [`contributing.md`](contributing.md) requires.
- Marketplace and vendor resubmissions, such as the ChatGPT tool justifications, the Grok bot form and the Devin marketplace pin, happen outside this repository. Record what you resubmitted in the release pull request.
- A new public MCP server, or a changed name or remote, needs its `registry/server.*.json` entry updated with a new `version`. [`mcp-registry.md`](mcp-registry.md) has the publish steps.

## Agentic SEO

- `docs/robots.txt` keeps `Content-Signal: ai-train=no, search=yes, ai-input=yes`, the training crawler blocks and the sitemap line. `node tools/docs/check.mjs` fails if they disappear.
- Page titles use the words a user would search. Headings that answer a question use the question as the heading. Names for the same thing match across docs, tool descriptions and listings.
- After the docs deploy, fetch `https://docs.askgina.ai/llms.txt`, the sitemap and the new page, and confirm the page shows up with its description.
- `https://askgina.ai/llms.txt` and `https://askgina.ai/llms-full.txt` redirect permanently to the docs copies. Check that both still redirect after the release.
- `docs/docs.json` holds the site `description`, `seo.indexing` and the social metatags. `node tools/docs/check.mjs` fails without a site description, when `seo.indexing` is not `navigable`, on a site-wide `noindex` and without the `summary_large_image` card. MCP Registry entries are covered under Distribution.

## Proof

- Give a clean agent only `https://docs.askgina.ai/llms.txt` and ask it to connect and complete the new task. Keep the transcript with the release pull request.
- Run the plugin evals that cover the feature. Eval cases live in `plugins/ask-gina/evals/`.
- Ask the Docs Agent a question about the feature after the docs mirror lands.

## Run the jevify sweep

The sweep asks a judge four fixed questions about every docs page. Its frozen questions are in `tools/docs/sweep/rubric.json` and its baseline is `tools/docs/sweep/baseline-2026-10-20.json`, taken at `askgina/plugins@0805b519820874c392474bb445610437cded284c`. At that ref 68 pages were judged, none truncated at 20,000 characters. The judge model was `openrouter/typesafe/jev-1.14-20261014`, and the run cost about $0.004.

| Question         | Type   | What it asks                                                                                          |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `onboarding`     | choice | `self_serve`, `partial` or `no_task`: could an agent finish the page's task from the page text alone. |
| `ui_only`        | bool   | Is a required step shown only as a screenshot or a vague UI action.                                   |
| `drift_risk`     | bool   | Does the page hardcode counts or lists that will go stale.                                            |
| `description_ok` | bool   | Is the frontmatter description usable as an `llms.txt` line.                                          |

Do not change the questions. A changed rubric invalidates every earlier verdict, and `compare.mjs` refuses to compare results with a different `hash`. To change a question, re-judge every page, commit a new `rubric.json` and a new dated baseline in the same pull request, and explain why.

Run it from the repository root in an `eval` Python cell with the jevify skill loaded. This is a sketch of the steps, not a tested script.

```python
import json, subprocess

Q = json.load(open("tools/docs/sweep/rubric.json"))
REF = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
CAP = 20_000

paths = [p for p in subprocess.check_output(
    ["git", "ls-tree", "-r", "--name-only", REF, "docs"], text=True).split() if p.endswith(".mdx")]

def page(path):
    text = subprocess.check_output(["git", "show", f"{REF}:{path}"], text=True)
    return {"page": path, "content": text[:CAP] + ("\n…[truncated]" if len(text) > CAP else "")}

batch = judge_batch({p: page(p) for p in paths}, Q["questions"], intent=f"docs sweep {REF[:8]}")
verdicts, errors = {}, {}
while len(verdicts) + len(errors) < batch.total:
    for key, item in await batch.drain(timeout=30):
        if item.error is not None:
            errors[key] = str(item.error)
        else:
            verdicts[key] = item.answers

json.dump({"hash": Q["hash"], "ref": REF, "errors": errors, "verdicts": verdicts},
          open("/tmp/docs-sweep-results.json", "w"), indent=2)
```

Then compare:

```sh
node tools/docs/sweep/compare.mjs /tmp/docs-sweep-results.json
```

Run the compare from the checkout at the same ref you judged, because it reads each `docs/...mdx` page from disk to look for the verification heading. The command prints a table of baseline against current values and exits 1 on any regression, on a rubric hash mismatch, or when the results contain judge errors.

Read the judge output as evidence, not as a verdict. For every page the compare names, open the page and confirm the finding before you change it. Re-judge pages whose top choice probability is under 0.7 or whose bool score sits between 0.3 and 0.7 by reading them.

To refresh the baseline after the pages improve, save a complete run as `tools/docs/sweep/baseline-<date>.json` with the same fields as the current baseline plus `partialLackingHeading`, the count of `partial` pages that lack `## Check that it works` at that ref. Point `compare.mjs` at the new file through its second argument and update this section.
