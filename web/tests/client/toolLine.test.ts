import { describe, expect, it } from "vitest";

import { TOOL_LABELS, TOOL_STATUS, statusLabel, toolLabel, toolLine } from "@/lib/client/toolLine";
import type { ConfigPayload } from "@/lib/tools/types";

const CONFIG: ConfigPayload & { duration_ms: number } = {
  kind: "config", applied: { disease: "measles", r0: 12 }, approx_r0: 12.0,
  config: { disease: "measles", disease_type: "sir", country: "KEN", n_agents: 10000, sim_dur_years: 1, dur_inf: 8, dur_exp: null, interventions: [] },
  warnings: ["r0 high"], new_scenario: false, duration_ms: 12,
};

describe("tool lines", () => {
  it("carries the Python labels", () => {
    expect(TOOL_LABELS.configure_simulation).toBe("⚙️ Configured simulation");
    expect(TOOL_LABELS.run_simulation).toBe("▶️ Simulation");
    expect(TOOL_LABELS.web_fetch).toBe("📄 Read page");
    expect(TOOL_STATUS.run_simulation).toBe("Running the simulation — this usually takes 1–2 minutes…");
    expect(TOOL_STATUS.lookup_disease).toBe("Looking up disease parameters…");
    expect(toolLabel("something_new")).toBe("🔧 something_new");
    expect(statusLabel("something_new")).toBe("Running something_new…");
  });

  it("formats the first four payload fields with Python's value formatting, skipping the card's bookkeeping", () => {
    expect(toolLine("configure_simulation", CONFIG, true)).toEqual({
      label: "⚙️ Configured simulation",
      detail: "applied: disease: measles, r0: 12; approx_r0: 12; config: disease: measles, disease_type: sir, country: KEN; warnings: r0 high",
      warn: false,
    });
  });

  it("cuts a long line as Python does (157 characters and an ellipsis) and marks an error", () => {
    const line = toolLine("lookup_disease", { kind: "tool_error", message: "x".repeat(300) }, false);
    expect(line.warn).toBe(true);
    expect(line.detail).toHaveLength(158);
    expect(line.detail.endsWith("…")).toBe(true);
    expect(toolLine("run_simulation", undefined, true)).toEqual({ label: "▶️ Simulation", detail: "", warn: false });
  });
});
