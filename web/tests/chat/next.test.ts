import { describe, expect, it } from "vitest";

import { parseNext, withoutNext } from "@/lib/chat/next";

const reply = "Here is the plan.\n\n```next\nYes, fetch the data\n- Set R0 to 12\nRun it\nA fourth one\n```";

describe("next block", () => {
  it("parses up to three suggestions from the last complete block, dropping list markers", () => {
    expect(parseNext(reply)).toEqual(["Yes, fetch the data", "Set R0 to 12", "Run it"]);
    expect(parseNext("no block here")).toBeNull();
    expect(parseNext("```next\n\n```")).toEqual([]);
    expect(parseNext("```next\nstage: configure\nRun it\n```")).toEqual(["Run it"]);
    expect(parseNext("```next\n" + "x".repeat(100) + "\n```")![0]).toHaveLength(80);
    expect(parseNext("```next\nold\n```\ntext\n```next\nnew\n```")).toEqual(["new"]);
  });

  it("strips a complete or arriving block from the shown text", () => {
    expect(withoutNext(reply)).toBe("Here is the plan.");
    expect(withoutNext("Working on it.\n\n```ne")).toBe("Working on it.");
    expect(withoutNext("Working on it.\n\n``")).toBe("Working on it.");
    expect(withoutNext("Here is code:\n```python\nprint(1)\n```")).toBe("Here is code:\n```python\nprint(1)\n```");
    expect(withoutNext("Open block:\n```python\nprint(1)\n```")).toContain("print(1)");
  });

  it("leaves inline code at the end of a reply alone", () => {
    expect(withoutNext("The parameter is `beta`")).toBe("The parameter is `beta`");
    expect(withoutNext("Try setting `beta")).toBe("Try setting `beta");
    expect(withoutNext("Use `beta`.\n\n```next\nRun it\n```")).toBe("Use `beta`.");
  });
});
