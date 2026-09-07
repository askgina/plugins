// Temporary verification aid: decodes the nine synthetic planning fixtures
// with the built contracts package. Not executed proof and not a product API.
// Remove after the remote proof run is recorded. Requires a built
// packages/contracts/dist (bun run --filter @askgina/contracts build).
import { Effect } from "effect";
import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../../../", import.meta.url);
const fixturesRoot = new URL("../planning/fixtures/", import.meta.url);
const Contracts = await import(new URL("packages/contracts/dist/index.js", repositoryRoot).href);

const names = [
  "synthetic-attempt-capture",
  "synthetic-result-aggregate-only",
  "synthetic-result-detailed",
  "synthetic-result-incomplete-coverage",
  "synthetic-result-unavailable-withheld",
  "synthetic-publication-correction-rev1",
  "synthetic-publication-correction-rev2",
  "synthetic-publication-withdrawal-notice",
  "synthetic-index",
];
const decoders = {
  "eval-attempts.v1": Contracts.decodePublicEvalAttemptCapture,
  "eval-result.v1": Contracts.decodePublicEvalResult,
  "eval-publication.v1": Contracts.decodePublicEvalPublication,
  "eval-index.v1": Contracts.decodePublicEvalIndex,
};
for (const name of names) {
  const value = JSON.parse(await readFile(new URL(`${name}.json`, fixturesRoot), "utf8"));
  const decode = decoders[value.schemaVersion];
  if (!decode) throw new Error(`Unsupported fixture schema: ${name}`);
  await Effect.runPromise(decode(value));
  if (value.schemaVersion !== "eval-attempts.v1" && value.dataOrigin !== "synthetic") throw new Error(`Unlabeled fixture: ${name}`);
  console.log(`PASS ${name}`);
}
console.log("Validated all nine synthetic contract examples. Source hashes in these examples are illustrative; CLI proof artifacts are separate.");
