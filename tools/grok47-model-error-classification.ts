/** A completed model mistake is gradeable; backend and incomplete runs are not. */
export const MODEL_ARGUMENT_FAILURE_POLICY = "completed-model-argument-failure-v1";

interface Observation {
  readonly status: string;
  readonly error?: string;
  readonly tool_calls: readonly { readonly name: string; readonly error?: unknown }[];
}

interface Score {
  readonly overall_pass: boolean;
  readonly routing: { readonly score: number };
  readonly arguments: { readonly score: number };
  readonly completion: { readonly score: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Run only after the caller verifies native evidence hashes and model identity.
 * Never modifies the observation or grade. Requires both explicit tool evidence
 * and an independent routing/arguments rejection from the existing grader.
 */
export const isCompletedModelArgumentFailure = (
  observation: Observation,
  nativeRecords: readonly unknown[],
  score: Score,
): boolean => {
  if (
    observation.status !== "failed" ||
    observation.error !== "OMP tool execution failed" ||
    score.overall_pass ||
    score.completion.score !== 0 ||
    (score.routing.score !== 0 && score.arguments.score !== 0)
  )
    return false;

  const failed = observation.tool_calls.filter((call) => call.error != null);
  if (failed.length === 0) return false;
  const remaining = new Map<string, number>();
  for (const call of failed) remaining.set(call.name, (remaining.get(call.name) ?? 0) + 1);

  const messages = nativeRecords.flatMap((record) =>
    isRecord(record) && record.type === "message" && isRecord(record.message)
      ? [record.message]
      : [],
  );
  const finalMessage = messages.at(-1);
  if (finalMessage?.role !== "assistant" || finalMessage.stopReason !== "stop") return false;
  if (
    messages.some(
      (message) =>
        message.role === "assistant" &&
        (message.stopReason === "error" || message.errorMessage != null),
    )
  )
    return false;

  const seenIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    // A native process/tool error is distinct from a completed MCP response.
    if (message.isError === true) return false;
    if (!Array.isArray(message.content)) return false;
    const errors = message.content.flatMap((block: unknown) => {
      if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return [];
      const envelope = parseObject(block.text);
      return envelope?.isError === true ? [envelope] : [];
    });
    if (errors.length === 0) continue;
    if (
      errors.length !== 1 ||
      typeof message.toolName !== "string" ||
      typeof message.toolCallId !== "string" ||
      seenIds.has(message.toolCallId)
    )
      return false;
    seenIds.add(message.toolCallId);
    const content = errors[0]?.content;
    if (
      !Array.isArray(content) ||
      content.length === 0 ||
      !content.every(
        (block: unknown) =>
          isRecord(block) &&
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.startsWith("Error (INVALID_ARGUMENTS):"),
      )
    )
      return false;

    const nativeName = message.toolName.toLowerCase();
    const matching = [...remaining.keys()].filter((name) =>
      [
        name.toLowerCase(),
        `mcp__gina__${name.replace(".", "_").toLowerCase()}`,
        `mcp__ai_sdk_harness_tools_${name.replace(".", "_").toLowerCase()}`,
      ].includes(nativeName),
    );
    if (matching.length !== 1) return false;
    const name = matching[0];
    if (name === undefined || (remaining.get(name) ?? 0) < 1) return false;
    remaining.set(name, (remaining.get(name) ?? 0) - 1);
  }
  return [...remaining.values()].every((count) => count === 0);
};
