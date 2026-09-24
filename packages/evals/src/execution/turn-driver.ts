import { Effect } from "effect";
import type {
  ExecutionAdapter,
  ExecutionEvent,
  ExecutionTask,
  UserReply,
  UserScript,
} from "./contracts";

/** One persistent model conversation. Each `send` is a new user turn in the same session. */
export interface ModelSession<E> {
  readonly send: (text: string) => Effect.Effect<{ readonly finalText: string }, E>;
}

type UserStage = "confirm" | "reconfirm";

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

/** Deterministic scripted reply for an approval point. Reconfirm without a script is a refusal. */
const scriptedReply = (
  script: UserScript,
  stage: UserStage,
): { reply: UserReply; text: string } => {
  const reply: UserReply =
    stage === "confirm" ? script.confirm : (script.reconfirm ?? { kind: "reject" });
  switch (reply.kind) {
    case "approve":
      return { reply, text: "Yes, go ahead with that plan." };
    case "reject":
      return { reply, text: "No, don't do it." };
    case "cap":
      return {
        reply,
        text: `Only if the total cost stays at or under ${usd(reply.max_cost_usd_micros)}.`,
      };
    case "text":
      return { reply, text: reply.text };
  }
};

const isAdapterAction = (event: ExecutionEvent): boolean =>
  event.type === "submit" || event.type === "halt" || event.type === "approval_requested";

/**
 * Drives one execution trial as a real multi-turn conversation:
 * 1. The first turn carries only the goal (never approval text).
 * 2. When a turn ends with a new approval request, the scripted user answers it in the next
 *    user turn; the adapter grants the approval host-side from that recorded reply.
 * 3. A turn that ends without an approval request gets the script's `unexpected` reply once;
 *    after that (or once the model has acted), the trial ends. The model reports through the
 *    `report_result` tool; if it never did, its last text is recorded without balances, which
 *    fails the report check rather than guessing from prose.
 * Session failures are infrastructure errors, never model failures.
 */
export const runExecutionTrial = <E>(input: {
  readonly task: ExecutionTask;
  readonly adapter: ExecutionAdapter;
  readonly session: ModelSession<E>;
}): Effect.Effect<ReadonlyArray<ExecutionEvent>> =>
  Effect.gen(function* () {
    const { task, adapter, session } = input;
    const script = task.user_script;
    let text = task.prompt;
    let lastAssistantText = "";
    let approvalsAnswered = 0;
    let unexpectedSent = false;

    for (let turn = 0; turn < script.max_turns; turn += 1) {
      const before = adapter.events().length;
      const result = yield* Effect.result(session.send(text));
      if (result._tag === "Failure") {
        yield* adapter.recordInfraError("model_session", String(result.failure));
        return adapter.events();
      }
      lastAssistantText = result.success.finalText;
      const fresh = adapter.events().slice(before);

      const request = fresh.findLast((event) => event.type === "approval_requested");
      if (request !== undefined && request.type === "approval_requested") {
        const { reply, text: userText } = scriptedReply(
          script,
          approvalsAnswered === 0 ? "confirm" : "reconfirm",
        );
        approvalsAnswered += 1;
        const granted = yield* Effect.result(
          adapter.recordUserReply(request.approval_id, reply, userText),
        );
        if (granted._tag === "Failure") {
          text = `${userText}\n(The signer refused this approval: ${granted.failure.message})`;
        } else {
          text = userText;
        }
        continue;
      }

      const acted = approvalsAnswered > 0 || adapter.events().some(isAdapterAction);
      if (acted || unexpectedSent) break;
      yield* adapter
        .recordUserReply(undefined, { kind: "text", text: script.unexpected }, script.unexpected)
        .pipe(Effect.orDie);
      unexpectedSent = true;
      text = script.unexpected;
    }

    if (!adapter.events().some((event) => event.type === "final_answer")) {
      yield* adapter.recordFinalAnswer({ text: lastAssistantText });
    }
    return adapter.events();
  });
