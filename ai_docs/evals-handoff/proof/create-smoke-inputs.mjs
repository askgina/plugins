// Temporary verification aid: creates synthetic exporter smoke inputs under
// <output-root>/private, including intentionally invalid rejection inputs.
// None is measured evidence or a provider attestation. Not executed proof or a
// product API. Remove after the remote proof run is recorded. Requires a built
// packages/contracts/dist (bun run --filter @askgina/contracts build).
//
// Usage: bun ai_docs/evals-handoff/proof/create-smoke-inputs.mjs <output-root>
// Choose an output root outside the repository checkout. An existing private/
// directory is rejected; inputs are created exclusively, never overwritten.
import { createHash } from "node:crypto";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = new URL("../../../", import.meta.url);
const { catalogSha } = await import(new URL("packages/contracts/dist/index.js", repositoryRoot).href);

const outputRoot = process.argv[2];
if (!outputRoot) {
  console.error("Usage: create-smoke-inputs.mjs <output-root>");
  process.exit(2);
}
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const root = await realpath(resolve(outputRoot));
const directory = `${root}/private`;
await mkdir(directory, { mode: 0o700 });
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const save = (name, value) => writeFile(`${directory}/${name}.json`, encode(value), { flag: "wx", mode: 0o600 });
const hash = (value) => createHash("sha256").update(encode(value)).digest("hex");
const publishedAt = new Date().toISOString();
// These provenance values come from checked-in fixture metadata and the built
// contracts catalog, never from the report being adapted.
const expectedProvenance = { suiteId: "synthetic-model-smoke-v1", suiteVersion: 1, fixtureVersion: 1, catalogSha };
const configuration = {
  schemaVersion: "eval-configuration.v1", candidate: "synthetic-fixture-candidate-v1",
  model: "fixture-model", target: "fixture", reasoning: "deterministic", ...expectedProvenance,
  settings: { cleanChat: true, accountClass: "synthetic", repetitions: 1 },
};
const plan = { dataOrigin: "synthetic", plannedCases: 4, plannedAttempts: 4 };
const status = { dataOrigin: "synthetic", observedCases: 3, observedAttempts: 3, complete: false };
const result = (name) => ({
  schemaVersion: "eval-export-request.v1", kind: "result",
  publicationId: `synthetic-${name}`, revisionId: `synthetic-${name}-r1`, revision: 1,
  dataOrigin: "synthetic", publishedAt, review: { status: "synthetic_preview" },
  supersedes: null, resultId: `synthetic-${name}-result`, expectedProvenance,
});
await save("configuration", configuration);
await save("coverage-plan", plan);
await save("coverage-status", status);
await save("aggregate-r1", result("aggregate"));
await save("aggregate-r2", {
  ...result("aggregate"), revisionId: "synthetic-aggregate-r2", revision: 2,
  supersedes: { revisionId: "synthetic-aggregate-r1", revision: 1, reason: "correction", summary: "Attach the separately declared synthetic configuration. Scores are unchanged." },
});
await save("detailed-r1", result("detailed"));
await save("withheld-r1", { ...result("withheld"), withholdAttempts: true });
await save("incomplete-r1", {
  ...result("incomplete"),
  declaredCoverage: { plannedCases: 4, plannedAttempts: 4, planSha256: hash(plan), statusSha256: hash(status) },
});
await save("aggregate-withdrawal-r3", {
  schemaVersion: "eval-export-request.v1", kind: "withdrawal",
  publicationId: "synthetic-aggregate", revisionId: "synthetic-aggregate-r3", revision: 3,
  dataOrigin: "synthetic", publishedAt, review: { status: "synthetic_preview" },
  supersedes: { revisionId: "synthetic-aggregate-r2", revision: 2, reason: "withdrawal", summary: "Synthetic privacy-withdrawal proof." },
  notice: { reason: "privacy", withdrawnAt: publishedAt, notice: "Synthetic example withdrawn. Previous public snapshot bytes were removed." },
});
await save("reject-unknown-field", { ...result("rejected"), privateMarker: "SYNTHETIC_REJECTION_MARKER" });
await save("reject-measured-preview", { ...result("rejected-measured"), dataOrigin: "measured" });
console.log(JSON.stringify({ directory, expectedProvenance, dataOrigin: "synthetic", measuredEvidence: false }));
