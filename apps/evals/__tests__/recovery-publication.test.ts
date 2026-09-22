import { describe, expect, test } from "vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Effect, FileSystem, Schema } from "effect";
import { createHash } from "node:crypto";
import { canonicalRuns, originalCanonicalRuns } from "../src/canonical/canonical";
import { configurationLeaderboardRows, sameCohort } from "../src/canonical/selectors";
import { isPublicTranscript, publicTranscriptPath } from "../src/lib/public-transcript-schema";
import recovery from "../src/results/2026-09-21/recovery/results.json";
import snapshot from "../src/results/2026-09-21/recovery/snapshot.json";

const rows = configurationLeaderboardRows().filter((row) => row.campaignId === recovery.campaignId);
const runs = canonicalRuns.filter((run) => run.campaignId === recovery.campaignId);

describe("recovery publication", () => {
  test("reconciles every setting to the frozen VM snapshot without changing original runs", () => {
    const runs = originalCanonicalRuns.filter((run) => run.campaignId === recovery.campaignId);
    expect(rows).toHaveLength(11);
    expect(runs.reduce((n, run) => n + run.counts.planned, 0)).toBe(1155);
    expect(runs.reduce((n, run) => n + run.counts.graded, 0)).toBe(1118);
    for (const provider of snapshot.providers) {
      for (const [level, expected] of Object.entries(provider.rows)) {
        const setting = runs.filter((run) =>
          run.runId.startsWith(`recovery-${provider.provider}-${level}-`),
        );
        expect(setting.reduce((n, run) => n + run.counts.graded, 0)).toBe(expected.graded);
        expect(setting.reduce((n, run) => n + run.counts.passed, 0)).toBe(expected.passed);
        expect(setting.reduce((n, run) => n + run.counts.failed, 0)).toBe(expected.failed);
      }
    }
    expect(
      canonicalRuns.filter((run) => run.campaignId === "reasoning-sweep-2026-09-16"),
    ).toHaveLength(105);
  });

  test("recovery scores penalize errors consistently while preserving the recorded grades", () => {
    const astra = runs.filter((run) => run.modelId === "astra");
    expect(astra.reduce((n, run) => n + run.counts.passed, 0)).toBe(166);
    expect(astra.reduce((n, run) => n + run.counts.failed, 0)).toBe(43);
    expect(astra.reduce((n, run) => n + run.counts.runtimeFailure, 0)).toBe(1);
    for (const row of rows) {
      expect(row.overall).toBeCloseTo(
        Object.values(row.runs).reduce(
          (sum, run) => sum + run.counts.passed / run.counts.planned,
          0,
        ) / 3,
      );
      expect(row.overall).toBeLessThan(1);
      expect(row.estimatedCost.availability).toBe("available");
      expect(row.averageTime.availability).toBe("available");
    }
  });

  test("recovery cannot silently compare as an original fixed-budget cohort", () => {
    for (const run of runs) {
      const original = canonicalRuns.find(
        (candidate) => candidate.runId === run.runId.replace("recovery-", ""),
      );
      expect(original).toBeDefined();
      expect(sameCohort(run.cohort, original!.cohort)).toBe(false);
      expect(
        run.recovery?.timeoutBudgetsMs.every((value) => [120000, 300000, 600000].includes(value)),
      ).toBe(true);
      expect(run.recordedCostEstimate).toMatchObject({
        availability: "available",
        sampleCount: run.counts.graded,
      });
    }
  });

  test("every selected chat and every retry resolves to an identity-bound public file", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const index = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              files: Schema.Array(
                Schema.Struct({ path: Schema.String, sha256: Schema.String, bytes: Schema.Finite }),
              ),
            }),
          ),
        )(
          yield* fs.readFileString(
            new URL("../public/transcripts/index.json", import.meta.url).pathname,
          ),
        );
        const files = new Map(index.files.map((entry) => [entry.path, entry]));
        const seen = new Set<string>();
        for (const run of runs) {
          expect(run.attempts.availability).toBe("available");
          if (run.attempts.availability !== "available") continue;
          for (const attempt of run.attempts.value) {
            for (const ref of [
              attempt.conversation!,
              ...(attempt.recovery?.history.map((entry) => entry.conversation) ?? []),
            ]) {
              if (!ref) throw new Error("Expected the older recovery's published conversation");
              const path = publicTranscriptPath(ref)!;
              if (seen.has(path)) continue;
              seen.add(path);
              const entry = files.get(path);
              expect(entry).toBeDefined();
              const bytes = yield* fs.readFile(
                new URL(`../public/transcripts/${path}`, import.meta.url).pathname,
              );
              expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry!.sha256);
              expect(bytes.byteLength).toBe(entry!.bytes);
              const document = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
                new TextDecoder().decode(bytes),
              );
              expect(isPublicTranscript(document)).toBe(true);
              if (isPublicTranscript(document)) expect(document.reference).toEqual(ref);
            }
          }
        }
        expect([...seen].filter((path) => path.startsWith("recovery-"))).toHaveLength(689);
      }).pipe(Effect.provide(BunFileSystem.layer)),
    ));
});
