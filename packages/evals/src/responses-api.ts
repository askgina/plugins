import { listCatalogToolNames, PRODUCTION_MCP_URL, READ_SCOPE } from "@askgina/contracts";
import { Clock, Data, DateTime, Duration, Effect, Function, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import type { PluginEvalCase, PluginEvalObservation, PluginEvalToolCall } from "./contracts.js";
import { collectBoundedUtf8Output } from "./bounded-output.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 120_000;
export const RESPONSES_API_MAX_BODY_BYTES = 2_097_152;
const CANONICAL_ALLOWED_TOOLS = listCatalogToolNames();
const UTF8_ENCODER = new TextEncoder();
const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const JsonObjectSchema = Schema.Record(Schema.String, Schema.Json);
const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownEffect(UnknownJsonString);

const OpenAiResponsesPayloadSchema = Schema.Struct({
  status: Schema.String,
  output: Schema.Array(JsonObjectSchema),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: NonNegativeIntSchema,
      output_tokens: NonNegativeIntSchema,
      total_tokens: NonNegativeIntSchema,
    }),
  ),
});

type OpenAiResponsesPayload = typeof OpenAiResponsesPayloadSchema.Type;

const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const uniqueLeft = new Set(left);
  return uniqueLeft.size === left.length && right.every((tool) => uniqueLeft.has(tool));
};

export interface ResponsesApiTrialOptions {
  readonly apiKey: string;
  readonly mcpAuthorization: string;
  readonly model: string;
  readonly reasoning: string;
  readonly runId: string;
  readonly repetition: number;
  readonly serverUrl: string;
  readonly allowedTools: readonly string[];
  readonly timeoutMs?: number;
}

export class PluginEvalResponsesRequestError extends Data.TaggedError(
  "PluginEvalResponsesRequestError",
)<{
  readonly caseId: string;
  readonly reason: string;
}> {}

export class PluginEvalResponsesHttpError extends Data.TaggedError("PluginEvalResponsesHttpError")<{
  readonly caseId: string;
  readonly statusCode: number;
  readonly reason: string;
}> {}

export class PluginEvalResponsesDecodeError extends Data.TaggedError(
  "PluginEvalResponsesDecodeError",
)<{
  readonly caseId: string;
  readonly reason: string;
}> {}

export class PluginEvalResponsesTimeoutError extends Data.TaggedError(
  "PluginEvalResponsesTimeoutError",
)<{
  readonly caseId: string;
  readonly timeoutMs: number;
}> {}

export type PluginEvalResponsesError =
  | PluginEvalResponsesRequestError
  | PluginEvalResponsesHttpError
  | PluginEvalResponsesDecodeError
  | PluginEvalResponsesTimeoutError;

const jsonString = (value: Schema.Json | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const parseJsonBody = (
  text: string,
  caseId: string,
): Effect.Effect<unknown, PluginEvalResponsesDecodeError> =>
  decodeUnknownJson(text).pipe(
    Effect.mapError(
      () =>
        new PluginEvalResponsesDecodeError({
          caseId,
          reason: "OpenAI returned a non-JSON response",
        }),
    ),
  );

const decodeToolArguments = (
  encoded: string,
  caseId: string,
): Effect.Effect<Schema.JsonObject, PluginEvalResponsesDecodeError> =>
  parseJsonBody(encoded, caseId).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(JsonObjectSchema, { errors: "all" })),
    Effect.mapError(
      () =>
        new PluginEvalResponsesDecodeError({
          caseId,
          reason: "OpenAI returned invalid JSON MCP arguments",
        }),
    ),
  );

const extractToolCalls = (
  payload: OpenAiResponsesPayload,
  caseId: string,
): Effect.Effect<
  Readonly<{
    availableTools: readonly string[];
    toolCalls: readonly PluginEvalToolCall[];
  }>,
  PluginEvalResponsesDecodeError
> =>
  Effect.gen(function* () {
    const listItems = payload.output.filter((item) => item.type === "mcp_list_tools");
    const listItem = listItems[0];
    if (listItems.length !== 1 || listItem === undefined || !Array.isArray(listItem.tools)) {
      return yield* new PluginEvalResponsesDecodeError({
        caseId,
        reason: "OpenAI did not return exactly one valid MCP tool catalog",
      });
    }
    if (listItem.error !== undefined && listItem.error !== null) {
      return yield* new PluginEvalResponsesDecodeError({
        caseId,
        reason: "OpenAI reported an MCP tool discovery failure",
      });
    }

    const availableTools: string[] = [];
    for (const tool of listItem.tools) {
      if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
        return yield* new PluginEvalResponsesDecodeError({
          caseId,
          reason: "OpenAI returned an invalid MCP tool definition",
        });
      }
      const name = Reflect.get(tool, "name");
      if (typeof name !== "string" || name.length === 0) {
        return yield* new PluginEvalResponsesDecodeError({
          caseId,
          reason: "OpenAI returned an MCP tool definition without a name",
        });
      }
      availableTools.push(name);
    }

    const toolCalls = yield* Effect.forEach(
      payload.output.filter((item) => item.type === "mcp_call"),
      (item, sequence) =>
        Effect.gen(function* () {
          const name = jsonString(item.name);
          const encodedArguments = jsonString(item.arguments);
          if (name === undefined || name.length === 0 || encodedArguments === undefined) {
            return yield* new PluginEvalResponsesDecodeError({
              caseId,
              reason: "OpenAI returned an MCP call without a name or arguments",
            });
          }

          const outputValue = item.output;
          const callErrorValue = item.error;
          if (
            (outputValue !== undefined &&
              outputValue !== null &&
              typeof outputValue !== "string") ||
            (callErrorValue !== undefined &&
              callErrorValue !== null &&
              typeof callErrorValue !== "string")
          ) {
            return yield* new PluginEvalResponsesDecodeError({
              caseId,
              reason: "OpenAI returned an invalid MCP call result",
            });
          }

          const argumentsResult = yield* Effect.result(
            decodeToolArguments(encodedArguments, caseId),
          );
          const argumentError =
            argumentsResult._tag === "Failure" ? argumentsResult.failure.reason : undefined;
          const callFailed =
            typeof callErrorValue === "string" || outputValue === undefined || outputValue === null;

          return {
            sequence,
            name,
            arguments: argumentsResult._tag === "Success" ? argumentsResult.success : {},
            requested_scope: READ_SCOPE,
            ...(typeof outputValue === "string"
              ? { result_bytes: UTF8_ENCODER.encode(outputValue).byteLength }
              : {}),
            ...(!callFailed && argumentError === undefined
              ? {}
              : {
                  error: {
                    ...(argumentError === undefined ? {} : { code: "invalid_arguments" }),
                    message: argumentError ?? "MCP call failed",
                  },
                }),
          } satisfies PluginEvalToolCall;
        }),
      { concurrency: 1 },
    );

    return { availableTools, toolCalls };
  });

const extractFinalAnswer = (payload: OpenAiResponsesPayload): string | undefined => {
  const textParts: string[] = [];
  for (const item of payload.output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
      if (Reflect.get(part, "type") !== "output_text") continue;
      const text = Reflect.get(part, "text");
      if (typeof text === "string") textParts.push(text);
    }
  }
  return textParts.length === 0 ? undefined : textParts.join("\n");
};

const makeRequestBody = (evalCase: PluginEvalCase, options: ResponsesApiTrialOptions) => ({
  model: options.model,
  reasoning: { effort: options.reasoning },
  store: false,
  input: evalCase.turns.map((turn) => ({ role: turn.role, content: turn.content })),
  tools: [
    {
      type: "mcp",
      server_label: "ask_gina",
      server_description: "Ask Gina read-only market, portfolio, account, and research tools.",
      server_url: PRODUCTION_MCP_URL,
      authorization: options.mcpAuthorization,
      require_approval: "never",
      allowed_tools: [...options.allowedTools],
    },
  ],
});

const validateOptions = (
  evalCase: PluginEvalCase,
  options: ResponsesApiTrialOptions,
): Effect.Effect<void, PluginEvalResponsesRequestError> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    options.serverUrl !== PRODUCTION_MCP_URL ||
    options.apiKey.length === 0 ||
    options.mcpAuthorization.length === 0 ||
    options.model.length === 0 ||
    options.reasoning.length === 0 ||
    options.runId.length === 0 ||
    !Number.isSafeInteger(options.repetition) ||
    options.repetition <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !catalogsMatch(options.allowedTools, CANONICAL_ALLOWED_TOOLS)
  ) {
    return Effect.fail(
      new PluginEvalResponsesRequestError({
        caseId: evalCase.id,
        reason: "Responses trial options are invalid",
      }),
    );
  }
  return Effect.void;
};

const timeoutDurationMs = (timeoutMs: number | undefined): number =>
  timeoutMs !== undefined && Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;

export const runResponsesApiPluginEvalTrial = Function.dual<
  (
    options: ResponsesApiTrialOptions,
  ) => (
    evalCase: PluginEvalCase,
  ) => Effect.Effect<PluginEvalObservation, PluginEvalResponsesError, HttpClient.HttpClient>,
  (
    evalCase: PluginEvalCase,
    options: ResponsesApiTrialOptions,
  ) => Effect.Effect<PluginEvalObservation, PluginEvalResponsesError, HttpClient.HttpClient>
>(2, (evalCase, options) =>
  Effect.gen(function* () {
    yield* validateOptions(evalCase, options);
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const startedMillis = yield* Clock.currentTimeMillis;
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(OPENAI_RESPONSES_URL, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        acceptJson: true,
      }),
      makeRequestBody(evalCase, options),
    ).pipe(
      Effect.mapError(
        () =>
          new PluginEvalResponsesRequestError({
            caseId: evalCase.id,
            reason: "Failed to encode the OpenAI Responses request",
          }),
      ),
    );

    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        () =>
          new PluginEvalResponsesRequestError({
            caseId: evalCase.id,
            reason: "Failed to reach the OpenAI Responses API",
          }),
      ),
    );
    const responseBody = yield* collectBoundedUtf8Output(
      response.stream,
      RESPONSES_API_MAX_BODY_BYTES,
    ).pipe(
      Effect.mapError(
        () =>
          new PluginEvalResponsesRequestError({
            caseId: evalCase.id,
            reason: "Failed to read the OpenAI Responses payload",
          }),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new PluginEvalResponsesHttpError({
        caseId: evalCase.id,
        statusCode: response.status,
        reason: "OpenAI rejected the trial request",
      });
    }
    if (responseBody.truncated) {
      return yield* new PluginEvalResponsesDecodeError({
        caseId: evalCase.id,
        reason: "OpenAI Responses payload exceeded the byte limit",
      });
    }

    const parsed = yield* parseJsonBody(responseBody.text, evalCase.id);
    const payload = yield* Schema.decodeUnknownEffect(OpenAiResponsesPayloadSchema, {
      errors: "all",
    })(parsed).pipe(
      Effect.mapError(
        () =>
          new PluginEvalResponsesDecodeError({
            caseId: evalCase.id,
            reason: "OpenAI returned an unexpected Responses payload",
          }),
      ),
    );
    if (payload.status !== "completed") {
      return yield* new PluginEvalResponsesDecodeError({
        caseId: evalCase.id,
        reason: "OpenAI did not complete the Responses trial",
      });
    }
    const { availableTools, toolCalls } = yield* extractToolCalls(payload, evalCase.id);
    if (!catalogsMatch(availableTools, options.allowedTools)) {
      return yield* new PluginEvalResponsesDecodeError({
        caseId: evalCase.id,
        reason: "The imported MCP tool catalog did not match allowed_tools",
      });
    }
    const finishedMillis = yield* Clock.currentTimeMillis;
    const finalAnswer = extractFinalAnswer(payload);

    return {
      version: 1,
      run_id: options.runId,
      case_id: evalCase.id,
      target: "responses_api",
      model: options.model,
      repetition: options.repetition,
      started_at: startedAt,
      status: "completed",
      duration_ms: Math.max(0, finishedMillis - startedMillis),
      tool_calls: toolCalls,
      available_tools: availableTools,
      ...(payload.usage === undefined ? {} : { token_usage: payload.usage }),
      ...(finalAnswer === undefined ? {} : { final_answer: finalAnswer }),
    } satisfies PluginEvalObservation;
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutDurationMs(options.timeoutMs)),
      orElse: () =>
        Effect.fail(
          new PluginEvalResponsesTimeoutError({
            caseId: evalCase.id,
            timeoutMs: timeoutDurationMs(options.timeoutMs),
          }),
        ),
    }),
    Effect.withSpan("plugin_evals.responses_api_trial", {
      attributes: {
        "plugin_eval.case_id": evalCase.id,
        "plugin_eval.model": options.model,
        "plugin_eval.reasoning": options.reasoning,
        "plugin_eval.repetition": options.repetition,
      },
    }),
  ),
);
