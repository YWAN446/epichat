import { describe, expect, it } from "vitest";

import { parseFenced, withoutFenced } from "@/lib/chat/fenced";
import { parseRecap, withoutHidden, withoutNext } from "@/lib/chat/next";

const LIMITS = { maxItems: 8, maxChars: 120 };
const reply = "Here is the plan.\n\n```recap\n- Measles in Kenya\n2. Population 2 million\n```\n\n```next\nRun it\n```";

describe("fenced blocks", () => {
  it("parses the last complete block with a tag, dropping list markers and applying the limits", () => {
    expect(parseFenced(reply, "recap", LIMITS)).toEqual(["Measles in Kenya", "Population 2 million"]);
    expect(parseFenced(reply, "next", { maxItems: 3, maxChars: 80 })).toEqual(["Run it"]);
    expect(parseFenced("no block", "recap", LIMITS)).toBeNull();
    expect(parseFenced("```recap\nold\n```\ntext\n```recap\nnew\n```", "recap", LIMITS)).toEqual(["new"]);
    expect(parseFenced("```recap\n" + "x".repeat(200) + "\n```", "recap", LIMITS)![0]).toHaveLength(120);
    expect(parseRecap("```recap\n1\n2\n3\n4\n5\n6\n7\n8\n9\n```")).toHaveLength(8);
    expect(parseRecap("```recap\nstage: run\nA\n```")).toEqual(["A"]);
  });

  it("strips every hidden block, complete or arriving, and leaves code blocks and inline code alone", () => {
    expect(withoutHidden(reply)).toBe("Here is the plan.");
    expect(withoutFenced("Text.\n\n```rec", ["next", "recap"])).toBe("Text.");
    expect(withoutFenced("Text.\n\n```ne", ["next", "recap"])).toBe("Text.");
    expect(withoutFenced("Text.\n\n``", ["next", "recap"])).toBe("Text.");
    expect(withoutHidden("Code:\n```python\nprint(1)\n```")).toBe("Code:\n```python\nprint(1)\n```");
    expect(withoutHidden("Use `beta`.\n\n```recap\nA\n```\n\n```next\nRun it\n```")).toBe("Use `beta`.");
    expect(withoutHidden("Try `beta")).toBe("Try `beta");
    expect(withoutNext("Keep.\n\n```recap\nA\n```")).toBe("Keep.\n\n```recap\nA\n```");
  });
});
