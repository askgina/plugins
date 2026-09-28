import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Effect, FileSystem } from "effect";
import { createHash } from "node:crypto";
const fs = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer)));
const read = (file) => Effect.runPromise(fs.readFile(file));
const readJson = (file) => Effect.runPromise(fs.readFileString(file).pipe(Effect.map(JSON.parse)));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const here = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const output = process.argv[2];
if (!output) throw Error("Output directory required");
const base = "/home/ubuntu/askgina-opus55-20260922";
const { checkPriceAnswer, MARKETS, PRICE, PRICES, ASSET } = await import(
  base + "/source/packages/evals/src/perps-price.ts"
);
const revised = await import(here + "/perps-price.ts");
const entries = [];
const plan = await readJson(base + "/plan.json");
const counts = {
  reviewed: 0,
  originalPass: 0,
  correctedPass: 0,
  effectivePassAdded: 0,
  byEffort: {},
};
for (const item of plan) {
  const dir = base + "/results/run/" + item.slot;
  const t = await readJson(dir + "/terminal.json");
  if (!t.priceGrounding) continue;
  const native = await readJson(dir + "/" + t.attemptEvidence + "/native.json");
  const records = native.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const calls = [],
    results = new Map();
  for (const event of records) {
    if (!Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (event.type === "assistant" && block.type === "tool_use") {
        const name = [MARKETS, PRICE, PRICES, ASSET].find(
          (n) => block.name === "mcp__ask-gina__" + n.replace(/[^a-zA-Z0-9_-]/g, "_"),
        );
        if (name) calls.push({ id: block.id, name, arguments: block.input });
      }
      if (event.type === "user" && block.type === "tool_result")
        results.set(
          block.tool_use_id,
          block.is_error ? { isError: true } : { content: block.content },
        );
    }
  }
  const evidence = calls.map((c) => ({ ...c, result: results.get(c.id) }));
  const mode = {
    "perps-single-price": "single_mark",
    "perps-multiple-prices": "multiple_marks",
    "perps-hip3-price": "hip3_price",
  }[t.caseId];
  if (mode === undefined) throw Error("Unknown price case");
  const old = checkPriceAnswer(evidence, mode, t.observation.final_answer ?? "");
  if (old.score !== t.priceGrounding.score) throw Error("Original grade not reproduced");
  const corrected = revised.checkPriceAnswer(evidence, mode, t.observation.final_answer ?? "");
  entries.push({
    caseId: t.caseId,
    reasoning: t.reasoning,
    repetition: t.repetition,
    terminalSha256: sha(await read(dir + "/terminal.json")),
    nativeSha256: t.nativeSha256,
    originalPriceScore: old.score,
    correctedPriceScore: corrected.score,
    nativePass: t.score.overall_pass,
    originalPass: t.overallPass,
    correctedPass: t.score.overall_pass && corrected.score === 1,
  });
  counts.reviewed++;
  counts.originalPass += old.score;
  counts.correctedPass += corrected.score;
  const delta = Number(t.score.overall_pass && corrected.score === 1) - Number(t.overallPass);
  counts.effectivePassAdded += delta;
  counts.byEffort[t.reasoning] = (counts.byEffort[t.reasoning] ?? 0) + delta;
}
if (entries.length !== 45) throw Error("Unexpected price coverage");
const receipt = {
  schemaVersion: "ask-gina-price-envelope-revision.v1",
  policyId: "perps-price-evidence-v2-claude-envelope-v1",
  campaignId: "opus55-20260922",
  scope: "retained-price-evidence-only",
  modelReruns: 0,
  rawEvidenceUnchanged: true,
  originalGraderSha256: sha(await read(base + "/source/packages/evals/src/perps-price.ts")),
  correctedGraderSha256: sha(await read(here + "/perps-price.ts")),
  priceClaimsSha256: sha(await read(here + "/price-claims.ts")),
  exporterSha256: sha(await read(new URL(import.meta.url).pathname)),
  counts,
  entries,
};
await Effect.runPromise(fs.makeDirectory(output, { recursive: false }));
await Effect.runPromise(
  fs.writeFileString(
    output + "/price-envelope-revision.json",
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx" },
  ),
);
await Effect.runPromise(Effect.logInfo(JSON.stringify(counts)));
