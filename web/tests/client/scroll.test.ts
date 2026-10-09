import { describe, expect, it } from "vitest";

import { isNearBottom, keepFollowing } from "@/lib/client/scroll";

describe("following the newest message", () => {
  it("counts the last 120 pixels as the end", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 500 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 500 })).toBe(false);
  });

  it("stops following on any scroll up, resumes near the end, and ignores a page that just grew", () => {
    expect(keepFollowing(true, 500, { scrollHeight: 2000, scrollTop: 400, clientHeight: 500 })).toBe(false);
    expect(keepFollowing(false, 400, { scrollHeight: 1000, scrollTop: 450, clientHeight: 500 })).toBe(true);
    expect(keepFollowing(true, 400, { scrollHeight: 3000, scrollTop: 400, clientHeight: 500 })).toBe(true);
    expect(keepFollowing(false, 400, { scrollHeight: 3000, scrollTop: 400, clientHeight: 500 })).toBe(false);
    // The page got shorter and the browser moved the view to its new end: still following.
    expect(keepFollowing(true, 1500, { scrollHeight: 1000, scrollTop: 500, clientHeight: 500 })).toBe(true);
  });
});
