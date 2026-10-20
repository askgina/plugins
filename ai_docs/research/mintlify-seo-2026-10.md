# Mintlify SEO, llms.txt and crawler settings

Research date: 2026-10-20. Scope: what Mintlify supports for `docs/` in this repository, and what `https://docs.askgina.ai` serves today. It answers research ticket #176 on the Wayfinder map #168. It does not change any file under `docs/`.

## Sources

Mintlify primary sources, all fetched on 2026-10-20 as Markdown from `https://www.mintlify.com/docs/<path>.md`:

- [Global settings](https://www.mintlify.com/docs/organize/settings) has the `mint.json` to `docs.json` upgrade steps.
- [SEO and search](https://www.mintlify.com/docs/organize/settings-seo) lists `description`, `seo.indexing`, `seo.metatags`, `seo.paths`, `seo.organization`, `search` and `metadata`.
- [SEO](https://www.mintlify.com/docs/optimize/seo) covers generated meta tags, OG images, sitemap, `robots.txt`, Content-Signal and indexing controls.
- [llms.txt](https://www.mintlify.com/docs/ai/llmstxt) covers `llms.txt` and `llms-full.txt`.
- [Hidden pages](https://www.mintlify.com/docs/organize/hidden-pages) covers how hidden pages interact with indexing.
- [skill.md](https://www.mintlify.com/docs/ai/skillmd), [Markdown export](https://www.mintlify.com/docs/ai/markdown-export), [GEO guide](https://www.mintlify.com/docs/guides/geo) and [CLI](https://www.mintlify.com/docs/cli/index) cover the agent-facing outputs and checks.
- Schemas: `https://mintlify.com/schema.json` (what `docs/mint.json` points at) and `https://mintlify.com/docs.json`.
- Tooling: npm package `mint` 4.2.1072, run locally.

Live probes with `curl` on 2026-10-20 against `docs.askgina.ai`.

## Answers

### Is mint.json still supported?

It is deprecated. The global settings page says: "If your project uses the deprecated `mint.json` file, use the CLI to upgrade to `docs.json`." Every other page documents `docs.json` only, and calls it "the required configuration file".

Upgrade path from the same page: run `mint dev` in the docs directory. It writes a `docs.json` from the existing `mint.json`. Review it, then delete `mint.json`.

The deployed site still builds from our `docs/mint.json`, so the legacy format works today. The legacy schema at `https://mintlify.com/schema.json` has no `description` key. Its `seo` object has one property, `indexHiddenPages`, and its `metadata` object maps names to strings. The current schema adds `description`, `seo.indexing`, `seo.metatags`, `seo.paths`, `seo.organization`, `thumbnails` and `markdown.instructions`. So the SEO controls the owner asked for need `docs.json`.

I ran `mint dev` from `mint` 4.2.1072 on a copy of `docs/`. It needs an LTS Node. Node 25 stops with "mintlify is not supported on node 25". On Node 22 it created `docs.json` and left `mint.json` in place. The conversion kept `name`, `favicon`, `logo`, colors, the background, the Open Gina button as `navbar.primary`, `footer.socials.twitter` and all 20 redirects. It wrapped navigation as `navigation.groups` and set `theme: "mint"`. It dropped `colors.anchors`.

### Keys that control meta tags and Open Graph

| Need                                             | `docs.json` key                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Site description for search results and AI tools | `description`                                                                       |
| Meta tags on every page                          | `seo.metatags`, a string map such as `og:site_name`, `twitter:card`, `twitter:site` |
| Meta tags for one folder                         | `seo.paths[].metatags`, with `path` relative to the docs root                       |
| Meta tags for one page                           | page frontmatter, for example `"og:image"`, `canonical`, `noindex`                  |
| Publisher entity in JSON-LD                      | `seo.organization` with `name`, `url`, `logo`, `sameAs`                             |
| Search box placeholder                           | `search.prompt`                                                                     |
| Last modified date on pages                      | `metadata.timestamp`                                                                |

Precedence, lowest to highest: `seo.metatags`, matching `seo.paths`, page frontmatter. Frontmatter can only override keys the config already declares for custom tags. Keys with a colon need quotes in YAML.

Mintlify generates these tags itself: `description`, `og:title`, `og:description`, `og:site_name`, `og:url`, `og:type`, `twitter:card` (default `summary_large_image`), `twitter:title`, `twitter:description`, `canonical`, and structured data. Page `description` frontmatter feeds `description`, `og:description` and `twitter:description`.

### Per-page OG images

Mintlify generates a 1200 by 630 image for every page from the logo, the page title, the page description and the primary color. Options, in order of control:

1. `thumbnails.background` in `docs.json` sets a background and keeps the generated overlay.
2. A `thumbnail` object in frontmatter or on a navigation section changes the generated image for that page or section.
3. `og:image` in `seo.metatags` replaces all generated images with one static URL. A frontmatter `og:image` replaces one page.

`mint og` previews a page's generated image locally. Our live pages emit no `og:image` or `twitter:image` today, while a Mintlify-hosted docs.json site emits both with `og:image:width` 1200 and `og:image:height` 630.

### Indexing and hidden pages

By default Mintlify indexes only pages in `navigation`. Pages missing from navigation, under a hidden tab or group, or with `hidden: true` are left out of the sitemap, site search, assistant context, MCP search and `llms.txt`. `hidden: true` also adds a `noindex` meta tag.

Controls:

- `seo.indexing: "navigable"` is the default. `"all"` includes every page.
- `searchable: true` on a hidden tab or group includes just that group.
- `noindex: true` in frontmatter excludes one page from indexing, search, sitemap, assistant context and `llms.txt`.
- `seo.metatags.robots: "noindex"` applies to every page.
- The dashboard option "Don't index project" sets `noindex, nofollow` everywhere, empties the sitemap, returns 404 for `llms.txt` and serves a disallow-all `robots.txt` with `Content-Signal: ai-train=no, search=no, ai-input=no`. It does not gate `llms-full.txt`.

Our checker already requires every page to be in navigation, so `navigable` matches current content.

### llms.txt and llms-full.txt

Both are generated automatically and need no configuration. Mintlify also serves them at `/.well-known/llms.txt` and `/.well-known/llms-full.txt`.

- `llms.txt` has the site name as H1, the `description` from `docs.json` as a blockquote, an optional Agent Instructions block from `markdown.instructions`, then links in navigation order. Each link ends in `.md` and carries the page's frontmatter `description`, cut to its first paragraph and 300 characters. Pages without a description appear with no text. Indexes over 100,000 characters split into `/_llms/` files.
- `llms-full.txt` joins every page as title, source URL, description and full Markdown. It has no size limit.
- A file named `llms.txt` or `llms-full.txt` at the project root replaces the generated one.
- Every response carries `Link` headers for `llms-txt`, `llms-full-txt`, `mcp-server-card`, `agent-card` and `agent-skills`, plus `X-Llms-Txt: /llms.txt`.

### Sitemap and AI crawler settings

- `sitemap.xml` and `robots.txt` are generated. A file with the same name at the project root replaces the generated one and is served unchanged.
- The generated `robots.txt` allows every crawler and sets `Content-Signal: ai-train=yes, search=yes, ai-input=yes`. There is no `docs.json` key for crawler rules. The only way to change them is a custom `robots.txt`.
- The GEO guide warns that blocking `GPTBot`, `ClaudeBot` or `PerplexityBot` in `robots.txt` stops those tools from citing the docs. Our policy does that on purpose, to reserve training use. `mint score` has a `robotsTxtAllowsAI` check that would flag it.
- `markdown.instructions` appends text to every Markdown page served to agents. `markdown.schema` controls OpenAPI inclusion.
- `skill.md`, `.well-known/agent-skills/index.json`, `agent-card.json` and an MCP server card are generated automatically. A root `skill.md` overrides the generated one.

## Live site, 2026-10-20

| URL                                                                                           | Result                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/llms.txt`                                                                                   | 200, 9,671 bytes, starts `# Gina` then links. No description blockquote.                                                                 |
| `/llms-full.txt`                                                                              | 200, 178,208 bytes, `text/plain`                                                                                                         |
| `/sitemap.xml`                                                                                | 200, 68 URLs                                                                                                                             |
| `/robots.txt`                                                                                 | 200, matches `docs/robots.txt` in this repo: Content-Signal `ai-train=no, search=yes, ai-input=yes` and five AI training bots disallowed |
| `/connect/claude.md`                                                                          | 200, `text/markdown`                                                                                                                     |
| `/skill.md`                                                                                   | 200, generated, 13,418 bytes                                                                                                             |
| `/.well-known/agent-skills/index.json`, `agent-card.json`, `mcp/server-card.json`, `llms.txt` | all 200                                                                                                                                  |
| `https://askgina.ai/llms.txt`                                                                 | 404, tracked separately by the chatbot ticket for the redirect                                                                           |

Head of `https://docs.askgina.ai/connect/claude`: `<title>Claude - Gina</title>`, `description`, `og:title`, `og:description`, `og:site_name`, `og:url`, `og:type=website`, `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `canonical`, `rel=alternate` links to `/sitemap.xml` and `/connect/claude.md`, and two `application/ld+json` blocks. There is no `og:image`, `twitter:image` or `twitter:site`.

Gaps that config can close: no site description in `llms.txt`, no OG image, no `twitter:site`. The generated `skill.md` description is truncated to one line in `agent-skills/index.json` ("Use when agents need to research crypto markets, manage portfolios,"), because the generator cut the multi-line text. A custom `skill.md` would fix that but is outside this note.

## Not verified

- `mint score` needs `mint login`, so no readiness score was recorded.
- I did not confirm how Mintlify renders a legacy `mint.json` site internally. The live head matches docs.json behavior except for OG images.
- The effect of migration on visual styling is unconfirmed until a preview deployment. The converter dropped `colors.anchors`.
