import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function filesUnder(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(path.join(root, entry.name)) : [path.join(root, entry.name)],
    );
}
export function navPages(entries) {
  return (entries ?? []).flatMap((entry) =>
    typeof entry === "string" ? [entry] : navPages(entry.pages),
  );
}
export function resolveRoute(root, route) {
  const clean = decodeURIComponent(route.split(/[?#]/)[0]).replace(/^\/+/, "");
  const base = path.resolve(root, clean);
  if (base !== path.resolve(root) && !base.startsWith(path.resolve(root) + path.sep))
    return undefined;
  return [
    base,
    base + ".mdx",
    base + ".md",
    path.join(base, "index.mdx"),
    path.join(base, "index.md"),
  ].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}
export function linksIn(source) {
  const text = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  return [
    ...[...text.matchAll(/!?\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((m) => ({
      href: m[2],
      image: m[0].startsWith("!"),
      alt: m[1],
    })),
    ...[...text.matchAll(/<([A-Za-z][\w.]*)\b([^>]*?)\/?\s*>/gs)].flatMap((m) => {
      const attrs = [...m[2].matchAll(/\b(href|src|alt)\s*=\s*["']([^"']*)["']/g)];
      return attrs
        .filter((a) => a[1] !== "alt")
        .map((a) => ({
          href: a[2],
          image: a[1] === "src",
          alt: attrs.find((v) => v[1] === "alt")?.[2],
        }));
    }),
  ];
}
export function validateDocs(root) {
  const errors = [];
  const external = new Set();
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "mint.json"), "utf8"));
  const pages = navPages(cfg.navigation);
  if (cfg.tabs?.length) errors.push("Topic tabs must not split the sidebar.");
  if (cfg.topbarLinks?.length || cfg.topbarCtaButton?.name !== "Open Gina")
    errors.push("Header must have one Open Gina action.");
  const seen = new Set();
  for (const route of pages) {
    const file = resolveRoute(root, route);
    if (!file) errors.push(`Missing navigation page: ${route}`);
    else if (seen.has(file)) errors.push(`Duplicate navigation page: ${route}`);
    else seen.add(file);
  }
  const redirects = new Map();
  for (const { source, destination } of cfg.redirects ?? []) {
    if (!source?.startsWith("/") || !destination?.startsWith("/"))
      errors.push(`Invalid redirect: ${source}`);
    if (redirects.has(source)) errors.push(`Duplicate redirect: ${source}`);
    if (resolveRoute(root, source))
      errors.push(`Redirect source still has published content: ${source}`);
    redirects.set(source, destination);
  }
  for (const [source, destination] of redirects) {
    if (redirects.has(destination))
      errors.push(`Redirect chain or cycle: ${source} → ${destination}`);
    if (!resolveRoute(root, destination))
      errors.push(`Missing redirect destination: ${destination}`);
  }
  const files = filesUnder(root).filter((file) => /\.mdx?$/.test(file));
  const images = new Set();
  for (const file of files) {
    const relative = path.relative(root, file);
    if (/target-registry|kill-switch|moderation-runbook/i.test(relative))
      errors.push(`Internal-only content: ${relative}`);
    if (!seen.has(path.resolve(file))) errors.push(`Page is not in navigation: ${relative}`);
    const source = fs.readFileSync(file, "utf8");
    if (!/^---\n[\s\S]*?\ntitle:|^---\ntitle:/m.test(source) || !/^description:\s*.+/m.test(source))
      errors.push(`Missing page title/description: ${relative}`);
    if (/bunx add-mcp|clawhub install|\.claude\/settings\.json/.test(source))
      errors.push(`Retired installation instructions: ${relative}`);
    for (const link of linksIn(source)) {
      if (!link.href || /^(#|mailto:|tel:|data:)/.test(link.href)) continue;
      let href = link.href;
      if (/^https?:\/\//.test(href)) {
        const url = new URL(href);
        if (url.hostname === "docs.askgina.ai" && !/\/llms(?:-full)?\.txt$/.test(url.pathname))
          href = url.pathname;
        else {
          external.add(href);
          continue;
        }
      }
      if (link.image && !link.alt?.trim())
        errors.push(`Image needs alt text: ${relative}: ${href}`);
      const route = href.startsWith("/")
        ? href
        : "/" +
          path.posix.join(path.relative(root, path.dirname(file)).split(path.sep).join("/"), href);
      if (redirects.has(route))
        errors.push(`Internal link uses retired route: ${relative}: ${route}`);
      const target = resolveRoute(root, route);
      if (!target) errors.push(`Broken link: ${relative}: ${href}`);
      else if (link.image) {
        images.add(path.resolve(target));
        if (/\.mdx?$/.test(target)) errors.push(`Image points to a page: ${relative}: ${href}`);
        if (fs.statSync(target).size > 1_000_000) errors.push(`Image exceeds 1 MB: ${href}`);
      }
    }
  }
  const imageRoot = path.join(root, "images");
  if (fs.existsSync(imageRoot))
    for (const file of filesUnder(imageRoot)) {
      if (/\.(png|jpe?g|webp|svg)$/.test(file) && !images.has(path.resolve(file)))
        errors.push(`Unused image: ${path.relative(root, file)}`);
    }
  return { errors, external: [...external], pages: files.length, images: images.size };
}

export function validateCorpusBody(source, slug) {
  const errors = [];
  const [, front = "", ...parts] = source.split("---");
  const body = parts.join("---");
  const title = front.match(/^title: "([^\n"]+)"$/m)?.[1];
  if (!body.trim().startsWith("# " + title + "\n"))
    errors.push(`Corpus title must match its H1: ${slug}`);
  const keys = [...front.matchAll(/^(\w+):/gm)].map((m) => m[1]).sort();
  if (
    keys.join(",") !== "description,includeInDocsAgent,kind,lastReviewed,owner,relatedSlugs,title"
  )
    errors.push(`Unexpected corpus frontmatter keys: ${slug}`);
  if (/^includeInDocsAgent: true$/m.test(front)) {
    const plain = body
      .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/<(?:https?:\/\/[^\s>]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g, "");
    if (
      /^\s*(?:import(?:\s|["'{(.])|export(?:\s|[{*]))/m.test(plain) ||
      /(?:<\/?[A-Za-z][A-Za-z0-9._:-]*(?:\s+[^>]*)?\/?>|<\/?>)/.test(plain) ||
      /\{[\s\S]*?\}/.test(plain)
    )
      errors.push(`Corpus requires plain Markdown: ${slug}`);
  }
  return errors;
}

export function validateGina(root) {
  const errors = [];
  const repo = path.dirname(root);
  const read = (name) => fs.readFileSync(path.join(root, name + ".mdx"), "utf8");
  const plugin = JSON.parse(fs.readFileSync(path.join(repo, "plugins/ask-gina/.mcp.json"), "utf8"));
  const url = plugin.mcpServers["ask-gina"].url;
  const access = read("mcp-access/index");
  if (
    url !== "https://askgina.ai/ai/gina/mcp" ||
    !access.includes("`" + url + "`") ||
    !access.includes("`tools:read`")
  )
    errors.push("Read-only endpoint/scope drift.");
  for (const venue of ["spot", "predictions", "perps"]) {
    const endpoint = `https://askgina.ai/ai/${venue}/mcp`;
    if (
      !access.includes(endpoint) ||
      !read(`${venue}-mcp/client-setup`).includes(endpoint) ||
      !read(`${venue}-mcp/client-setup`).includes("tools:execute")
    )
      errors.push(`Write endpoint/scope drift: ${venue}`);
  }
  const catalog =
    fs
      .readFileSync(path.join(repo, "packages/contracts/src/index.ts"), "utf8")
      .split("export const GINA_READ_TOOL_CATALOG = [")[1]
      ?.split("] as const")[0] ?? "";
  const names = [...catalog.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
  const reference = read("mcp-access/gina-read");
  if (!names.length) errors.push("Read tool catalog could not be inspected.");
  for (const name of names)
    if (!reference.includes("`" + name + "`"))
      errors.push(`Missing read tool in reference: ${name}`);
  const listed = [...reference.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  for (const name of listed)
    if (!names.includes(name)) errors.push(`Unknown read tool in reference: ${name}`);
  const auth = read("agents/authentication");
  if (!auth.includes("Read-only — view data") || !auth.includes("Full access — view and execute"))
    errors.push("Authentication guide must match app access labels.");
  const skills = fs.readdirSync(path.join(repo, "plugins/ask-gina/skills"));
  for (const skill of skills)
    if (!read("agents/plugins-and-skills").includes("`" + skill + "`"))
      errors.push(`Undocumented skill: ${skill}`);

  // Preserve the chatbot's eight maintained corpus routes and reciprocal relatedSlugs.
  const corpus = [
    "index",
    "wallet-and-account",
    "transactions-and-portfolio",
    "market-research",
    "recipes-and-webhooks",
    "memory",
    "networks-fees-and-pricing",
    "safety-support-and-limitations",
  ];
  const relations = new Map();
  const corpusParts = [];
  for (const slug of corpus) {
    const source = read("product-guide/" + slug);
    const front = source.split("---")[1] ?? "";
    errors.push(...validateCorpusBody(source, slug));
    for (const key of ["owner", "kind", "lastReviewed", "includeInDocsAgent", "relatedSlugs"])
      if (!new RegExp("^" + key + ":", "m").test(front))
        errors.push(`Missing corpus metadata ${key}: ${slug}`);
    if (!/^includeInDocsAgent: (true|false)$/m.test(front))
      errors.push(`Invalid corpus inclusion: ${slug}`);
    if (!/^kind: "?(guide|policy|reference)"?$/m.test(front))
      errors.push(`Invalid corpus kind: ${slug}`);
    const date = front.match(/^lastReviewed: "?(\d{4}-\d{2}-\d{2})"?$/m)?.[1];
    if (
      !date ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      errors.push(`Invalid review date: ${slug}`);
    if (/^includeInDocsAgent: true$/m.test(front))
      corpusParts.push(
        `Canonical source: https://docs.askgina.ai/product-guide${slug === "index" ? "" : "/" + slug}\nReviewed: ${date}\n\n${source.split("---").slice(2).join("---").trim()}`,
      );
    relations.set(
      slug === "index" ? "overview" : slug,
      [...(front.split("relatedSlugs:")[1] ?? "").matchAll(/^  - (.+)$/gm)].map((m) => m[1]),
    );
  }
  for (const [slug, related] of relations)
    for (const other of related) {
      if (other === slug || !relations.get(other)?.includes(slug))
        errors.push(`Broken corpus relationship: ${slug} ↔ ${other}`);
    }
  const corpusLength = corpusParts.join("\n\n---\n\n").length;
  if (corpusLength > 12_000)
    errors.push(`Chatbot corpus exceeds 12000 characters: ${corpusLength}`);
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  for (const rule of [
    "Content-Signal: ai-train=no, search=yes, ai-input=yes",
    "Sitemap: https://docs.askgina.ai/sitemap.xml",
    ...["GPTBot", "ClaudeBot", "DeepSeekBot", "Google-Extended", "Applebot-Extended"].map(
      (bot) => `User-agent: ${bot}\nDisallow: /`,
    ),
  ])
    if (!robots.includes(rule)) errors.push(`Missing crawler policy: ${rule}`);
  return errors;
}

async function checkExternal(urls) {
  const errors = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < urls.length) {
        const url = urls[index++];
        try {
          let result = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
          if ([403, 405, 501].includes(result.status))
            result = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (
            result.status === 403 &&
            url ===
              "https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors"
          ) {
            // Primary guide verified 2026-09-06; the host blocks non-browser requests.
            // See ai_docs/docs-host-verification.md. Other statuses still fail.
            console.warn(`External URL requires browser verification (known HTTP 403): ${url}`);
          } else if (!result.ok) errors.push(`External URL ${result.status}: ${url}`);
        } catch (error) {
          errors.push(`External URL unreachable: ${url} (${error.message})`);
        }
      }
    }),
  );
  return errors;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve("docs");
  const result = validateDocs(root);
  result.errors.push(...validateGina(root));
  if (process.argv.includes("--external"))
    result.errors.push(...(await checkExternal(result.external)));
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Validated ${result.pages} pages, ${result.images} images, navigation, redirects, access, skills, and corpus metadata${process.argv.includes("--external") ? ", plus external URLs" : ""}.`,
    );
}
