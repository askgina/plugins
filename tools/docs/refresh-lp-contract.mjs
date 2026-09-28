// Extract only schema initializers from committed application source. Never load tool runtimes.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript-api";
import { lpExamples } from "./lp-contract.mjs";

const app = path.resolve(process.argv[2] ?? "../gina-application");
const revision = process.argv[3];
if (!/^[a-f0-9]{40}$/.test(revision ?? ""))
  throw new Error(
    "Usage: node tools/docs/refresh-lp-contract.mjs /path/to/application <40-character-commit>",
  );
const git = (...args) => execFileSync("git", ["-C", app, ...args], { encoding: "utf8" });
const requireApp = createRequire(path.join(app, "package.json"));
const { z } = requireApp("zod");
const sources = new Map();
const values = new Map();
const hashes = {};
function source(file) {
  if (sources.has(file)) return sources.get(file);
  if (file.startsWith("/") || file.split("/").includes("..")) throw new Error("Unsafe source path");
  const text = git("show", `${revision}:${file}`);
  hashes[file] = createHash("sha256").update(text).digest("hex");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const bindings = new Map();
  for (const node of ast.statements) {
    if (ts.isVariableStatement(node))
      for (const decl of node.declarationList.declarations)
        if (ts.isIdentifier(decl.name) && decl.initializer)
          bindings.set(decl.name.text, { expression: decl.initializer });
    if (ts.isImportDeclaration(node)) {
      const imports = node.importClause?.namedBindings;
      if (imports && ts.isNamedImports(imports))
        for (const item of imports.elements)
          bindings.set(item.name.text, {
            module: node.moduleSpecifier.text,
            name: item.propertyName?.text ?? item.name.text,
          });
    }
  }
  const result = { ast, bindings };
  sources.set(file, result);
  return result;
}
function resolveImport(file, module) {
  const base = module.startsWith("@/")
    ? module.slice(2)
    : module.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), module))
      : undefined;
  if (!base) throw new Error(`Non-schema dependency: ${module}`);
  return base + ".ts";
}
function value(file, name) {
  const key = `${file}:${name}`;
  if (values.has(key)) return values.get(key);
  const { ast, bindings } = source(file);
  const binding = bindings.get(name);
  if (!binding) throw new Error(`Missing declaration ${key}; review the extractor`);
  let result;
  if (binding.module) {
    result =
      binding.module === "zod" && binding.name === "z"
        ? z
        : value(resolveImport(file, binding.module), binding.name);
  } else {
    const dependencies = new Set();
    const visit = (node) => {
      // Property names are not lexical references.
      if (
        ts.isIdentifier(node) &&
        bindings.has(node.text) &&
        node.text !== name &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      )
        dependencies.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(binding.expression);
    const context = Object.fromEntries([...dependencies].map((dep) => [dep, value(file, dep)]));
    const expression = ts.transpileModule(`(${binding.expression.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    result = vm.runInNewContext(expression, context, { timeout: 1000 });
  }
  values.set(key, result);
  return result;
}
const toolFile = (name) => `app/actions/wallet/tools/${name}/index.ts`;
const bindings = {
  getLpPositions: ["lib/lp/inventory-contracts.ts", "getLpPositionsPageInputSchema"],
  getSolanaLpPositions: [toolFile("getSolanaLpPositions"), "inputSchema"],
  quoteLpOperation: [toolFile("quoteLpOperation"), "inputSchema"],
  quoteSolanaLpOperation: [toolFile("quoteSolanaLpOperation"), "inputSchema"],
  getLpOperationStatus: [toolFile("executeLpOperation"), "statusInputSchema"],
  getSolanaLpOperationStatus: [toolFile("executeSolanaLpOperation"), "statusInputSchema"],
};
const examplesToTools = {
  "evm-read": ["getLpPositions"],
  "solana-read": ["getSolanaLpPositions"],
  "evm-increase": ["quoteLpOperation"],
  "clmm-increase": ["quoteSolanaLpOperation"],
  "cpmm-deposit": ["quoteSolanaLpOperation"],
  unresolved: ["getLpOperationStatus", "getSolanaLpOperationStatus"],
};
const schemas = Object.fromEntries(
  Object.entries(bindings).map(([name, args]) => [name, value(...args)]),
);
const examples = lpExamples(fs.readFileSync("docs/spot-mcp/liquidity-positions.mdx", "utf8"));
if (Object.keys(examples).sort().join() !== Object.keys(examplesToTools).sort().join())
  throw new Error("Example set changed; update schema bindings deliberately");
let addressIndex = 1;
const substitutions = new Map();
function substitute(input, solana) {
  if (Array.isArray(input)) return input.map((item) => substitute(item, solana));
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, substitute(item, solana)]),
    );
  if (typeof input !== "string" || !/^<[^>]+>$/.test(input)) return input;
  if (input === "<position-token-id>") return "1";
  if (!substitutions.has(input)) {
    // Synthetic schema fixtures only: never sent to a provider or shown as usable addresses.
    substitutions.set(
      input,
      solana
        ? "1".repeat(31) + "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[(addressIndex++ - 1) % 31]
        : "0x" + (addressIndex++).toString(16).padStart(40, "0"),
    );
  }
  return substitutions.get(input);
}
for (const [id, example] of Object.entries(examples)) {
  for (const name of examplesToTools[id]) {
    const parsed = schemas[name].safeParse(substitute(example, name.includes("Solana")));
    if (!parsed.success) throw new Error(`${id}: ${parsed.error.message}`);
    if (id === "evm-increase") {
      const v4 = structuredClone(substitute(example, false));
      v4.position.protocol = "uniswap-v4";
      schemas[name].parse(v4);
    }
  }
}
// Reading the registry records the source linking native registrations to this allowlist.
const registry = git("show", `${revision}:lib/mcp/spot-tool-registry.ts`);
if (!registry.includes("SPOT_HOST_TOOLS_ALLOWLIST.map((name)"))
  throw new Error("Native registry changed; review registration before refreshing");
hashes["lib/mcp/spot-tool-registry.ts"] = createHash("sha256").update(registry).digest("hex");
const inventory = Array.from(value("lib/ai/sandbox/skills/index.ts", "SPOT_HOST_TOOLS_ALLOWLIST"));
const snapshot = {
  sourceRepository: "Gina application (private)",
  revision,
  zodVersion: requireApp("zod/package.json").version,
  sourceHashes: hashes,
  nativeTools: inventory,
  schemaBindings: bindings,
  inputSchemas: Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: "input" }),
    ]),
  ),
  examplesToTools,
  validatedExamples: examples,
  validation:
    "Actual source Zod safeParse with synthetic placeholder substitutions; no runtime, admission, balance or execution validation. Refinements are checked during refresh, not represented fully by JSON Schema.",
};
fs.writeFileSync("tools/docs/lp-contract.snapshot.json", JSON.stringify(snapshot, null, 2) + "\n");
execFileSync(
  path.resolve("node_modules/.bin/vp"),
  ["fmt", "--write", "tools/docs/lp-contract.snapshot.json"],
  { stdio: "inherit" },
);
console.log(
  `Extracted ${inventory.length} native tools; validated ${Object.keys(examples).length} templates at ${revision}.`,
);
