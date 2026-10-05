#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import {
  Config,
  Console,
  Data,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";

import type { ExecutionTask, FinalLedgerState } from "../execution/contracts";
import { makeFakeLedger } from "../execution/fake-ledger";
import { gradeExecutionTrial } from "../execution/grader";
import { loadExecutionTasks } from "../execution/load-tasks";
import { ompModelSession } from "../execution/omp-model-session";
import { makeExecutionTools } from "../execution/tools";
import { runExecutionTrial } from "../execution/turn-driver";
import { openOmpExecutionSession, prepareOmpHarnessRuntime } from "../omp-harness";

const USAGE = `Usage: bun packages/evals/dist/bin/execution.js --provider <id> --omp-agent-dir <dir> --model <id> --reasoning <level> --out <file.jsonl> [--reps <n>] [--task <id>]... [--turn-timeout-ms <ms>] [--max-attempts <n>] [--retry-delay-ms <ms>] [--probe-tools]
Runs execution (transaction) eval tasks through OMP with native auth read in place from --omp-agent-dir.
Environment: OMP_EVAL_EXECUTABLE, OMP_EVAL_EXECUTABLE_SHA256.
--max-attempts retries an ungraded (infrastructure) trial up to n attempts in total, waiting
--retry-delay-ms times the attempt number between tries; graded passes and failures are never
retried. Every ungraded attempt that is retried is kept in <out>.ungraded-attempts.jsonl.
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
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
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
    const maxAttempts = Number(values["max-attempts"] ?? "1");
    const retryDelayMs = Number(values["retry-delay-ms"] ?? "60000");
    if (
      !Number.isSafeInteger(reps) ||
      reps <= 0 ||
      !Number.isSafeInteger(turnTimeoutMs) ||
      turnTimeoutMs <= 0 ||
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts <= 0
    ) {
      return yield* new ExecutionCliError({
        message: `--reps, --turn-timeout-ms and --max-attempts must be positive integers`,
      });
    }
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
      return yield* new ExecutionCliError({
        message: `--retry-delay-ms must be a non-negative integer`,
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
      maxAttempts,
      retryDelayMs,
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
    const ungradedAttempts = `${options.out}.ungraded-attempts.jsonl`;
    const runTrial = (task: ExecutionTask, rep: number) =>
      Effect.gen(function* () {
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
        return {
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
      });
    for (const task of tasks) {
      for (let rep = 1; rep <= options.reps; rep += 1) {
        // Only infrastructure (ungraded) attempts are retried; the first graded attempt is final.
        let line = yield* runTrial(task, rep);
        for (
          let attempt = 1;
          line.grade.status === "ungraded" && attempt < options.maxAttempts;
          attempt += 1
        ) {
          yield* fs.writeFileString(
            ungradedAttempts,
            `${yield* encodeJson({ ...line, attempt })}\n`,
            { flag: "a", mode: 0o600 },
          );
          const waitMs = options.retryDelayMs * attempt;
          yield* Console.log(
            `${task.id} rep ${rep}: UNGRADED (${line.grade.reason}); attempt ${attempt + 1}/${options.maxAttempts} in ${Math.round(waitMs / 1000)}s`,
          );
          yield* Effect.sleep(Duration.millis(waitMs));
          line = yield* runTrial(task, rep);
        }
        yield* fs.writeFileString(options.out, `${yield* encodeJson(line)}\n`, { flag: "a" });
        const grade = line.grade;
        const verdict =
          grade.status === "ungraded"
            ? `UNGRADED (${grade.reason})`
            : grade.passed
              ? "PASS"
              : `FAIL [${grade.checks
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
