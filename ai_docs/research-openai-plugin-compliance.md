# OpenAI public plugin packaging and submission requirements

Research date: 2026-08-26. Scope: MCP-backed plugins submitted to the universal public Plugins Directory. This note does not assess this repository's plugin implementation.

Internal engineering notes live in `ai_docs/`; the public Mintlify source is isolated under `docs/`.

## Source set and precedence

Primary OpenAI sources reviewed:

- [Package your plugin](https://developers.openai.com/plugins/build/plugins) covers package layout and manifest paths.
- [Plugin submission errors](https://developers.openai.com/plugins/deploy/submission-errors) covers machine-enforced package and final-submission limits.
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission) covers the current portal workflow and submission materials.
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server) and [plugin reference](https://developers.openai.com/plugins/reference) cover tool descriptors, results, annotations, and optional UI metadata.
- [MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review) covers scan/review behavior and versioned metadata snapshots.
- [Authentication](https://developers.openai.com/plugins/build/auth) covers OAuth requirements when authentication is used.
- Current examples linked by OpenAI's packaging guide: [Figma](https://github.com/openai/plugins/tree/main/plugins/figma), [Notion](https://github.com/openai/plugins/tree/main/plugins/notion), and [Build Web Apps](https://github.com/openai/plugins/tree/main/plugins/build-web-apps).

For a public submission, use the tighter **final directory submission** rules in the error reference when the packaging guide or examples allow a looser value. Portal validation is authoritative over example contents.

## What can be fixed in the repository

### 1. Package root, manifest, and paths

Sources: [Plugin structure](https://developers.openai.com/plugins/build/plugins#plugin-structure), [Path rules](https://developers.openai.com/plugins/build/plugins#path-rules), [archive errors](https://developers.openai.com/plugins/deploy/submission-errors#archive-errors), and [plugin root errors](https://developers.openai.com/plugins/deploy/submission-errors#plugin-root-errors).

- Put the required manifest at `.codex-plugin/plugin.json`. Only `plugin.json` belongs inside `.codex-plugin/`; keep `skills/`, `hooks/`, `assets/`, `.app.json`, and `.mcp.json` at the plugin root.
- Manifest component and asset paths must start with `./`, resolve relative to the plugin root, remain inside it, and use `/`. They must not be absolute or contain `..`, empty segments, outer whitespace, control characters, or case/Unicode-normalization collisions.
- A ZIP must contain exactly one plugin root, either at archive root or in one top-level directory with no siblings. Limits are: 100 MB compressed, 512 MiB extracted, 5,000 entries, 20 path segments per entry, and 100 MiB per entry. Entries must be readable, unencrypted regular files/directories using supported compression.

### 2. Manifest identity and component references

Sources: [Manifest fields](https://developers.openai.com/plugins/build/plugins#manifest-fields), [plugin manifest errors](https://developers.openai.com/plugins/deploy/submission-errors#plugin-manifest-errors), and [plugin content errors](https://developers.openai.com/plugins/deploy/submission-errors#plugin-content-errors).

Required package identity:

- `name`: non-empty, at most 64 characters, beginning with an ASCII letter or digit and containing only ASCII letters, digits, `_`, and `-`. The packaging guide recommends stable kebab-case.
- `version`: non-empty semantic version, at most 64 characters; use a changed version for a new release.
- `description`: non-empty supported text, at most 1,024 characters.
- `author.name`: non-empty supported text, at most 120 characters. Optional `author.email` is at most 320 characters; optional `author.url` is credential-free HTTPS and at most 2,048 characters.
- `interface`: the public listing object described below.

Component references, when present, are `skills: "./skills/"`, `mcpServers: "./.mcp.json"`, `apps: "./.app.json"`, and `hooks` pointing inside the plugin. Undeclared root `.mcp.json` and `.app.json` files are ignored. `hooks/hooks.json` is auto-discovered if no `hooks` field is set.

### 3. `.app.json` versus `.mcp.json` versus public submission

Sources: [Package your plugin](https://developers.openai.com/plugins/build/plugins), [bundled MCP servers](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks), [app reference errors](https://developers.openai.com/plugins/deploy/submission-errors#app-reference-errors), and [Submit the MCP server, not an existing integration reference](https://developers.openai.com/plugins/deploy/submission#submit-the-mcp-server-not-an-existing-integration-reference).

- `.app.json` maps aliases to already-registered app/connector/template IDs for local or workspace packaging. The error reference accepts IDs beginning `asdk_app_`, `connector_`, or `templated_apps_`, followed by the documented identifier characters. Reference it with `apps: "./.app.json"`.
- `.mcp.json` configures MCP servers distributed with the plugin for host loading. Reference it with `mcpServers: "./.mcp.json"`. The packaging guide documents either a direct server map or a wrapper named `mcp_servers`.
- Neither file substitutes for the public-directory MCP flow. Select **With MCP** and submit the production MCP URL and review materials directly. The portal does not publish a reference to an existing ChatGPT app. A **Skills only** upload excludes `apps`/`.app.json`, `mcpServers`/`.mcp.json`, and screenshots.

### 4. Public listing fields and final limits

Sources: [Final directory submission](https://developers.openai.com/plugins/deploy/submission-errors#final-directory-submission) and [listing/interface errors](https://developers.openai.com/plugins/deploy/submission-errors#listing-and-interface-errors).

Use supported text: no control characters, Unicode line/paragraph separators, unsupported invisible formatting, or whitespace-only values. URLs must contain a host and no embedded credentials.

| Manifest field                | Public-directory rule                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `interface.displayName`       | Required, one line, at most **30** characters.                                                                                                                                                                                                                                                                                                               |
| `interface.shortDescription`  | Required, one line, at most **30** characters.                                                                                                                                                                                                                                                                                                               |
| `interface.longDescription`   | Required, at most 4,000 characters; line breaks allowed.                                                                                                                                                                                                                                                                                                     |
| `interface.developerName`     | Required, one line, at most **80** characters; align it and `author.name` with the verified publisher identity.                                                                                                                                                                                                                                              |
| `interface.category`          | Required for final submission. Exact values: `Productivity`, `Creativity`, `Developer Tools`, `Business & Operations`, `Data & Analytics`, `Communication`, `Education & Research`, `Security`, `Finance`, `Healthcare`, `Travel`, `Entertainment`, or `Other`. Package validation defaults an omitted value to `Other`, but final submission says required. |
| `interface.capabilities`      | At most 20; each non-empty, one line, and at most 120 characters.                                                                                                                                                                                                                                                                                            |
| `interface.defaultPrompt`     | At most 3 starter prompts; each non-empty, one line, unique after Unicode/whitespace normalization, at most **128** characters, and containing no app `@mention`. A string or list is accepted.                                                                                                                                                              |
| `interface.websiteURL`        | Required for MCP-backed submissions; credential-free HTTPS, at most **1,024** characters.                                                                                                                                                                                                                                                                    |
| `interface.supportURL`        | Same rule.                                                                                                                                                                                                                                                                                                                                                   |
| `interface.privacyPolicyURL`  | Same rule.                                                                                                                                                                                                                                                                                                                                                   |
| `interface.termsOfServiceURL` | Same rule.                                                                                                                                                                                                                                                                                                                                                   |
| `interface.brandColor`        | Optional six-digit hex; at least 2:1 contrast against white.                                                                                                                                                                                                                                                                                                 |
| `interface.brandColorDark`    | Optional six-digit hex; at least 2:1 contrast against `#212121`.                                                                                                                                                                                                                                                                                             |

Package validation is looser for some fields (80-character display name, 240-character short description, 120-character developer name, 512-character starter prompt, and 2,048-character listing URLs). Those values can pass upload and still fail final submission.

### 5. Branding assets and screenshots

Sources: [Asset path errors](https://developers.openai.com/plugins/deploy/submission-errors#asset-path-errors), [image errors](https://developers.openai.com/plugins/deploy/submission-errors#image-errors), and [MCP/review errors](https://developers.openai.com/plugins/deploy/submission-errors#mcp-and-review-errors).

- `interface.logo` and `interface.composerIcon` are required directory branding images. Their paths must start with `./` and name existing regular files inside the package.
- Supported extensions are `.png`, `.jpg`, `.jpeg`, `.webp`, and `.svg`; maximum size is 5 MiB. Images must be square and at least 48×48. Raster images may be at most 4,096×4,096 and must decode as the extension claims. SVG must be valid UTF-8 XML rooted at `<svg>`, with positive numeric square dimensions from a `viewBox` or unitless `width` and `height`.
- Screenshots are allowed only when the current MCP scan reports a UI output template. If supplied, provide one PNG or JPEG per starter prompt, exactly 706 px wide, with a height from 400 to 860 px. A package without custom UI should omit screenshots rather than copy an example's empty array.

### 6. MCP tool metadata and optional UI

Sources: [Define tools](https://developers.openai.com/plugins/build/mcp-server#define-tools-from-user-goals), [tool annotations](https://developers.openai.com/plugins/build/mcp-server#tool-annotations-and-elicitation), [tool descriptor parameters](https://developers.openai.com/plugins/reference#tool-descriptor-parameters), and [metadata stored during scanning](https://developers.openai.com/plugins/deploy/app-review#metadata-stored-during-tool-scanning).

Every exposed tool needs a clear action-oriented name/title, usage description, explicit input schema, handler-side authorization, and accurate result shape. Declare `outputSchema` whenever returning `structuredContent`. Tool results must omit secrets, access tokens, unnecessary personal data, debug payloads, and internal identifiers; `_meta` is hidden from the model but is not secure storage.

Every tool must explicitly advertise all three booleans according to real behavior:

- `readOnlyHint`: `true` only if no state can change; creating, updating, deleting, sending, enqueueing, running jobs/workflows, or writing logs makes it `false`.
- `openWorldHint`: for write tools, `true` if the tool can affect public/external internet state; `false` only for wholly closed/private effects.
- `destructiveHint`: for write tools, `true` for deletion, overwrite, access revocation, irreversible messages/transactions, or another irreversible effect.

For custom UI, the scan imports linked resource metadata and CSP. Define a CSP allowing the exact fetched domains, and provide an explanation for each external frame domain reported by the scan. UI resource references and tool `_meta` become reviewed, versioned metadata. If a tool accepts ChatGPT file inputs, follow the [strict four-property file schema](https://developers.openai.com/plugins/reference#define-file-inputs): declare `download_url`, `file_id`, `mime_type`, and `file_name`, requiring only the first two.

### 7. Bundled skills, if any

Sources: [Skill errors](https://developers.openai.com/plugins/deploy/submission-errors#skill-errors), [skill agent metadata errors](https://developers.openai.com/plugins/deploy/submission-errors#skill-agent-metadata-errors), and [submission skills](https://developers.openai.com/plugins/deploy/submission#skills).

- Put each skill at `skills/<skill>/SKILL.md`; the skill directory must be an immediate, non-hidden child. `SKILL.md` must be readable UTF-8 with YAML front matter containing non-empty `name` and `description`, followed by non-empty instructions. The combined `plugin-name:skill-name` is at most 64 characters, and skill names must be unique.
- Optional OpenAI presentation metadata belongs in `skills/<skill>/agents/openai.yaml` under `interface`, not in `SKILL.md` metadata. If that file exists, `interface.display_name` and `interface.short_description` are required; optional fields and policies must use the types/enums in the error reference.
- Every uploaded or MCP-imported skill must pass safety/security scanning, which OpenAI says may take up to two hours. MCP-imported skills are submission-time snapshots; after changing them, run **Scan Tools** again and submit a new version.

## What requires the portal or live runtime

### 8. Publisher access and identity

Source: [Before you submit](https://developers.openai.com/plugins/deploy/submission#before-you-submit) and [organization verification](https://developers.openai.com/plugins/deploy/app-review#organization-verification).

- The submitter needs **Apps Management: Write** (underlying `api.apps.write`) in the publishing Platform organization.
- Select a verified individual or business identity whose name and public details match the listing, website, support contact, privacy policy, and terms.
- Use a project with global data residency; the review reference says EU-data-residency projects currently cannot submit MCP plugins.

### 9. Production MCP endpoint, authentication, and scan

Sources: [Submission MCP steps](https://developers.openai.com/plugins/deploy/submission#mcp), [domain verification](https://developers.openai.com/plugins/deploy/submission#domain-verification), [MCP/review errors](https://developers.openai.com/plugins/deploy/submission-errors#mcp-and-review-errors), and [Authentication](https://developers.openai.com/plugins/build/auth).

- Submit a public production HTTPS MCP endpoint, never localhost/test infrastructure or an existing integration ID. Use **Universal** unless OpenAI has approved a template URL. An approved template needs a concrete working example URL plus unique `{name}` placeholders whose names start with a letter and contain only letters, digits, or underscores.
- Complete domain verification by serving exactly the generated token, and nothing else, from `https://<allowed-host>/.well-known/openai-apps-challenge`. The challenge base must be the MCP host or a parent origin; its path is ignored.
- Configure authentication and reviewer-ready credentials if sign-in is required. Credentials must work outside private networks without MFA, SMS, or email confirmation.
- For OAuth, implement the MCP OAuth 2.1 discovery/PKCE/resource requirements in the authentication guide. If workspace domain restrictions are supported, advertise and enable `openid` and `email`, and expose a UserInfo endpoint returning `email` and `email_verified: true`.
- Run **Scan Tools** after deploying the production server. Review discovered tools, security schemes, schemas, annotations, imported skills, UI resources/CSP, and domains. Every tool needs a written portal justification for each annotation. Fix live metadata, deploy, and rescan; prose justification cannot override the server's advertised values.

### 10. Submission-only materials and actions

Sources: [Prepare required materials](https://developers.openai.com/plugins/deploy/submission#prepare-required-materials), [Testing](https://developers.openai.com/plugins/deploy/submission#testing), [Final directory submission](https://developers.openai.com/plugins/deploy/submission-errors#final-directory-submission), and [Submit](https://developers.openai.com/plugins/deploy/submission#submit).

Prepare or complete in the portal:

- a demo-recording URL showing main use cases and tools across supported platforms;
- **exactly five** positive test cases and **three** negative cases (see ambiguity below), runnable without internal context. Positive cases include prompt, expected tool/skill/workflow behavior, result shape, and fixture/account data. Negative cases include scenario, expected refusal/clarification/safe fallback, and why completion is inappropriate;
- reviewer demo credentials when OAuth is used;
- release notes describing purpose, initial/update status, changes, and review setup details;
- country/region availability where product, support, and legal terms are ready;
- all policy attestations after listing, server, skills, prompts, tests, and availability are accurate;
- a successful current MCP tool scan and successful skill scans;
- **Submit for Review**, then, after approval, a separate **Publish** action. Approval alone does not list the plugin.

## Current first-party examples: useful patterns, not final-submission templates

Sources: current `main` manifests for [Figma](https://github.com/openai/plugins/blob/main/plugins/figma/.codex-plugin/plugin.json), [Notion](https://github.com/openai/plugins/blob/main/plugins/notion/.codex-plugin/plugin.json), and [Build Web Apps](https://github.com/openai/plugins/blob/main/plugins/build-web-apps/.codex-plugin/plugin.json), plus the Figma [`.app.json`](https://github.com/openai/plugins/blob/main/plugins/figma/.app.json) and [`.mcp.json`](https://github.com/openai/plugins/blob/main/plugins/figma/.mcp.json) and Notion [`.app.json`](https://github.com/openai/plugins/blob/main/plugins/notion/.app.json) and [`.mcp.json`](https://github.com/openai/plugins/blob/main/plugins/notion/.mcp.json).

- Figma and Notion demonstrate hybrid packages with skills, `apps`, `mcpServers`, square branding assets, and empty screenshot lists. Their `.app.json` files use real `connector_...` and `asdk_app_...` IDs; their `.mcp.json` files use hosted HTTP MCP URLs.
- Build Web Apps demonstrates a skills-only package with no `apps` or `mcpServers` reference.
- All three include listing copy, category, capabilities, legal URLs, brand color, logo, composer icon, and starter prompts.
- Do **not** copy their field lengths or omissions as submission policy: all three current short descriptions exceed the documented 30-character final limit, and none currently includes `supportURL`. The submission error reference is stricter and should win.

## Document ambiguities and contradictions

1. **Upload limits versus final limits:** package validation accepts longer display names, short descriptions, developer names, starter prompts, and URLs than final submission. Use the final limits in the checklist above.
2. **Current examples versus final limits:** the three examples explicitly linked by the packaging guide have short descriptions over 30 characters and omit the MCP-required `supportURL`. Treat them as structural examples only.
3. **`.mcp.json` wrapper spelling:** the packaging guide documents a direct map or `mcp_servers`; current Figma and Notion examples wrap the map as `mcpServers`. This affects local/bundled host configuration, not the public portal's direct MCP URL. Confirm the target host's accepted form before changing a bundled config.
4. **App ID prefix wording:** the packaging walkthrough says a copied browser technical ID starts `plugin_asdk_app`, while the error reference and current Notion example accept/use `asdk_app_...`. Use the actual registered ID and rely on package validation; public submission should not submit the app reference anyway.
5. **Test count:** the submission workflow says “at least five” positive and three negative tests, while the final error reference says “exactly five” positive and three negative. Submit exactly 5 positive and 3 negative to satisfy both descriptions.
6. **Category omission:** package validation may default a missing category to `Other`, but final directory submission says category is required. Set it explicitly.
7. **Screenshots:** one page calls UI screenshots optional; the final error reference requires one screenshot per starter prompt if screenshots are added and rejects them unless the current scan reports a UI template. The safe rule is omit them for headless MCP; for custom UI, supply a complete prompt-matched set in the specified dimensions.

## Actionable compliance checklist

### Repository-fixable

- [ ] One plugin root with `.codex-plugin/plugin.json`; all declared paths begin `./` and stay inside the root.
- [ ] Identity fields meet type, character, semantic-version, and length rules.
- [ ] Listing uses the stricter final limits, exact category enum, all four MCP-required HTTPS URLs, and normalized starter prompts.
- [ ] `logo` and `composerIcon` are valid square in-package images; screenshots follow the custom-UI-only rule.
- [ ] `apps` is used only for local/workspace registered mappings; public submission is designed around the production MCP server directly.
- [ ] Every tool has accurate name/title/description, input and applicable output schema, all three annotations, and privacy-safe results.
- [ ] Custom UI has exact-domain CSP/resource metadata; bundled skills satisfy layout/front-matter/agent-metadata rules.

### Portal/runtime-only

- [ ] Submitter has Apps Management write access and selects a matching verified publisher identity.
- [ ] Public production MCP URL is reachable; approved template rules are used only if applicable.
- [ ] Exact domain challenge token is live at the well-known endpoint.
- [ ] OAuth/reviewer credentials work without MFA or private-network dependencies.
- [ ] Current **Scan Tools** result succeeds; annotation and external-frame-domain justifications are complete.
- [ ] Demo recording, exactly 5 positive tests, 3 negative tests, release notes, regions, and attestations are ready.
- [ ] Skill scans pass; submit for review, then publish the approved version separately.
