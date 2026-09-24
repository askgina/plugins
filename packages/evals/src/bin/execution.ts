#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Config, Console, Data, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect";

import type { ExecutionTask, FinalLedgerState } from "../execution/contracts";
import { makeFakeLedger } from "../execution/fake-ledger";
import { gradeExecutionTrial } from "../execution/grader";
import { loadExecutionTasks } from "../execution/load-tasks";
import { ompModelSession } from "../execution/omp-model-session";
import { makeExecutionTools } from "../execution/tools";
import { runExecutionTrial } from "../execution/turn-driver";
import { openOmpExecutionSession, prepareOmpHarnessRuntime } from "../omp-harness";

const USAGE = `Usage: bun packages/evals/dist/bin/execution.js --provider <id> --omp-agent-dir <dir> --model <id> --reasoning <level> --out <file.jsonl> [--reps <n>] [--task <id>]... [--turn-timeout-ms <ms>] [--probe-tools]
Runs execution (transaction) eval tasks through OMP with native auth read in place from --omp-agent-dir.
Environment: OMP_EVAL_EXECUTABLE, OMP_EVAL_EXECUTABLE_SHA256.
--probe-tools asks the model to list its tools once and exits (no grading).`;

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Tag plus fields of a tagged error (harness errors carry only ids and reason codes). */
const describe = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return String(error);
  const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : "Error";
  const fields = Object.entries(error)
    .filter(
      ([key, value]) => key !== "_tag" && (typeof value === "string" || typeof value === "number"),
    )
    .map(([key, value]) => `${key}=${value}`);
  return fields.length === 0 ? tag : `${tag}(${fields.join(", ")})`;
};

class ExecutionCliError extends Data.TaggedError("ExecutionCliError")<{
  readonly message: string;
}> {}

interface CliOptions {
  readonly provider: string;
  readonly agentDirectory: string;
  readonly model: string;
  readonly reasoning: string;
  readonly out: string;
  readonly reps: number;
  readonly taskIds: readonly string[];
  readonly turnTimeoutMs: number;
  readonly probeTools: boolean;
}

const parseArgs = (argv: readonly string[]): Effect.Effect<CliOptions, ExecutionCliError> =>
  Effect.gen(function* () {
    const values: Record<string, string> = {};
    const taskIds: string[] = [];
    let probeTools = false;
    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index] ?? "";
      if (flag === "--probe-tools") {
        probeTools = true;
        continue;
      }
      const value = argv[index + 1];
      if (!flag.startsWith("--") || value === undefined) {
        return yield* new ExecutionCliError({ message: `bad argument ${flag}\n${USAGE}` });
      }
      index += 1;
      if (flag === "--task") taskIds.push(value);
      else values[flag.slice(2)] = value;
    }
    const required = ["provider", "omp-agent-dir", "model", "reasoning", "out"];
    const missing = required.filter((name) => values[name] === undefined);
    if (missing.length > 0) {
      return yield* new ExecutionCliError({
        message: `missing --${missing.join(", --")}\n${USAGE}`,
      });
    }
    const reps = Number(values["reps"] ?? "1");
    const turnTimeoutMs = Number(values["turn-timeout-ms"] ?? "300000");
    if (
      !Number.isSafeInteger(reps) ||
      reps <= 0 ||
      !Number.isSafeInteger(turnTimeoutMs) ||
      turnTimeoutMs <= 0
    ) {
      return yield* new ExecutionCliError({
        message: `--reps and --turn-timeout-ms must be positive integers`,
      });
    }
    return {
      provider: values["provider"] ?? "",
      agentDirectory: values["omp-agent-dir"] ?? "",
      model: values["model"] ?? "",
      reasoning: values["reasoning"] ?? "",
      out: values["out"] ?? "",
      reps,
      taskIds,
      turnTimeoutMs,
      probeTools,
    };
  });

/** JSON-safe final ledger state (bigint balances as decimal strings). */
const serializableFinal = (final: FinalLedgerState) => ({
  balances: Object.fromEntries(
    Object.entries(final.balances).map(([account, assets]) => [
      account,
      Object.fromEntries(
        Object.entries(assets).map(([asset, amount]) => [asset, amount.toString()]),
      ),
    ]),
  ),
  in_transit_legs: final.in_transit_legs,
});

const run = (options: CliOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = process.cwd();
    const executablePath = yield* Config.string("OMP_EVAL_EXECUTABLE");
    const expectedSha256 = yield* Config.string("OMP_EVAL_EXECUTABLE_SHA256");
    const { runtimeDirectory } = yield* prepareOmpHarnessRuntime({
      root,
      executablePath,
      expectedSha256,
    });
    const auth = {
      mode: "native" as const,
      provider: options.provider,
      agentDirectory: options.agentDirectory,
    };
    const all = yield* loadExecutionTasks(path.join(root, "packages/evals/src/execution/tasks"));
    const tasks: ExecutionTask[] =
      options.taskIds.length === 0
        ? [...all]
        : all.filter((task) => options.taskIds.includes(task.id));
    if (tasks.length === 0) return yield* new ExecutionCliError({ message: "no tasks selected" });

    if (options.probeTools) {
      const probeTask = tasks[0]!;
      const tools = makeExecutionTools(makeFakeLedger(probeTask));
      const session = yield* openOmpExecutionSession({
        caseId: "probe-tools",
        runtimeDirectory,
        auth,
        model: options.model,
        reasoning: options.reasoning,
        tools,
        turnTimeoutMs: options.turnTimeoutMs,
      });
      const turn = yield* session.send(
        "List the exact names of every tool you can call, comma-separated, and nothing else. Do not call any tool.",
      );
      const probe = yield* encodeJson({
        offered: Object.keys(tools).sort(),
        reported: turn.text,
        finishReason: turn.finishReason,
      });
      yield* Console.log(probe);
      return;
    }

    // Results are private evidence: owner-only directory, and a new owner-only file created
    // exclusively before any trial runs, so a rerun can never append to an earlier cohort.
    yield* fs.makeDirectory(path.dirname(options.out), { recursive: true, mode: 0o700 });
    yield* fs.writeFileString(options.out, "", { flag: "wx", mode: 0o600 }).pipe(
      Effect.mapError(
        () =>
          new ExecutionCliError({
            message: `refusing to write ${options.out}: it already exists or is not writable`,
          }),
      ),
    );
    for (const task of tasks) {
      for (let rep = 1; rep <= options.reps; rep += 1) {
        const startedAt = DateTime.formatIso(yield* DateTime.now);
        const record = yield* Effect.scoped(
          Effect.gen(function* () {
            const adapter = makeFakeLedger(task);
            const session = yield* openOmpExecutionSession({
              caseId: task.id,
              runtimeDirectory,
              auth,
              model: options.model,
              reasoning: options.reasoning,
              tools: makeExecutionTools(adapter),
              turnTimeoutMs: options.turnTimeoutMs,
            });
            const events = yield* runExecutionTrial({
              task,
              adapter,
              session: ompModelSession(session),
            });
            const final = adapter.finalState();
            return { events, final, grade: gradeExecutionTrial(events, task, final) };
          }),
        ).pipe(
          // A session that cannot even open is infrastructure: record it ungraded and move on.
          Effect.catch((error) =>
            Effect.succeed({
              events: [],
              final: { balances: {}, in_transit_legs: [] } satisfies FinalLedgerState,
              grade: {
                status: "ungraded" as const,
                reason: `session failed to open: ${describe(error)}`,
              },
            }),
          ),
        );
        const line = {
          task_id: task.id,
          tier: task.tier,
          repetition: rep,
          model: `${options.provider}/${options.model}`,
          reasoning: options.reasoning,
          started_at: startedAt,
          finished_at: DateTime.formatIso(yield* DateTime.now),
          grade: record.grade,
          final: serializableFinal(record.final),
          events: record.events,
        };
        yield* fs.writeFileString(options.out, `${yield* encodeJson(line)}\n`, { flag: "a" });
        const verdict =
          record.grade.status === "ungraded"
            ? `UNGRADED (${record.grade.reason})`
            : record.grade.passed
              ? "PASS"
              : `FAIL [${record.grade.checks
                  .filter((check) => !check.passed)
                  .map((check) => check.id)
                  .join(", ")}]`;
        yield* Console.log(`${task.id} rep ${rep}: ${verdict}`);
      }
    }
  });

const program = parseArgs(process.argv.slice(2)).pipe(
  Effect.flatMap(run),
  Effect.scoped,
  Effect.catch((error) =>
    Console.error(error instanceof ExecutionCliError ? error.message : describe(error)).pipe(
      Effect.tap(() => Effect.sync(() => (process.exitCode = 1))),
    ),
  ),
);

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const services = yield* Layer.build(BunServices.layer);
      return yield* Effect.provideContext(program, services);
    }).pipe(Effect.scoped),
  );
}
