import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { linksIn, resolveRoute, validateDocs, validateCorpusBody } from "./check.mjs";

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gina-docs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "mint.json"),
    JSON.stringify({
      topbarCtaButton: { name: "Open Gina" },
      navigation: [{ group: "Start", pages: ["index"] }],
      ...options,
    }),
  );
  fs.writeFileSync(path.join(root, "index.mdx"), '---\ntitle: "Home"\ndescription: "Start"\n---\n');
  return root;
}
test("checks component links across lines and ignores fenced examples", () => {
  assert.deepEqual(
    linksIn('<Card\n href="/missing" />\n```mdx\n<Card href="/example" />\n```').map((x) => x.href),
    ["/missing"],
  );
});
test("detects broken card and image links, and missing alt text", (t) => {
  const root = fixture(t);
  fs.appendFileSync(
    path.join(root, "index.mdx"),
    '<Card href="/missing" /><img src="/missing.png" />',
  );
  const errors = validateDocs(root).errors;
  assert.equal(errors.filter((x) => x.startsWith("Broken link")).length, 2);
  assert.ok(errors.some((x) => x.startsWith("Image needs alt")));
});
test("requires an index for directories and rejects path traversal", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "empty"));
  assert.equal(resolveRoute(root, "/empty"), undefined);
  assert.equal(resolveRoute(root, "/../outside.mdx"), undefined);
});
test("catches duplicate nested navigation and published redirect sources", (t) => {
  const root = fixture(t, {
    navigation: [{ group: "A", pages: ["index", { group: "B", pages: ["index"] }] }],
    redirects: [{ source: "/index", destination: "/absent" }],
  });
  const errors = validateDocs(root).errors;
  assert.ok(errors.some((x) => x.startsWith("Duplicate navigation")));
  assert.ok(errors.some((x) => x.startsWith("Redirect source still")));
  assert.ok(errors.some((x) => x.startsWith("Missing redirect destination")));
});
test("rejects redirect cycles and orphan content that agents could retrieve", (t) => {
  const root = fixture(t, {
    redirects: [
      { source: "/old", destination: "/older" },
      { source: "/older", destination: "/old" },
    ],
  });
  fs.writeFileSync(path.join(root, "orphan.mdx"), "---\ntitle: Orphan\ndescription: Old\n---");
  const errors = validateDocs(root).errors;
  assert.ok(errors.some((x) => x.startsWith("Redirect chain or cycle")));
  assert.ok(errors.some((x) => x.startsWith("Page is not in navigation")));
});
test("checks first-party absolute URLs locally before deployment", (t) => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "index.mdx"), "[New page](https://docs.askgina.ai/new-page)");
  assert.ok(validateDocs(root).errors.some((x) => x.includes("/new-page")));
});

test("corpus rejects rich MDX but accepts Markdown images and matching H1", () => {
  const front =
    '---\ntitle: "Guide"\ndescription: "Guide"\nowner: "Team"\nkind: "guide"\nlastReviewed: "2026-09-06"\nincludeInDocsAgent: true\nrelatedSlugs:\n  - overview\n---\n\n# Guide\n\n';
  assert.deepEqual(validateCorpusBody(front + "![Description](/image.png)", "guide"), []);
  assert.ok(
    validateCorpusBody(front + "<Frame>Image</Frame>", "guide").some((x) =>
      x.includes("plain Markdown"),
    ),
  );
  assert.ok(
    validateCorpusBody(front.replace("# Guide", "# Wrong"), "guide").some((x) => x.includes("H1")),
  );
});
