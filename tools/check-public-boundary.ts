#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { findPublicTextViolations } from "../packages/evals/src/index.js";
import { Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { extractCheckedTarGz } from "./archive-security.js";

const HOSTS = ["openai", "cursor", "claude", "copilot", "gemini"];
const PACKAGES = [
  { slug: "contracts", name: "@askgina/contracts", directory: "packages/contracts" },
  { slug: "sdk", name: "@askgina/sdk", directory: "packages/sdk" },
  { slug: "cli", name: "@askgina/cli", directory: "packages/cli" },
  { slug: "plugin-core", name: "@askgina/plugin-core", directory: "plugins/ask-gina" },
  { slug: "evals", name: "@askgina/evals", directory: "packages/evals" },
];
const MAX_FINDINGS = 100;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const PRIVATE_ALIAS = ["@", "/"].join("");
const PRIVATE_REPOSITORY = ["nextjs", "-ai-chatbot"].join("");
const PRIVATE_REGISTRY = ["gina-tool", "-registry"].join("");
const PRIVATE_REGISTRY_FIELD = ["factory", "Key"].join("");
const FORBIDDEN_RUNTIME = ["@effect/platform", "-node"].join("");
const PRIVATE_CACHE = ["red", "is"].join("");
const RAW_EVAL_FIELDS = new RegExp(
  `"(?:${[
    "observations",
    "prompt",
    "prompts",
    "toolCalls",
    "tool_calls",
    "payload",
    "payloads",
    "model",
    "models",
    "account",
    "accounts",
    "address",
    "addresses",
    "final_answer",
    "report",
  ].join("|")})"\\s*:`,
  "iu",
);

type Finding = Readonly<{ readonly rule: string; readonly path: string }>;
type PackageDefinition = (typeof PACKAGES)[number];

export class PublicBoundaryError extends Data.TaggedError("PublicBoundaryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message: string, cause?: unknown) =>
  new PublicBoundaryError(cause === undefined ? { message } : { message, cause });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readText = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${file}`, cause)));
  });

const readJson = (file: string) =>
  readText(file).pipe(
    Effect.flatMap((text) =>
      Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
        Effect.mapError((cause) => fail(`cannot parse ${file}`, cause)),
      ),
    ),
  );

const expectedArtifacts = (version: string): string[] =>
  [
    ...PACKAGES.map((item) => `packages/askgina-${item.slug}-${version}.tgz`),
    ...HOSTS.map((host) => `targets/ask-gina-${host}-${version}.tgz`),
    `skills/ask-gina-skills-${version}.tgz`,
    "receipts/contract.json",
    "receipts/packages.json",
    "receipts/targets.json",
    "receipts/evals.json",
  ].sort();

const filesBelow = (directory: string, excluded: ReadonlySet<string> = new Set()) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (
      current: string,
      prefix: string,
    ): Effect.Effect<
      { readonly files: string[]; readonly unsupported: string[] },
      PublicBoundaryError
    > =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(current)
          .pipe(Effect.mapError((cause) => fail(`cannot list ${current}`, cause)));
        const nested = yield* Effect.forEach(names.sort(), (name) =>
          Effect.gen(function* () {
            const relative = prefix.length > 0 ? `${prefix}/${name}` : name;
            if (excluded.has(name) || excluded.has(relative)) return { files: [], unsupported: [] };
            const absolute = path.join(current, name);
            const symbolicLink = yield* fs
              .readLink(absolute)
              .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
            if (symbolicLink) return { files: [], unsupported: [relative] };
            const info = yield* fs
              .stat(absolute)
              .pipe(Effect.mapError((cause) => fail(`cannot inspect ${absolute}`, cause)));
            if (info.type === "Directory") return yield* visit(absolute, relative);
            if (info.type === "File") return { files: [relative], unsupported: [] };
            return { files: [], unsupported: [relative] };
          }),
        );
        return {
          files: nested.flatMap((result) => result.files),
          unsupported: nested.flatMap((result) => result.unsupported),
        };
      });
    return yield* visit(directory, "");
  });

const program = Effect.scoped(
  Effect.gen(function* () {
    if (process.argv.slice(2).length > 0) {
      return yield* fail("check-public-boundary accepts no arguments");
    }
    const root = process.cwd();
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const dist = path.join(root, "dist");
    const rootJson = yield* readJson(path.join(root, "package.json"));
    if (
      !isObject(rootJson) ||
      typeof rootJson.version !== "string" ||
      rootJson.version.length === 0
    ) {
      return yield* fail("root package version is invalid");
    }
    const version = rootJson.version;
    const findings: Finding[] = [];
    let findingCount = 0;
    let scannedFiles = 0;
    let scannedArchives = 0;
    const addFinding = (rule: string, file: string): void => {
      findingCount += 1;
      if (findings.length < MAX_FINDINGS)
        findings.push({ rule, path: file.split(path.sep).join("/") });
    };
    const scanText = (text: string, label: string, receipt: boolean): void => {
      const codeOrData = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|lock)$/iu.test(label);
      if (text.includes(PRIVATE_REPOSITORY)) addFinding("private-repository-name", label);
      if (codeOrData && text.includes(PRIVATE_REGISTRY)) addFinding("private-registry", label);
      if (codeOrData && text.includes(PRIVATE_REGISTRY_FIELD))
        addFinding("private-registry-field", label);
      for (const match of text.matchAll(
        /(?:from\s+|import\s*(?:\(\s*)?|require\s*\()\s*["']([^"']+)["']/gu,
      )) {
        const specifier = match[1] ?? "";
        if (specifier.startsWith(PRIVATE_ALIAS)) addFinding("private-import", label);
        if (specifier === FORBIDDEN_RUNTIME || specifier.startsWith(`${FORBIDDEN_RUNTIME}/`))
          addFinding("forbidden-runtime", label);
        if (specifier.toLowerCase().includes(PRIVATE_CACHE)) addFinding("private-cache", label);
      }
      if (/(?:package\.json|bun\.lock)(?::|$)/u.test(label)) {
        for (const match of text.matchAll(/["']([^"']+)["']\s*:/gu)) {
          const dependency = (match[1] ?? "").toLowerCase();
          if (dependency === FORBIDDEN_RUNTIME || dependency.startsWith(`${FORBIDDEN_RUNTIME}/`))
            addFinding("forbidden-runtime", label);
          if (dependency.includes(PRIVATE_CACHE)) addFinding("private-cache", label);
        }
      }
      if (/\bREDIS_[A-Z0-9_]+\b|rediss?:\/\//u.test(text)) addFinding("private-cache", label);
      for (const violation of findPublicTextViolations(text)) {
        addFinding(violation.kind, label);
      }
      for (const match of text.matchAll(/https?:\/\/([^\s/"'<>]+)/giu)) {
        const hostname = (match[1] ?? "").toLowerCase().replace(/:\d+$/u, "");
        if (
          hostname === "localhost" ||
          hostname.endsWith(".local") ||
          hostname.endsWith(".internal") ||
          hostname.endsWith(".private") ||
          /^(?:127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(hostname)
        )
          addFinding("private-host", label);
      }
      if (receipt && RAW_EVAL_FIELDS.test(text)) addFinding("raw-eval-field", label);
    };
    const scanFile = (absolute: string, label: string, receipt: boolean) =>
      Effect.gen(function* () {
        scannedFiles += 1;
        const info = yield* fs
          .stat(absolute)
          .pipe(Effect.mapError((cause) => fail(`cannot inspect ${absolute}`, cause)));
        if (info.size > BigInt(MAX_TEXT_BYTES)) {
          addFinding("unscannable-oversized-file", label);
          return;
        }
        const bytes = yield* fs
          .readFile(absolute)
          .pipe(Effect.mapError((cause) => fail(`cannot read ${absolute}`, cause)));
        if (bytes.includes(0)) addFinding("unscannable-binary-file", label);
        else scanText(new TextDecoder().decode(bytes), label, receipt);
      });
    const comparePackageDeclarations = (stage: string, definition: PackageDefinition) =>
      Effect.gen(function* () {
        const label = `dist/packages/askgina-${definition.slug}-${version}.tgz`;
        const packed = yield* readJson(path.join(stage, "package/package.json"));
        const source = yield* readJson(path.join(root, definition.directory, "package.json"));
        if (!isObject(packed) || !isObject(source)) {
          addFinding("invalid-package-metadata", label);
          return;
        }
        const declaredFiles = Array.isArray(source.files)
          ? source.files.filter((item): item is string => typeof item === "string")
          : [];
        const staged = yield* filesBelow(path.join(stage, "package"));
        for (const file of staged.files) {
          if (
            file !== "package.json" &&
            !declaredFiles.some((entry) => file === entry || file.startsWith(`${entry}/`))
          )
            addFinding("undeclared-package-file", `${label}:${file}`);
        }
        for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
          const sourceValue = source[field];
          const expected = isObject(sourceValue)
            ? Object.fromEntries(
                Object.entries(sourceValue).map(([name, range]) => [
                  name,
                  typeof range === "string" && range.startsWith("workspace:") ? version : range,
                ]),
              )
            : {};
          if (stableJson(packed[field] ?? {}) !== stableJson(expected))
            addFinding("undeclared-package-dependency", label);
        }
      });

    const sourceTree = yield* filesBelow(root, new Set([".git", "node_modules", "dist"]));
    for (const unsupported of sourceTree.unsupported)
      addFinding("symbolic-link-or-unsupported-file", unsupported);
    yield* Effect.forEach(sourceTree.files, (file) => scanFile(path.join(root, file), file, false));

    const expected = expectedArtifacts(version);
    const artifactTree = yield* filesBelow(dist).pipe(
      Effect.catchIf(
        () => true,
        (cause) => Effect.succeed({ files: [], unsupported: [cause.message] }),
      ),
    );
    const actual = artifactTree.files.sort();
    for (const unsupported of artifactTree.unsupported)
      addFinding("unsupported-file", `dist/${unsupported}`);
    for (const file of expected)
      if (!actual.includes(file)) addFinding("missing-artifact", `dist/${file}`);
    for (const file of actual)
      if (!expected.includes(file)) addFinding("extra-artifact", `dist/${file}`);

    yield* Effect.forEach(
      ["contract.json", "packages.json", "targets.json", "evals.json"],
      (receipt) => {
        const label = `dist/receipts/${receipt}`;
        return scanFile(path.join(dist, "receipts", receipt), label, receipt === "evals.json").pipe(
          Effect.catchIf(
            () => true,
            () => Effect.sync(() => addFinding("missing-or-invalid-receipt", label)),
          ),
        );
      },
    );

    const temporary = yield* fs
      .makeTempDirectoryScoped({ prefix: "askgina-boundary-" })
      .pipe(Effect.mapError((cause) => fail("cannot create boundary scan directory", cause)));
    const archives = expected.filter((file) => file.endsWith(".tgz"));
    yield* Effect.forEach(archives, (relative, index) =>
      Effect.gen(function* () {
        const absolute = path.join(dist, relative);
        if (
          !(yield* fs
            .exists(absolute)
            .pipe(Effect.mapError((cause) => fail(`cannot access ${absolute}`, cause))))
        )
          return;
        scannedArchives += 1;
        const stage = path.join(temporary, String(index));
        const extracted = yield* extractCheckedTarGz(absolute, stage).pipe(
          Effect.match({
            onFailure: () => false,
            onSuccess: () => true,
          }),
        );
        if (!extracted) {
          addFinding("unreadable-archive", `dist/${relative}`);
          return;
        }
        const tree = yield* filesBelow(stage).pipe(
          Effect.catchIf(
            () => true,
            () => Effect.succeed({ files: [], unsupported: [relative] }),
          ),
        );
        for (const unsupported of tree.unsupported)
          addFinding("invalid-archive-content", `dist/${relative}:${unsupported}`);
        yield* Effect.forEach(tree.files, (file) =>
          scanFile(path.join(stage, file), `dist/${relative}:${file}`, false),
        );
        const definition = PACKAGES.find(
          (item) => relative === `packages/askgina-${item.slug}-${version}.tgz`,
        );
        if (definition !== undefined) {
          yield* comparePackageDeclarations(stage, definition).pipe(
            Effect.catchIf(
              () => true,
              () => Effect.sync(() => addFinding("invalid-package-metadata", `dist/${relative}`)),
            ),
          );
        }
      }),
    );

    const result = {
      schemaVersion: "v1",
      ok: findingCount === 0,
      scannedFiles,
      scannedArchives,
      findingCount,
      findings,
      truncated: findingCount > findings.length,
    };
    yield* Effect.sync(() => {
      process.stdout.write(stableJson(result));
      if (findingCount > 0) process.exitCode = 1;
    });
  }),
).pipe(
  Effect.catchIf(
    () => true,
    (error) =>
      Effect.sync(() => {
        process.stdout.write(stableJson({ schemaVersion: "v1", ok: false, error: error.message }));
        process.exitCode = 1;
      }),
  ),
);

const main = Layer.build(BunServices.layer).pipe(
  Effect.flatMap((context) => program.pipe(Effect.provide(context))),
  Effect.scoped,
);

BunRuntime.runMain(main);
