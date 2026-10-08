import { describe, expect, it } from "vitest";

import { MODEL_IDS } from "@/lib/enums";
import { MODEL_PROFILES, costUsd, repairCostUsd } from "@/lib/models";

describe("price table", () => {
  it("prices every allowed model", () => {
    for (const id of MODEL_IDS) expect(MODEL_PROFILES[id]).toBeDefined();
    expect(MODEL_PROFILES["claude-opus-5-5"]).toEqual({ inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 });
    expect(MODEL_PROFILES["claude-opus-5"]).toEqual({ inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 });
    expect(MODEL_PROFILES["claude-sonnet-5-5"]).toEqual({ inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 });
  });

  it("costs a call by token kind", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 500_000 };
    expect(costUsd("claude-opus-5-5", usage)).toBeCloseTo(4 + 2 + 0.4 + 2.5, 9);
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 10, output_tokens: 0 })).toBeCloseTo(0.00002, 12);
  });

  it("prices a sim repair, falling back to Opus 5.5 for an unknown model", () => {
    expect(repairCostUsd({ model: "claude-sonnet-5-5", input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2, 9);
    expect(repairCostUsd({ model: "claude-mystery-9", input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(20, 9);
  });
});
