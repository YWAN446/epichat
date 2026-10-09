import { describe, expect, it } from "vitest";

import { STAGE_INDEX, advanceStage, deriveStage } from "@/lib/chat/stages";
import { emptyScenario } from "@/lib/tools/types";
import { params, rf } from "../tools/helpers";

describe("stages", () => {
  it("derives the stage from the scenario", () => {
    const s = emptyScenario();
    expect(deriveStage(s)).toBe("understand");
    s.params = params({});
    expect(deriveStage(s)).toBe("configure");
    s.dataSources.push(rf("birth_rate", 1));
    expect(deriveStage(s)).toBe("ground");
    expect(deriveStage(s, true)).toBe("run");
    s.hasRun = true;
    expect(deriveStage(s)).toBe("interpret");
    expect(deriveStage(s, true)).toBe("run");
    s.reportCurrent = true;
    s.hasReport = true;
    expect(deriveStage(s)).toBe("report");
    expect(deriveStage(s, true)).toBe("run");
    s.reportCurrent = false;
    expect(deriveStage(s)).toBe("interpret");
    expect(STAGE_INDEX).toEqual({ understand: 0, configure: 1, ground: 2, run: 3, interpret: 4, report: 5 });
  });

  it("advances and records each stage reached once", () => {
    const s = emptyScenario();
    expect(advanceStage(s)).toEqual({ stage: "understand", changed: false, reached: null });
    s.params = params({});
    expect(advanceStage(s)).toEqual({ stage: "configure", changed: true, reached: "configure" });
    expect(advanceStage(s)).toEqual({ stage: "configure", changed: false, reached: null });
    expect(advanceStage(s, true)).toEqual({ stage: "run", changed: true, reached: "run" });
    s.hasRun = true;
    expect(advanceStage(s)).toEqual({ stage: "interpret", changed: true, reached: "interpret" });
    s.reportCurrent = true;
    expect(advanceStage(s)).toEqual({ stage: "report", changed: true, reached: "report" });
    s.reportCurrent = false;
    expect(advanceStage(s)).toEqual({ stage: "interpret", changed: true, reached: null });
    expect(advanceStage(s, true)).toEqual({ stage: "run", changed: true, reached: null });
    expect(s.stageReached).toBe("report");
  });
});
