import type { ExecutionEvent, ExecutionGrade } from "./contracts";

/**
 * Whether an ungraded trial may be run again. Only when nothing but infrastructure is in its
 * log: the session never opened, or it failed before any quote, approval, action, reply or
 * report. Once the model has acted, a retry would select on its behaviour, so the slot stays
 * ungraded. Graded passes and failures are never retried.
 */
export const isRetryableTrial = (trial: {
  readonly grade: ExecutionGrade;
  readonly events: readonly ExecutionEvent[];
}): boolean =>
  trial.grade.status === "ungraded" && trial.events.every((event) => event.type === "infra_error");
