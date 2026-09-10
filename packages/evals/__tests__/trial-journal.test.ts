import { createHash } from "node:crypto";
import { catalogSha, PRODUCTION_MCP_URL, publicEvalAttemptIdentityInput } from "@askgina/contracts";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Schema,
} from "effect";

import type { PluginEvalObservation } from "../src/contracts";
import aggregateFixture from "../src/fixtures/sanitized-aggregate.json";

import {
  OPENROUTER_BUDGET_LIMITATIONS,
  type OpenRouterBudgetEvidence,
} from "../src/openrouter-budget";
import type { OpenRouterGenerationEvidence } from "../src/provider-evidence";
import { ALPHA_GINA_READ_SERVER_URL } from "../src/server-url";
import {
  createLiveEvalJournal,
  liveEvalJournalDispatchId,
  LiveEvalJournalError,
  LIVE_EVAL_JOURNAL_MAX_CASES,
  LIVE_EVAL_JOURNAL_SCHEMA_VERSION,
  withJournaledTrial,
  type LiveEvalJournal,
  type LiveEvalJournalOptions,
} from "../src/trial-journal";

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);
const UnknownJson = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownSync(UnknownJson);
const encodeUnknownJson = Schema.encodeUnknownSync(UnknownJson);

const evidence = (
  step = 1,
  overrides: Partial<OpenRouterGenerationEvidence> = {},
): OpenRouterGenerationEvidence => ({
  generationId: "gen-observed-1",
  responseModel: "openai/gpt-5.6-sol",
  provider: "openai",
  step,
  inputTokens: 11,
  outputTokens: 3,
  totalTokens: 14,
  cost: null,
  ...overrides,
});

const budgetEvidence = (): OpenRouterBudgetEvidence => ({
  kind: "openrouter-provider-limit-admission",
  requestedMaximumUsd: 40,
  providerLimitUsd: 40,
  providerUsageUsd: 5,
  providerRemainingUsd: 35,
  includeByokInLimit: true,
  limitations: OPENROUTER_BUDGET_LIMITATIONS,
});

const invalidLimitBudgetEvidence = (): OpenRouterBudgetEvidence => ({
  ...budgetEvidence(),
  requestedMaximumUsd: 25,
  providerLimitUsd: 40,
});

const journalOptions = (
  outputPath: string,
  overrides: Partial<LiveEvalJournalOptions> = {},
): LiveEvalJournalOptions => ({
  outputPath,
  runId: "am-spot-routing-20260910",
  candidate: "sol-medium-diagnostic",
  target: "openrouter_api",
  model: "openai/gpt-5.6-sol",
  serverUrl: PRODUCTION_MCP_URL,
  suiteId: "synthetic-model-smoke-v1",
  suiteVersion: 1,
  fixtureVersion: 1,
  catalogSha,
  reasoning: "medium",
  accountClass: "local",
  caseIds: ["simple-spot-price"],
  repetitions: 3,
  ...overrides,
});

const selectedCaseIds = ["simple-spot-price"] as const;

const v1Report = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "v1",
  runId: "am-spot-routing-20260910",
  candidate: "sol-medium-diagnostic",
  target: "openrouter_api",
  model: "openai/gpt-5.6-sol",
  reasoning: "medium",
  repetitions: 3,
  startedAt: "2026-09-10T00:00:00.000Z",
  cleanChat: true,
  accountClass: "local",
  aggregate: aggregateFixture,
  ...overrides,
});

const parseRecords = (content: string): readonly Record<string, unknown>[] => {
  assert.strictEqual(content.at(-1), "\n");
  return content
    .slice(0, -1)
    .split("\n")
    .map((line) => decodeUnknownJson(line) as Record<string, unknown>);
};

const reasonOf = (result: {
  readonly _tag: string;
  readonly failure?: unknown;
}): string | undefined =>
  result.failure instanceof LiveEvalJournalError ? result.failure.reason : undefined;

const publicFailure = (result: { readonly _tag: string; readonly failure?: unknown }): string =>
  result.failure instanceof LiveEvalJournalError
    ? encodeUnknownJson({ _tag: result.failure._tag, reason: result.failure.reason })
    : "";

describe("live eval trial journal", () => {
  it.layer(TestPlatformLayer)((it) => {
    it.effect(
      "creates a private JSONL journal and flushes started before returning dispatchId",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-write-" });
          const outputPath = path.join(directory, "run.trial-journal-v1.jsonl");
          const journal = yield* createLiveEvalJournal(journalOptions(outputPath));
          const created = parseRecords(yield* fs.readFileString(outputPath));
          assert.deepStrictEqual(created, [
            {
              kind: "run",
              schemaVersion: LIVE_EVAL_JOURNAL_SCHEMA_VERSION,
              runId: "am-spot-routing-20260910",
              candidate: "sol-medium-diagnostic",
              target: "openrouter_api",
              model: "openai/gpt-5.6-sol",
              serverUrl: PRODUCTION_MCP_URL,
              suiteId: "synthetic-model-smoke-v1",
              suiteVersion: 1,
              fixtureVersion: 1,
              catalogSha,
              reasoning: "medium",
              accountClass: "local",
              caseIds: ["simple-spot-price"],
              repetitions: 3,
            },
          ]);
          const metadata = yield* fs.stat(outputPath);
          assert.strictEqual(metadata.mode & 0o777, 0o600);

          const dispatchId = yield* journal.startTrial({
            caseId: "simple-spot-price",
            repetition: 1,
            budgetEvidence: budgetEvidence(),
          });
          assert.strictEqual(
            dispatchId,
            `dispatch-${createHash("sha256")
              .update(
                publicEvalAttemptIdentityInput("am-spot-routing-20260910", "simple-spot-price", 1),
                "utf8",
              )
              .digest("hex")}`,
          );
          const afterStart = parseRecords(yield* fs.readFileString(outputPath));
          assert.strictEqual(afterStart[1]?.kind, "started");
          assert.strictEqual(afterStart[1]?.dispatchId, dispatchId);
          assert.deepStrictEqual(afterStart[1]?.budgetEvidence, budgetEvidence());

          yield* journal.generation(dispatchId, evidence(1));
          yield* journal.finishTrial(dispatchId, "completed");
          const report = v1Report();
          const reportContent = `${encodeUnknownJson(report)}\n`;
          assert.strictEqual(
            reasonOf(yield* Effect.result(journal.bindReport(reportContent, selectedCaseIds))),
            "invalid-record",
          );
          for (const repetition of [2, 3]) {
            const next = yield* journal.startTrial({
              caseId: "simple-spot-price",
              repetition,
              budgetEvidence: budgetEvidence(),
            });
            yield* journal.finishTrial(next, "completed");
          }
          assert.strictEqual(
            reasonOf(
              yield* Effect.result(
                journal.bindReport(
                  encodeUnknownJson({ ...report, runId: "another-run" }),
                  selectedCaseIds,
                ),
              ),
            ),
            "invalid-record",
          );
          yield* journal.bindReport(reportContent, selectedCaseIds);
          assert.strictEqual(
            reasonOf(yield* Effect.result(journal.bindReport(reportContent, selectedCaseIds))),
            "already-bound",
          );
          assert.strictEqual(
            reasonOf(
              yield* Effect.result(
                journal.startTrial({
                  caseId: "simple-spot-price",
                  repetition: 4,
                  budgetEvidence: budgetEvidence(),
                }),
              ),
            ),
            "already-bound",
          );
          const records = parseRecords(yield* fs.readFileString(outputPath));
          assert.deepStrictEqual(records[2]?.evidence, evidence(1));
          assert.deepStrictEqual(records[3], { kind: "finished", dispatchId, status: "completed" });
          assert.deepStrictEqual(records.at(-1), {
            kind: "report-bound",
            sourceReportSha256: createHash("sha256").update(reportContent, "utf8").digest("hex"),
          });
          assert.notInclude(encodeUnknownJson(records), directory);
        }),
    );

    it.effect("keeps only the run header when no startTrial follows create", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-header-" });
        const outputPath = path.join(directory, "run.jsonl");
        yield* createLiveEvalJournal(
          journalOptions(outputPath, { serverUrl: ALPHA_GINA_READ_SERVER_URL }),
        );
        const records = parseRecords(yield* fs.readFileString(outputPath));
        assert.strictEqual(records.length, 1);
        assert.strictEqual(records[0]?.kind, "run");
        assert.strictEqual(records[0]?.serverUrl, ALPHA_GINA_READ_SERVER_URL);
        assert.notInclude(encodeUnknownJson(records), "started");
      }),
    );

    it.effect("rejects an existing journal without deleting incomplete started records", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-crash-" });
        const outputPath = path.join(directory, "run.jsonl");
        const journal = yield* createLiveEvalJournal(journalOptions(outputPath));
        const dispatchId = yield* journal.startTrial({
          caseId: "simple-spot-price",
          repetition: 1,
          budgetEvidence: budgetEvidence(),
        });
        const preserved = yield* fs.readFileString(outputPath);
        const recreate = yield* Effect.result(createLiveEvalJournal(journalOptions(outputPath)));
        assert.strictEqual(reasonOf(recreate), "output-exists");
        assert.strictEqual(yield* fs.readFileString(outputPath), preserved);
        assert.include(preserved, `"dispatchId":"${dispatchId}"`);
        assert.notInclude(preserved, '"kind":"finished"');
      }),
    );

    it.effect("does not clobber a journal created after exists preflight", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-race-" });
        const outputPath = path.join(directory, "run.jsonl");
        const occupied = "another writer owns these bytes\n";
        const competing: FileSystem.FileSystem = {
          ...fs,
          open: (file, options) =>
            Effect.gen(function* () {
              if (path.resolve(file) === path.resolve(outputPath) && options?.flag === "wx") {
                yield* fs.writeFileString(file, occupied, { flag: "wx", mode: 0o600 });
              }
              return yield* fs.open(file, options);
            }),
        };
        const result = yield* Effect.result(
          createLiveEvalJournal(journalOptions(outputPath)).pipe(
            Effect.provideService(FileSystem.FileSystem, competing),
          ),
        );
        assert.strictEqual(reasonOf(result), "output-exists");
        assert.strictEqual(yield* fs.readFileString(outputPath), occupied);
      }),
    );

    it.effect("rejects traversal, secrets, and extra payloads without leaking them", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-reject-" });
        const secretUrl = ["https://user", ":pass@askgina.ai/ai/gina/mcp"].join("");
        const traversal = yield* Effect.result(
          createLiveEvalJournal(journalOptions(`${directory}/../escape.jsonl`)),
        );
        assert.strictEqual(reasonOf(traversal), "invalid-path");
        assert.notInclude(publicFailure(traversal), directory);
        assert.notInclude(publicFailure(traversal), "escape.jsonl");

        const credentialUrl = yield* Effect.result(
          createLiveEvalJournal(
            journalOptions(path.join(directory, "secret.jsonl"), { serverUrl: secretUrl }),
          ),
        );
        assert.strictEqual(reasonOf(credentialUrl), "invalid-identity");
        assert.notInclude(publicFailure(credentialUrl), ["user", ":pass"].join(""));

        const journal = yield* createLiveEvalJournal(
          journalOptions(path.join(directory, "ok.jsonl")),
        );
        const dispatchId = yield* journal.startTrial({
          caseId: "simple-spot-price",
          repetition: 1,
          budgetEvidence: budgetEvidence(),
        });
        const secretEvidence = yield* Effect.result(
          journal.generation(
            dispatchId,
            evidence(1, { generationId: ["sk", "-ant-api03-not-for-journal"].join("") }),
          ),
        );
        assert.strictEqual(reasonOf(secretEvidence), "invalid-record");
        const extra = yield* Effect.result(
          journal.generation(dispatchId, {
            ...evidence(1),
            rawOutput: "hidden reasoning",
          } as OpenRouterGenerationEvidence),
        );
        assert.strictEqual(reasonOf(extra), "invalid-record");
        const saved = yield* fs.readFileString(path.join(directory, "ok.jsonl"));
        assert.notInclude(saved, ["sk", "-ant"].join(""));
        assert.notInclude(saved, "hidden reasoning");
      }),
    );

    it.effect("preserves identity state and failed or interrupted terminals", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-state-" });
        const outputPath = path.join(directory, "run.jsonl");
        const journal = yield* createLiveEvalJournal(journalOptions(outputPath));
        const first = yield* journal.startTrial({
          caseId: "simple-spot-price",
          repetition: 1,
          budgetEvidence: budgetEvidence(),
        });
        const duplicate = yield* Effect.result(
          journal.startTrial({
            caseId: "simple-spot-price",
            repetition: 1,
            budgetEvidence: budgetEvidence(),
          }),
        );
        assert.strictEqual(reasonOf(duplicate), "already-started");
        assert.strictEqual(
          liveEvalJournalDispatchId("am-spot-routing-20260910", "simple-spot-price", 1),
          first,
        );
        yield* journal.generation(first, evidence(1, { cost: 0.04 }));
        yield* journal.finishTrial(first, "failed");
        assert.strictEqual(
          reasonOf(yield* Effect.result(journal.generation(first, evidence(2)))),
          "already-finished",
        );
        const interrupted = yield* journal.startTrial({
          caseId: "simple-spot-price",
          repetition: 2,
          budgetEvidence: budgetEvidence(),
        });
        yield* journal.finishTrial(interrupted, "interruption");
        assert.strictEqual(
          reasonOf(yield* Effect.result(journal.bindReport("report-bytes\n", selectedCaseIds))),
          "invalid-record",
        );
        const records = parseRecords(yield* fs.readFileString(outputPath));
        assert.deepStrictEqual(
          records.filter((record) => record.kind === "finished").map((record) => record.status),
          ["failed", "interruption"],
        );
      }),
    );

    it.effect(
      "records interruption from withJournaledTrial without converting the fiber to success",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({
            prefix: "trial-journal-interrupt-",
          });
          const outputPath = path.join(directory, "run.jsonl");
          const journal = yield* createLiveEvalJournal(journalOptions(outputPath));
          const running = yield* Deferred.make<void>();
          const fiber = yield* Effect.forkChild(
            withJournaledTrial(
              journal,
              {
                caseId: "simple-spot-price",
                repetition: 1,
                budgetEvidence: budgetEvidence(),
              },
              () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
            ),
          );
          yield* Deferred.await(running);
          yield* Fiber.interrupt(fiber);
          const exit = yield* Fiber.await(fiber);
          assert.strictEqual(Exit.isFailure(exit), true);
          if (Exit.isFailure(exit)) assert.strictEqual(Cause.hasInterrupts(exit.cause), true);
          const records = parseRecords(yield* fs.readFileString(outputPath));
          assert.strictEqual(
            records.some((record) => record.kind === "started"),
            true,
          );
          assert.deepStrictEqual(records.at(-1)?.status, "interruption");
        }),
    );

    it.effect("maps observation failed/blocked and typed timeout without inferring timeout", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-settle-" });
        const outputPath = path.join(directory, "run.jsonl");
        const journal = yield* createLiveEvalJournal(
          journalOptions(outputPath, {
            caseIds: ["blocked-case", "failed-case", "timeout-case", "generic-case"],
            repetitions: 1,
          }),
        );
        class PluginEvalOpenRouterTimeoutError extends Data.TaggedError(
          "PluginEvalOpenRouterTimeoutError",
        )<{
          readonly caseId: string;
          readonly timeoutMs: number;
        }> {}
        const observation = (
          status: PluginEvalObservation["status"],
          caseId: string,
        ): PluginEvalObservation => ({
          version: 1,
          run_id: "am-spot-routing-20260910",
          case_id: caseId,
          target: "openrouter_api",
          model: "openai/gpt-5.6-sol",
          repetition: 1,
          started_at: "2026-09-10T00:00:00.000Z",
          status,
          duration_ms: 1,
          tool_calls: [],
        });
        yield* withJournaledTrial(
          journal,
          { caseId: "blocked-case", repetition: 1, budgetEvidence: budgetEvidence() },
          () => Effect.succeed(observation("blocked", "blocked-case")),
        );
        yield* withJournaledTrial(
          journal,
          { caseId: "failed-case", repetition: 1, budgetEvidence: budgetEvidence() },
          () => Effect.succeed(observation("failed", "failed-case")),
        );
        const timeout = yield* Effect.result(
          withJournaledTrial(
            journal,
            { caseId: "timeout-case", repetition: 1, budgetEvidence: budgetEvidence() },
            () =>
              Effect.fail(
                new PluginEvalOpenRouterTimeoutError({ caseId: "timeout-case", timeoutMs: 1 }),
              ),
          ),
        );
        assert.strictEqual(timeout._tag, "Failure");
        if (timeout._tag === "Failure") {
          assert.instanceOf(timeout.failure, PluginEvalOpenRouterTimeoutError);
        }
        const generic = yield* Effect.result(
          withJournaledTrial(
            journal,
            { caseId: "generic-case", repetition: 1, budgetEvidence: budgetEvidence() },
            () => Effect.fail(new LiveEvalJournalError({ reason: "invalid-record" })),
          ),
        );
        assert.strictEqual(reasonOf(generic), "invalid-record");
        const records = parseRecords(yield* fs.readFileString(outputPath));
        assert.deepStrictEqual(
          records.filter((record) => record.kind === "started").map((record) => record.caseId),
          ["blocked-case", "failed-case", "timeout-case", "generic-case"],
        );
        assert.deepStrictEqual(
          records.filter((record) => record.kind === "finished").map((record) => record.status),
          ["blocked", "failed", "timeout", "failed"],
        );
      }),
    );

    it.effect("rejects a 65th case and keeps the durable prefix", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-capacity-" });
        const outputPath = path.join(directory, "run.jsonl");
        const caseIds = Array.from(
          { length: LIVE_EVAL_JOURNAL_MAX_CASES },
          (_, index) => `case-${index + 1}`,
        );
        const journal = yield* createLiveEvalJournal(
          journalOptions(outputPath, { caseIds, repetitions: 1 }),
        );
        for (const caseId of caseIds) {
          yield* journal.startTrial({
            caseId,
            repetition: 1,
            budgetEvidence: budgetEvidence(),
          });
        }
        const before = yield* fs.readFileString(outputPath);
        assert.strictEqual(
          reasonOf(
            yield* Effect.result(
              journal.startTrial({
                caseId: "case-65",
                repetition: 1,
                budgetEvidence: budgetEvidence(),
              }),
            ),
          ),
          "invalid-record",
        );
        assert.strictEqual(yield* fs.readFileString(outputPath), before);
        assert.strictEqual(
          reasonOf(
            yield* Effect.result(
              journal.startTrial({
                caseId: "case-1",
                repetition: 6,
                budgetEvidence: budgetEvidence(),
              }),
            ),
          ),
          "invalid-record",
        );
      }),
    );

    it.effect("rejects replaced or detached journals without appending to foreign files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-replaced-" });
        const outputPath = path.join(directory, "run.jsonl");
        const moved = path.join(directory, "moved.jsonl");
        const journal = yield* createLiveEvalJournal(
          journalOptions(outputPath, { caseIds: ["direct-price"], repetitions: 1 }),
        );
        const original = yield* fs.readFileString(outputPath);
        yield* fs.rename(outputPath, moved);
        yield* fs.writeFileString(outputPath, "foreign bytes\n", { flag: "wx" });
        const rejected = yield* Effect.result(
          withJournaledTrial(
            journal,
            { caseId: "direct-price", repetition: 1, budgetEvidence: budgetEvidence() },
            () => Effect.die("must not dispatch"),
          ),
        );
        assert.strictEqual(reasonOf(rejected), "output-conflict");
        assert.strictEqual(yield* fs.readFileString(outputPath), "foreign bytes\n");
        assert.strictEqual(yield* fs.readFileString(moved), original);
        yield* fs.remove(outputPath);
        yield* fs.rename(moved, outputPath);
        assert.strictEqual(
          reasonOf(
            yield* Effect.result(
              journal.startTrial({
                caseId: "direct-price",
                repetition: 1,
                budgetEvidence: budgetEvidence(),
              }),
            ),
          ),
          "write-failed",
        );
        const detachedPath = path.join(directory, "detached.jsonl");
        const detached = yield* createLiveEvalJournal(
          journalOptions(detachedPath, { caseIds: ["direct-price"], repetitions: 1 }),
        );
        yield* fs.remove(detachedPath);
        assert.strictEqual(
          reasonOf(
            yield* Effect.result(
              detached.startTrial({
                caseId: "direct-price",
                repetition: 1,
                budgetEvidence: budgetEvidence(),
              }),
            ),
          ),
          "output-conflict",
        );
        assert.strictEqual(yield* fs.exists(detachedPath), false);
      }),
    );

    it.effect("retains partial writes and prevents retries after ambiguous sync failure", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-writefail-" });
        const outputPath = path.join(directory, "run.jsonl");
        let refuseSync = false;
        const refused: FileSystem.FileSystem = {
          ...fs,
          open: (name, options) =>
            fs.open(name, options).pipe(
              Effect.map((file) => ({
                ...file,
                stat: file.stat,
                writeAll: (bytes: Uint8Array) => file.writeAll(bytes),
                sync: Effect.suspend(() =>
                  refuseSync
                    ? Effect.fail(
                        PlatformError.systemError({
                          _tag: "PermissionDenied",
                          module: "FileSystem",
                          method: "sync",
                          description: "refused journal sync",
                          pathOrDescriptor: name,
                        }),
                      )
                    : file.sync,
                ),
              })),
            ),
        };
        const journal = yield* createLiveEvalJournal(journalOptions(outputPath)).pipe(
          Effect.provideService(FileSystem.FileSystem, refused),
        );
        const dispatchId = yield* journal.startTrial({
          caseId: "simple-spot-price",
          repetition: 1,
          budgetEvidence: budgetEvidence(),
        });
        refuseSync = true;
        const result = yield* Effect.result(journal.finishTrial(dispatchId, "failed"));
        assert.strictEqual(reasonOf(result), "write-failed");
        assert.notInclude(publicFailure(result), directory);
        const ambiguous = yield* fs.readFileString(outputPath);
        refuseSync = false;
        assert.strictEqual(
          reasonOf(yield* Effect.result(journal.finishTrial(dispatchId, "failed"))),
          "write-failed",
        );
        assert.strictEqual(yield* fs.readFileString(outputPath), ambiguous);
        assert.strictEqual(
          parseRecords(ambiguous).filter((record) => record.kind === "finished").length,
          1,
        );
      }),
    );

    it.effect("rejects missing or invalid openrouter budget before dispatch", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-budget-" });
        const outputPath = path.join(directory, "run.jsonl");
        const journal = yield* createLiveEvalJournal(journalOptions(outputPath));
        const header = yield* fs.readFileString(outputPath);
        let dispatched = false;
        const missing = yield* Effect.result(
          withJournaledTrial(journal, { caseId: "simple-spot-price", repetition: 1 }, () => {
            dispatched = true;
            return Effect.die("must not dispatch");
          }),
        );
        assert.strictEqual(reasonOf(missing), "invalid-record");
        assert.strictEqual(dispatched, false);
        assert.strictEqual(yield* fs.readFileString(outputPath), header);
        const invalid = yield* Effect.result(
          withJournaledTrial(
            journal,
            {
              caseId: "simple-spot-price",
              repetition: 1,
              budgetEvidence: invalidLimitBudgetEvidence(),
            },
            () => {
              dispatched = true;
              return Effect.die("must not dispatch");
            },
          ),
        );
        assert.strictEqual(reasonOf(invalid), "invalid-record");
        assert.strictEqual(dispatched, false);
        assert.strictEqual(yield* fs.readFileString(outputPath), header);
        assert.notInclude(publicFailure(invalid), "40");
        assert.notInclude(publicFailure(invalid), "25");
      }),
    );

    it.effect("rejects budget evidence on non-openrouter targets before dispatch", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-target-" });
        const outputPath = path.join(directory, "run.jsonl");
        const journal = yield* createLiveEvalJournal(
          journalOptions(outputPath, { target: "claude_cli" }),
        );
        const header = yield* fs.readFileString(outputPath);
        let dispatched = false;
        const rejected = yield* Effect.result(
          withJournaledTrial(
            journal,
            {
              caseId: "simple-spot-price",
              repetition: 1,
              budgetEvidence: budgetEvidence(),
            },
            () => {
              dispatched = true;
              return Effect.die("must not dispatch");
            },
          ),
        );
        assert.strictEqual(reasonOf(rejected), "invalid-record");
        assert.strictEqual(dispatched, false);
        assert.strictEqual(yield* fs.readFileString(outputPath), header);
      }),
    );

    it.effect("rejects substituted reports and swapped selection without appending", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-bind-" });
        const outputPath = path.join(directory, "run.jsonl");
        const journal = yield* createLiveEvalJournal(
          journalOptions(outputPath, {
            caseIds: ["simple-spot-price", "direct-price"],
            repetitions: 1,
          }),
        );
        for (const caseId of ["simple-spot-price", "direct-price"]) {
          const dispatchId = yield* journal.startTrial({
            caseId,
            repetition: 1,
            budgetEvidence: budgetEvidence(),
          });
          yield* journal.finishTrial(dispatchId, "completed");
        }
        const before = yield* fs.readFileString(outputPath);
        const matchingLabels = v1Report({
          repetitions: 1,
          aggregate: { ...aggregateFixture, overall: { passed: 2, total: 2 } },
        });
        const reportContent = `${encodeUnknownJson(matchingLabels)}\n`;
        const substituted = `${encodeUnknownJson({
          ...matchingLabels,
          aggregate: {
            ...aggregateFixture,
            suiteId: "other-suite-v1",
            overall: { passed: 2, total: 2 },
          },
        })}\n`;
        assert.strictEqual(
          reasonOf(
            yield* Effect.result(
              journal.bindReport(substituted, ["simple-spot-price", "direct-price"]),
            ),
          ),
          "invalid-record",
        );
        assert.strictEqual(yield* fs.readFileString(outputPath), before);
        assert.strictEqual(
          reasonOf(
            yield* Effect.result(
              journal.bindReport(reportContent, ["direct-price", "simple-spot-price"]),
            ),
          ),
          "invalid-record",
        );
        assert.strictEqual(yield* fs.readFileString(outputPath), before);
        yield* journal.bindReport(reportContent, ["simple-spot-price", "direct-price"]);
        const records = parseRecords(yield* fs.readFileString(outputPath));
        assert.strictEqual(records.at(-1)?.kind, "report-bound");
      }),
    );

    it.effect("acquires the journal lock before the descriptor finalizer marks closed", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trial-journal-close-" });
        const outputPath = path.join(directory, "run.jsonl");
        const enteredWrite = yield* Deferred.make<void>();
        const resumeWrite = yield* Deferred.make<void>();
        const journalReady = yield* Deferred.make<LiveEvalJournal>();
        const releaseScope = yield* Deferred.make<void>();
        let writeCount = 0;
        const gated: FileSystem.FileSystem = {
          ...fs,
          open: (name, options) =>
            fs.open(name, options).pipe(
              Effect.map((file) => ({
                ...file,
                stat: file.stat,
                writeAll: (bytes: Uint8Array) =>
                  Effect.gen(function* () {
                    writeCount += 1;
                    if (writeCount === 2) {
                      yield* Deferred.succeed(enteredWrite, undefined);
                      yield* Deferred.await(resumeWrite);
                    }
                    return yield* file.writeAll(bytes);
                  }),
                sync: file.sync,
              })),
            ),
        };
        const scopedFiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const journal = yield* createLiveEvalJournal(
                journalOptions(outputPath, { repetitions: 2 }),
              ).pipe(Effect.provideService(FileSystem.FileSystem, gated));
              yield* Deferred.succeed(journalReady, journal);
              yield* Deferred.await(releaseScope);
            }),
          ),
        );
        const journal = yield* Deferred.await(journalReady);
        const inFlight = yield* Effect.forkChild(
          journal.startTrial({
            caseId: "simple-spot-price",
            repetition: 1,
            budgetEvidence: budgetEvidence(),
          }),
        );
        yield* Deferred.await(enteredWrite);
        yield* Deferred.succeed(releaseScope, undefined);
        yield* Deferred.succeed(resumeWrite, undefined);
        yield* Fiber.join(inFlight);
        yield* Fiber.join(scopedFiber);
        const late = yield* Effect.result(
          journal.startTrial({
            caseId: "simple-spot-price",
            repetition: 2,
            budgetEvidence: budgetEvidence(),
          }),
        );
        assert.strictEqual(reasonOf(late), "write-failed");
        assert.strictEqual(
          parseRecords(yield* fs.readFileString(outputPath)).filter(
            (record) => record.kind === "started",
          ).length,
          1,
        );
      }),
    );
  });
});
