import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export function lpExamples(source) {
  const entries = [
    ...source.matchAll(/\{\/\* lp-example: ([\w-]+) \*\/\}\s*```json\s*([\s\S]*?)```/g),
  ];
  const examples = {};
  for (const [, id, json] of entries) {
    if (Object.hasOwn(examples, id)) throw new Error(`Duplicate LP example: ${id}`);
    examples[id] = JSON.parse(json);
  }
  return examples;
}
export function validateLpContract(root) {
  const errors = [];
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(root, "../tools/docs/lp-contract.snapshot.json"), "utf8"),
  );
  const features = fs.readFileSync(path.join(root, "spot-mcp/features.mdx"), "utf8");
  const listed = [...features.matchAll(/^\| `([^`]+)`\s*\|/gm)].map((match) => match[1]);
  if (!isDeepStrictEqual([...listed].sort(), [...snapshot.nativeTools].sort()))
    errors.push("Spot native inventory differs from the generated application snapshot.");
  const guide = fs.readFileSync(path.join(root, "spot-mcp/liquidity-positions.mdx"), "utf8");
  if (!guide.includes(snapshot.revision))
    errors.push("LP guide revision differs from the verified snapshot.");
  try {
    if (!isDeepStrictEqual(lpExamples(guide), snapshot.validatedExamples))
      errors.push(
        "LP examples changed: refresh against the pinned application schemas before publishing.",
      );
  } catch (error) {
    errors.push(`Invalid LP example: ${error.message}`);
  }
  for (const file of fs
    .readdirSync(path.join(root, "spot-mcp"))
    .filter((name) => name.endsWith(".mdx"))) {
    const text = fs.readFileSync(path.join(root, "spot-mcp", file), "utf8");
    if (
      /\b29\s+(?:native\s+)?(?:Spot\s+)?tools\b|getSwapCalldatas|getTransferCalldata|executeSupertransaction/.test(
        text,
      )
    )
      errors.push(`Retired Spot inventory reference: ${file}`);
  }
  return errors;
}
