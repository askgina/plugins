import { Data, Effect, FileSystem, Path, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { ExecutionTaskSchema, type ExecutionTask } from "./contracts";

export class ExecutionTaskLoadError extends Data.TaggedError("ExecutionTaskLoadError")<{
  readonly path: string;
  readonly reasons: readonly string[];
}> {}

/** Cross-field rules the schema can't express. */
const invariantViolations = (task: ExecutionTask, fileId: string): string[] => {
  const reasons: string[] = [];
  if (task.id !== fileId) reasons.push(`id ${task.id} must match file name ${fileId}`);
  const accounts = new Set(task.accounts.map((account) => account.id));
  if (accounts.size !== task.accounts.length) reasons.push("duplicate account id");
  if (!accounts.has(task.target.account))
    reasons.push(`target account ${task.target.account} is not a task account`);
  const legIds = new Set<string>();
  for (const edge of task.edges) {
    if (legIds.has(edge.id)) reasons.push(`duplicate leg ${edge.id}`);
    legIds.add(edge.id);
    for (const end of [edge.from, edge.to]) {
      if (!accounts.has(end.account))
        reasons.push(`leg ${edge.id} touches unknown account ${end.account}`);
      if (task.assets[end.asset] === undefined)
        reasons.push(`leg ${edge.id} uses unpriced asset ${end.asset}`);
    }
  }
  for (const account of task.accounts) {
    if (task.assets[account.gas_asset] === undefined)
      reasons.push(`${account.id} gas asset ${account.gas_asset} is unpriced`);
  }
  for (const fault of task.faults ?? []) {
    if (!legIds.has(fault.leg))
      reasons.push(`fault ${fault.kind} targets unknown leg ${fault.leg}`);
  }
  if (
    task.expected_outcome.kind === "halt" &&
    task.expected_outcome.cause === "user_rejected" &&
    task.user_script.confirm.kind !== "reject"
  ) {
    reasons.push("user_rejected outcome needs user_script.confirm = reject");
  }
  return reasons;
};

/** Loads and validates every `*.yaml` execution task in `directory`, sorted by id. */
export const loadExecutionTasks = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<ExecutionTask>,
  ExecutionTaskLoadError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs
      .readDirectory(directory)
      .pipe(
        Effect.mapError(
          (cause) => new ExecutionTaskLoadError({ path: directory, reasons: [String(cause)] }),
        ),
      );
    const tasks: ExecutionTask[] = [];
    for (const name of entries.filter((entry) => entry.endsWith(".yaml")).sort()) {
      const file = path.join(directory, name);
      const source = yield* fs
        .readFileString(file)
        .pipe(
          Effect.mapError(
            (cause) => new ExecutionTaskLoadError({ path: file, reasons: [String(cause)] }),
          ),
        );
      const parsed = yield* Effect.try({
        try: (): unknown =>
          parseYaml(source, { logLevel: "silent", strict: true, uniqueKeys: true }),
        catch: (cause) => new ExecutionTaskLoadError({ path: file, reasons: [String(cause)] }),
      });
      const task = yield* Schema.decodeUnknownEffect(ExecutionTaskSchema, {
        errors: "all",
        onExcessProperty: "error",
      })(parsed).pipe(
        Effect.mapError(
          (cause) => new ExecutionTaskLoadError({ path: file, reasons: [String(cause)] }),
        ),
      );
      const reasons = invariantViolations(task, name.slice(0, -".yaml".length));
      if (reasons.length > 0) return yield* new ExecutionTaskLoadError({ path: file, reasons });
      tasks.push(task);
    }
    return tasks;
  });
