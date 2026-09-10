import { Function } from "effect";

import { isUnknownRecord } from "./type-guards";

const MAX_GENERATION_ID_LENGTH = 128;
const MAX_RESPONSE_MODEL_LENGTH = 256;
const MAX_PROVIDER_LENGTH = 128;
export const OPENROUTER_GENERATION_EVIDENCE_MAX_STEP = 32;

export interface OpenRouterGenerationEvidence {
  readonly generationId: string | null;
  readonly responseModel: string | null;
  readonly provider: string | null;
  readonly step: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cost: number | null;
}

export interface OpenRouterDoGenerateCapture {
  readonly usage?: {
    readonly inputTokens?: { readonly total?: number | undefined };
    readonly outputTokens?: { readonly total?: number | undefined };
    readonly raw?: unknown;
  };
  readonly providerMetadata?: unknown;
  readonly response?: {
    readonly id?: unknown;
    readonly modelId?: unknown;
    readonly body?: unknown;
  };
  readonly content?: unknown;
  readonly request?: unknown;
}

const boundedObservedString = (value: unknown, maxLength: number): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  value === value.trim()
    ? value
    : null;

const boundedToken = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const boundedCost = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const openRouterMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (!isUnknownRecord(value) || !isUnknownRecord(value.openrouter)) return undefined;
  return value.openrouter;
};

export const captureOpenRouterGenerationEvidence = Function.dual<
  (step: number) => (result: OpenRouterDoGenerateCapture) => OpenRouterGenerationEvidence,
  (result: OpenRouterDoGenerateCapture, step: number) => OpenRouterGenerationEvidence
>(2, (result, step) => {
  const metadata = openRouterMetadata(result.providerMetadata);
  const raw = isUnknownRecord(result.usage?.raw) ? result.usage.raw : undefined;
  return {
    generationId: boundedObservedString(result.response?.id, MAX_GENERATION_ID_LENGTH),
    responseModel: boundedObservedString(result.response?.modelId, MAX_RESPONSE_MODEL_LENGTH),
    provider: boundedObservedString(metadata?.provider, MAX_PROVIDER_LENGTH),
    step,
    inputTokens: raw === undefined ? null : boundedToken(raw.prompt_tokens),
    outputTokens: raw === undefined ? null : boundedToken(raw.completion_tokens),
    totalTokens: raw === undefined ? null : boundedToken(raw.total_tokens),
    cost: raw === undefined ? null : boundedCost(raw.cost),
  };
});
