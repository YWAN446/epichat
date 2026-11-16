import type { ModelId } from "./enums";

/** Dollars per million tokens, by token kind. */
export type ModelProfile = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
};

export const MODEL_PROFILES: Record<ModelId, ModelProfile> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
};

/** The token counts on an API response's `usage` object. */
export type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function costUsd(model: ModelId, usage: UsageLike): number {
  const p = MODEL_PROFILES[model];
  const perMillion =
    usage.input_tokens * p.inputPerMTok +
    usage.output_tokens * p.outputPerMTok +
    (usage.cache_read_input_tokens ?? 0) * p.cacheReadPerMTok +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWritePerMTok;
  return perMillion / 1_000_000;
}

function isModelId(model: string): model is ModelId {
  return Object.hasOwn(MODEL_PROFILES, model);
}

/** A sim-service repair call: the service reports the model and tokens; the web app prices them. */
export function repairCostUsd(usage: { model: string; input_tokens: number; output_tokens: number }): number {
  const model: ModelId = isModelId(usage.model) ? usage.model : "claude-opus-5-5";
  return costUsd(model, { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
}
