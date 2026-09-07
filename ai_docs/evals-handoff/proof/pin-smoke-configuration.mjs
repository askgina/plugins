// Temporary verification aid: pins the synthetic smoke configuration created by
// create-smoke-inputs.mjs to the compiled evaluator, toolchain and run
// settings of this checkout. It writes only <output-root>/private/
// configuration.json and the four *-identity.json component records. Nothing
// here attests a provider or constitutes measured evidence. Not executed proof
// and not a product API. Remove after the remote proof run is recorded.
// Requires built packages/evals/dist and packages/contracts/dist.
//
// Usage: bun ai_docs/evals-handoff/proof/pin-smoke-configuration.mjs <output-root>
// Pass the same output root given to create-smoke-inputs.mjs.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const outputRoot = process.argv[2];
if (!outputRoot) {
  console.error("Usage: pin-smoke-configuration.mjs <output-root>");
  process.exit(2);
}
const root = await realpath(resolve(outputRoot));
const directory = `${root}/private`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = async (path) => digest(await readFile(path));
const record = async (name, value) => {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(`${directory}/${name}.json`, bytes, { mode: 0o600 });
  return digest(bytes);
};
const files = {};
for (const relativeDirectory of ["packages/evals/dist", "packages/evals/dist/bin", "packages/contracts/dist"]) {
  for (const name of (await readdir(`${repository}/${relativeDirectory}`)).sort()) {
    if (!name.endsWith(".js")) continue;
    const path = `${relativeDirectory}/${name}`;
    files[path] = await fileHash(`${repository}/${path}`);
  }
}
const suiteSha256 = await fileHash(`${repository}/packages/evals/src/fixtures/model-smoke.yaml`);
const observationsSha256 = await fileHash(`${repository}/packages/evals/src/fixtures/synthetic-observations.yaml`);
const configuration = JSON.parse(await readFile(`${directory}/configuration.json`, "utf8"));
const identity = {
  evaluatorSha256: await record("evaluator-identity", { dataOrigin: "synthetic", kind: "compiled_evaluator", files }),
  skillsSha256: await record("skills-identity", { dataOrigin: "synthetic", availability: "not_applicable", reason: "Hermetic fixture replay does not load plugin skills." }),
  toolchainSha256: await record("toolchain-identity", { dataOrigin: "synthetic", bunVersion: Bun.version, bunExecutableSha256: await fileHash(process.execPath), lockfileSha256: await fileHash(`${repository}/bun.lock`) }),
  runSettingsSha256: await record("run-settings-identity", {
    dataOrigin: "synthetic", runner: "hermetic_replay", network: false,
    suiteSha256, observationsSha256, captureAttempts: true, timeoutMs: null,
    candidate: configuration.candidate, target: configuration.target, model: configuration.model,
    reasoning: configuration.reasoning, suiteId: configuration.suiteId,
    suiteVersion: configuration.suiteVersion, fixtureVersion: configuration.fixtureVersion,
    catalogSha: configuration.catalogSha, ...configuration.settings,
  }),
};
await record("configuration", { ...configuration, identity });
console.log(JSON.stringify({ dataOrigin: "synthetic", identity, attestsProvider: false, measuredEvidence: false }));
