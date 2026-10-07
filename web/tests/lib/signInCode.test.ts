import { describe, expect, it } from "vitest";
import { SIGN_IN_CODE_LENGTH, isCompleteCode, tidyCode } from "@/lib/signInCode";

describe("sign-in code", () => {
  it("is eight digits", () => {
    expect(SIGN_IN_CODE_LENGTH).toBe(8);
  });

  it("keeps only digits from a paste and cuts to the code length", () => {
    expect(tidyCode(" 1234-5678 extra")).toBe("12345678");
    expect(tidyCode("123456789")).toBe("12345678");
    expect(tidyCode("abc")).toBe("");
  });

  it("is complete only at the full length", () => {
    expect(isCompleteCode("12345678")).toBe(true);
    expect(isCompleteCode("1234567")).toBe(false);
    expect(isCompleteCode("1234567a")).toBe(false);
  });
});
