import { Effect } from "effect";
import type { OmpExecutionSession, PluginEvalOmpHarnessError } from "../omp-harness";
import { ModelSessionError, type ModelSession } from "./turn-driver";

/**
 * Which OMP failures are the model's fault. A turn that runs out of time or stops for any reason
 * other than finishing its answer is graded; the harness failing to start, spawn or talk to its
 * process is infrastructure and leaves the trial ungraded.
 */
const classify = (error: PluginEvalOmpHarnessError): ModelSessionError =>
  error._tag === "PluginEvalOmpHarnessTimeoutError"
    ? new ModelSessionError({ kind: "model", message: `turn timed out after ${error.timeoutMs}ms` })
    : new ModelSessionError({ kind: "infra", message: error._tag });

/** Adapts a live OMP execution session to the turn driver's `ModelSession`. */
export const ompModelSession = (session: OmpExecutionSession): ModelSession => ({
  send: (text) =>
    session.send(text).pipe(
      Effect.mapError(classify),
      Effect.flatMap((turn) =>
        turn.finishReason === "stop"
          ? Effect.succeed({ finalText: turn.text })
          : Effect.fail(
              new ModelSessionError({
                kind: "model",
                message: `turn ended with finish reason ${turn.finishReason}`,
              }),
            ),
      ),
    ),
});
