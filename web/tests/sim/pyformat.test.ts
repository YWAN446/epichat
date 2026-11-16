import { describe, expect, it } from "vitest";

import { commaInt, f1, fmtValue, g4, pyRound } from "@/lib/sim/pyformat";

describe("g4 (Python .4g)", () => {
  const cases: [number, string][] = [
    [0, "0"], [1, "1"], [12.125, "12.12"], [2.5, "2.5"], [1234.5, "1234"], [12345.6, "1.235e+04"],
    [0.00012345, "0.0001234"], [0.0001, "0.0001"], [1e-5, "1e-05"], [123456789, "1.235e+08"],
    [33.333333, "33.33"], [2.675, "2.675"], [15, "15"], [100, "100"], [0.1 + 0.2, "0.3"],
    [99995, "1e+05"], [9999.5, "1e+04"], [0.99995, "1"], [-3.14159, "-3.142"], [1.0625, "1.062"],
    [8, "8"], [11, "11"], [30, "30"], [365.25, "365.2"], [182.625, "182.6"],
  ];
  it.each(cases)("g4(%s) = %s", (x, expected) => expect(g4(x)).toBe(expected));
  it("g4 and f1 match Python on ties", () => {
    expect(g4(12.125)).toBe("12.12");   // exact binary tie, half to even
    expect(g4(1.0625)).toBe("1.062");
    expect(f1(2.25)).toBe("2.2");
    expect(f1(0.25)).toBe("0.2");
    expect(f1(2.35)).toBe("2.4");        // not a tie in binary: 2.35000000000000008…
  });
});

describe("f1 (Python .1f)", () => {
  const cases: [number, string][] = [
    [2.25, "2.2"], [2.35, "2.4"], [15, "15.0"], [0.05, "0.1"], [14.95, "14.9"], [21, "21.0"],
    [2.675, "2.7"], [0.25, "0.2"], [0.35, "0.3"], [1.45, "1.4"], [100, "100.0"],
  ];
  it.each(cases)("f1(%s) = %s", (x, expected) => expect(f1(x)).toBe(expected));
});

describe("pyRound (Python round)", () => {
  it("rounds to 6, 3, 2, and 0 digits like Python", () => {
    expect(pyRound(0.1234565, 6)).toBe(0.123456);
    expect(pyRound(2.5e-7, 6)).toBe(0);
    expect(pyRound(1.0000005, 6)).toBe(1.000001);
    expect(pyRound(22.8125, 6)).toBe(22.8125);
    expect(pyRound(0.4722222222, 6)).toBe(0.472222);
    expect(pyRound(12.3456785, 6)).toBe(12.345678);
    expect(pyRound(1.5e-6, 6)).toBe(2e-6);
    expect(pyRound(21.5765, 3)).toBe(21.576);
    expect(pyRound(12.3455, 3)).toBe(12.345);
    expect(pyRound(0.0005, 3)).toBe(0.001);
    expect(pyRound(65.0005, 3)).toBe(65.001);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(1.005, 2)).toBe(1);
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(14.995, 2)).toBe(14.99);
    expect(pyRound(2.345, 2)).toBe(2.35);
    expect(pyRound(0.5)).toBe(0);
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(252)).toBe(252);
    expect(pyRound(5.5)).toBe(6);
  });
});

describe("commaInt and fmtValue", () => {
  it("formats like the Streamlit app", () => {
    expect(commaInt(213000000)).toBe("213,000,000");
    expect(commaInt(5000)).toBe("5,000");
    expect(commaInt(42)).toBe("42");
    expect(fmtValue(true)).toBe("True");
    expect(fmtValue(false)).toBe("False");
    expect(fmtValue(213000000)).toBe("213,000,000");
    expect(fmtValue(2500000.5)).toBe("2,500,000");
    expect(fmtValue(1234.5)).toBe("1,234");
    expect(fmtValue(12345.6)).toBe("1.235e+04");
    expect(fmtValue(0.5)).toBe("0.5");
    expect(fmtValue(999.95)).toBe("1,000");
    expect(fmtValue({ a: 1, b: 2.5, c: "x", d: 4 })).toBe("a: 1, b: 2.5, c: x");
    expect(fmtValue("hello")).toBe("hello");
    expect(fmtValue(null)).toBe("None");
  });
});
