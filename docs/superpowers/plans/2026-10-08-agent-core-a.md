# Agent Core, Plan A (Libraries) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every library the chat route needs, tested without a network or a model: the price table, Python-parity formatting, the `SimParams` schema and R0 math, the Python-exported disease database and location table, the three data adapters, the simulation client, the six tools with their registry, the system prompt, and the suggestion and stage logic.

**Architecture:** Pure TypeScript modules under `web/lib/` with injected `fetch` and dependencies, so each is a unit test. Python stays the source of truth for the disease database, the system prompt text, and the parity fixture: three scripts export them into `web/data/` and `web/tests/fixtures/`, and a pytest proves the committed files are fresh. Plan B wires these into `/api/chat`, persistence, and the page.

**Tech Stack:** TypeScript on Next.js 16, zod 4, `@anthropic-ai/sdk` ^0.132.1 (types only in this plan), vitest 5; Python 3.10 for the export scripts and their tests.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-core-design.md` (parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`, section 9). The behavioral authority for everything "ported" is the Python package on `main`: `epichat/agent.py`, `epichat/schema.py`, `epichat/parser.py`, `epichat/disease_db.py`, `epichat/adapters/*.py`.

## Global Constraints

- Node 22, Next 16.3.8, zod ^4.6.5, vitest ^5.0.3 (already pinned). Add `@anthropic-ai/sdk` ^0.132.1. No `runtime = "edge"` anywhere.
- Python exports run with `py -3.10` locally and plain `python` in CI; they must be deterministic (sorted keys where order is not meaningful, `ensure_ascii=False`, `\n` line endings, trailing newline).
- Tool descriptions, property descriptions, error strings (`CONFIG ERROR: …`, `FETCH ERROR: …`, `SIMULATION ERROR: …`, `NO VACCINE INDICATOR: …`, `UNKNOWN DISEASE: …`, the `_NEEDS_CONFIG` text) are the Python strings verbatim, dashes included (U+2014 `—`, U+2013 `–`, U+2080 `₀`).
- `DEFAULT_BETA = 22.8125`; beta clamped to [0.001, 1000] and rounded to 6 decimals with Python's round-half-even; `approx_r0` reported with `round(x, 2)`.
- Tool definitions sent to the model: fixed order `configure_simulation, lookup_disease, fetch_demographics, fetch_health_system, fetch_vaccination_coverage, run_simulation`; each with `eager_input_streaming: true` and `additionalProperties: false`; nothing per-request in them.
- Every adapter and the sim client take an injected `fetch`, never throw, and abort after 15 s (adapters) or the sim's own budget (client: 290 s).
- Price table (dollars per million tokens): Opus 5.5 4 / 20 / 0.20 / 5; Opus 5 5 / 25 / 0.50 / 6.25; Sonnet 5.5 2 / 10 / 0.20 / 2.50.
- Commit messages end with the attribution lines the session provides.

## Review Focus

1. The model sends `null` for an optional tool parameter (the Python schema allowed `anyOf [T, null]`): it must be treated as "not passed", never as an invalid input. Pinned in Task 8 (`treats null fields as not passed`).
2. Disease aliases containing regex characters or hyphens (`sars-cov-2`, `covid-19`, `hepatitis-a`) must detect inside free text and must not match inside longer words (`flu` in `fluid`). Pinned in Task 5 (`detects hyphenated aliases and respects word boundaries`).
3. The UN CSV arrives with `\r\n` line endings, a `sep=|` first line, and may have fewer columns than expected: parsing must not crash and must map what is there. Pinned in Task 6 (`parses CRLF and the sep line`).
4. Python's `.4g` and `.1f` on exact binary ties (`12.125`, `2.25`) round half to even; JavaScript's `toPrecision`/`toFixed` round the other way. Pinned in Task 2 (`g4 and f1 match Python on ties`).
5. `fetch_demographics` with a UN response that carries rates but no age rows (a partial response) must apply the rates and leave the network and beta alone. Pinned in Task 9 (`applies partial fields without switching the network`).

---

## File structure

| Path | Responsibility |
|---|---|
| `web/lib/models.ts` | `MODEL_PROFILES`, `costUsd`, `repairCostUsd` (Task 1) |
| `web/lib/config.ts` | `unApiKey` setting (Task 1) |
| `web/lib/sim/pyformat.ts` | `pyRound`, `g4`, `f1`, `commaInt`, `fmtValue` (Task 2) |
| `web/lib/sim/params.ts` | `SimParamsSchema`, `InterventionSchema`, `DEFAULT_BETA`, `validateParams`, `approxR0`, `calibrateBeta`, `recalibrateBeta`, `getVaccine/getTreatment/getSeasonality` (Task 3) |
| `scripts/export_web_data.py` | `web/data/disease_db.json`, `web/data/system_prompt.json` (Task 4) |
| `scripts/export_un_locations.py` | `web/data/un_locations.json` (Task 4) |
| `scripts/export_parity_fixtures.py` | `web/tests/fixtures/parity.json`, `web/tests/fixtures/adapters/*` (Task 4) |
| `tests/test_web_exports.py` | determinism and freshness (Task 4) |
| `web/lib/disease/db.ts`, `checkParams.ts` | lookup, detection, warnings (Task 5) |
| `web/lib/data/types.ts`, `unWpp.ts`, `whoGho.ts`, `wbData360.ts` | adapters (Task 6) |
| `web/lib/sim/client.ts` | `createSimClient` (Task 7) |
| `web/lib/tools/types.ts`, `index.ts`, `configureSimulation.ts`, `lookupDisease.ts` | registry and the first two tools (Task 8) |
| `web/lib/tools/fetchDemographics.ts`, `fetchHealthSystem.ts`, `fetchVaccinationCoverage.ts` | the three fetch tools (Task 9) |
| `web/lib/tools/runSimulation.ts` | the run tool (Task 10) |
| `web/lib/chat/prompt.ts`, `next.ts`, `stages.ts` | prompt, suggestions, stages (Task 11) |

Test files live beside the existing ones: `web/tests/lib/*.test.ts`, `web/tests/tools/*.test.ts`, `web/tests/data/*.test.ts`, `web/tests/sim/*.test.ts`, `web/tests/chat/*.test.ts`.

Spec refinements this plan makes: the system prompt text is exported by Python into `web/data/system_prompt.json` and imported, instead of being transcribed, so the port is verbatim by construction and the freshness test covers it; a `ToolContext` object (section 6's `ToolDeps`) carries `now` for timing. Everything else follows the spec.

---

### Task 1: SDK dependency, price table, UN key setting

**Files:**
- Modify: `web/package.json` (add the dependency)
- Create: `web/lib/models.ts`
- Modify: `web/lib/config.ts`, `web/.env.example`
- Test: `web/tests/lib/models.test.ts`, `web/tests/lib/config.test.ts` (append)

**Interfaces:**
- Consumes: `MODEL_IDS`, `ModelId` from `lib/enums.ts`.
- Produces:
  ```ts
  export type ModelProfile = { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number; cacheWritePerMTok: number };
  export const MODEL_PROFILES: Record<ModelId, ModelProfile>;
  export type UsageLike = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
  export function costUsd(model: ModelId, usage: UsageLike): number;
  /** Prices a sim repair's {model, input_tokens, output_tokens}; an unknown model is priced as Opus 5.5. */
  export function repairCostUsd(usage: { model: string; input_tokens: number; output_tokens: number }): number;
  // config.ts: Settings gains `unApiKey: string` from UN_API_KEY (default "").
  ```

- [ ] **Step 1: Add the SDK**

Run: `npm --prefix web install @anthropic-ai/sdk@^0.132.1`
Expected: `package.json` lists `"@anthropic-ai/sdk": "^0.132.1"`; `npm --prefix web run typecheck` still passes.

- [ ] **Step 2: Write the failing tests**

```ts
// web/tests/lib/models.test.ts
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
```

Append to `web/tests/lib/config.test.ts`:

```ts
describe("UN_API_KEY", () => {
  it("defaults to empty and reads the variable", () => {
    expect(loadSettings({}).unApiKey).toBe("");
    expect(loadSettings({ UN_API_KEY: "tok" }).unApiKey).toBe("tok");
  });
});
```

(If that file imports `loadSettings` under another name or lacks `describe`, match its existing imports.)

- [ ] **Step 3: Run them to verify they fail**

Run: `npm --prefix web test -- tests/lib/models.test.ts tests/lib/config.test.ts`
Expected: models suite fails to resolve `@/lib/models`; the config test fails on `unApiKey` being undefined.

- [ ] **Step 4: Implement**

```ts
// web/lib/models.ts
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
```

In `web/lib/config.ts`: add `unApiKey: string;` to `Settings` (after `simSharedSecret`) and `unApiKey: env.UN_API_KEY ?? "",` in `loadSettings`. In `web/.env.example`, after the Anthropic block add:

```
# UN Population Data Portal bearer for live demographics (fetch_demographics).
# Empty is allowed: the UN call then goes without a bearer and the sim's CSV
# fallback covers a failure.
UN_API_KEY=
```

- [ ] **Step 5: Run the tests, typecheck, lint**

Run: `npm --prefix web test -- tests/lib/models.test.ts tests/lib/config.test.ts && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/models.ts web/lib/config.ts web/.env.example web/tests/lib/models.test.ts web/tests/lib/config.test.ts
git commit -m "feat(web): price table, repair pricing, UN_API_KEY setting, Anthropic SDK dependency"
```

---

### Task 2: Python formatting parity

**Files:**
- Create: `web/lib/sim/pyformat.ts`
- Test: `web/tests/sim/pyformat.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function pyRound(x: number, digits?: number): number;   // Python round(): half to even on the exact binary value; digits 0 returns an integer-valued number
  export function g4(x: number): string;                        // Python f"{x:.4g}"
  export function f1(x: number): string;                        // Python f"{x:.1f}"
  export function commaInt(n: number): string;                  // Python f"{n:,}" for integers
  export function fmtValue(v: unknown): string;                 // epichat.chat_controller._fmt_value
  ```

- [ ] **Step 1: Write the failing tests**

The expected strings below were produced by Python 3.10 on 2026-10-08 and are the contract.

```ts
// web/tests/sim/pyformat.test.ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/sim/pyformat.test.ts`
Expected: cannot resolve `@/lib/sim/pyformat`.

- [ ] **Step 3: Implement**

The trick that makes ties come out like Python: work on the exact decimal expansion of the binary value (`toFixed(25)` is exact to 25 places), so a "tie" is only a tie when the binary value really is one.

```ts
// web/lib/sim/pyformat.ts
/**
 * Python number formatting, reproduced so warning texts and tool lines match
 * the Streamlit app and the parity fixture. Python rounds the exact binary
 * value half to even; JavaScript's toFixed/toPrecision round ties the other
 * way, so every function here goes through the exact decimal expansion.
 */

const EXACT_DIGITS = 25;

/** Digits of |x| as an integer string and the position of the decimal point, from the exact expansion. */
function exactDecimal(x: number): { digits: string; pointAt: number; negative: boolean } {
  const negative = x < 0;
  const fixed = Math.abs(x).toFixed(EXACT_DIGITS);         // "12.1250000000000000000000000"
  const [whole, frac] = fixed.split(".");
  return { digits: whole + frac, pointAt: whole.length, negative };
}

/** Round the digit string to `keep` digits after the point, half to even on the exact expansion. */
function roundDigits(digits: string, pointAt: number, keep: number): { digits: string; pointAt: number } {
  const cut = pointAt + keep;                              // digits kept
  if (cut >= digits.length) return { digits, pointAt };
  if (cut < 0) return { digits: "0", pointAt: 1 };
  const kept = digits.slice(0, cut);
  const rest = digits.slice(cut);
  const first = rest.charCodeAt(0) - 48;
  const tail = rest.slice(1);
  const exactlyHalf = first === 5 && /^0*$/.test(tail);
  let up = first > 5 || (exactlyHalf && ((kept.charCodeAt(kept.length - 1) - 48) % 2 === 1));
  if (first === 5 && !exactlyHalf) up = true;
  if (kept.length === 0) return up ? { digits: "1", pointAt: pointAt + 1 } : { digits: "0", pointAt: 1 };
  if (!up) return { digits: kept, pointAt };
  // add one to the kept digits
  const arr = kept.split("");
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === "9") { arr[i] = "0"; i--; }
    else { arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1); break; }
  }
  if (i < 0) { arr.unshift("1"); return { digits: arr.join(""), pointAt: pointAt + 1 }; }
  return { digits: arr.join(""), pointAt };
}

/** Python round(x, digits): half to even on the exact value. */
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const { digits: d, pointAt, negative } = exactDecimal(x);
  const r = roundDigits(d, pointAt, digits);
  const whole = r.digits.slice(0, r.pointAt) || "0";
  const frac = r.digits.slice(r.pointAt);
  const value = Number(`${whole}.${frac || "0"}`);
  return negative ? -value : value;
}

/** Python f"{x:.1f}". */
export function f1(x: number): string {
  const v = pyRound(x, 1);
  const s = Math.abs(v).toFixed(1);
  return (v < 0 || Object.is(v, -0) && x < 0 ? "-" : "") + s;
}

/** Python f"{x:.4g}": 4 significant digits, trailing zeros removed, exponent form when the exponent is below -4 or at least 4. */
export function g4(x: number): string {
  if (x === 0) return "0";
  if (!Number.isFinite(x)) return String(x);
  const negative = x < 0;
  const { digits, pointAt } = exactDecimal(Math.abs(x));
  // position of the first non-zero digit gives the decimal exponent
  const firstNonZero = digits.search(/[1-9]/);
  let exponent = pointAt - firstNonZero - 1;
  // round to 4 significant digits: keep (4 - exponent - 1) digits after the point
  let r = roundDigits(digits, pointAt, 3 - exponent);
  // rounding may have carried into a new leading digit (9999.5 -> 10000)
  const nz = r.digits.search(/[1-9]/);
  exponent = r.pointAt - nz - 1;
  if (exponent < -4 || exponent >= 4) {
    const sig = r.digits.slice(nz, nz + 4).padEnd(4, "0");
    const mantissa = (sig[0] + "." + sig.slice(1)).replace(/\.?0+$/, "");
    const sign = exponent < 0 ? "-" : "+";
    const abs = String(Math.abs(exponent)).padStart(2, "0");
    return (negative ? "-" : "") + `${mantissa}e${sign}${abs}`;
  }
  const whole = r.digits.slice(0, r.pointAt).replace(/^0+(?=\d)/, "") || "0";
  const frac = r.digits.slice(r.pointAt).replace(/0+$/, "");
  return (negative ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}

/** Python f"{n:,}" for an integer. */
export function commaInt(n: number): string {
  const s = Math.abs(Math.trunc(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + s;
}

/** epichat.chat_controller._fmt_value, with JavaScript's one number type: integers format as Python ints. */
export function fmtValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v === null || v === undefined) return "None";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return commaInt(v);
    if (Math.abs(v) >= 1e6) return commaInt(pyRound(v, 0));
    const s = g4(v);
    if (s.includes("e")) return s;
    const [whole, frac] = s.split(".");
    const grouped = commaInt(Number(whole)) ;
    return frac ? `${grouped}.${frac}` : grouped;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>).slice(0, 3).map(([k, vv]) => `${k}: ${String(vv)}`).join(", ");
  }
  return String(v);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix web test -- tests/sim/pyformat.test.ts`
Expected: all pass. If a `g4` case fails, print `exactDecimal` for it and compare against Python's `f"{x:.25f}"`: the rounding position is `3 - exponent` digits after the point.

- [ ] **Step 5: Commit**

```bash
git add web/lib/sim/pyformat.ts web/tests/sim/pyformat.test.ts
git commit -m "feat(sim): Python formatting parity helpers"
```

---

### Task 3: `SimParams` schema and the R0 math

**Files:**
- Create: `web/lib/sim/params.ts`
- Test: `web/tests/sim/params.test.ts`

**Interfaces:**
- Consumes: `pyRound` (Task 2).
- Produces:
  ```ts
  export const DEFAULT_BETA = 22.8125;
  export const DISEASE_TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"] as const;
  export const InterventionSchema: z.ZodType<Intervention, ...>;    // type alias normalization, capacity coercion
  export const SimParamsSchema: z.ZodType<SimParams, ...>;          // every pydantic field, default, bound, and the two model validators
  export type Intervention = { type: "vaccine" | "treatment" | "seasonality"; coverage: number | null; start_day: number; capacity: number | null; scale: number; shift: number };
  export type SimParams = { disease_type: DiseaseType; n_agents: number; n_contacts: number; network_type: "random" | "age_structured"; network_beta: number; beta: number; init_prev: number; dur_inf: number; dur_exp: number | null; dur_immune: number | null; p_death: number; p_asymp: number; rel_trans_asymp: number; sim_dur_years: number; interventions: Intervention[]; rand_seed: number | null; use_demographics: boolean; birth_rate: number; death_rate: number; age_pct_under18: number | null; age_pct_18_64: number | null; age_pct_over65: number | null; country: string | null; auto_demographics: boolean; demographics_year: number; demographics_source: string | null };
  export type ParamsResult = { ok: true; params: SimParams } | { ok: false; error: string };
  export function validateParams(input: unknown): ParamsResult;    // error text: "<n> validation error(s) for SimParams\n<field>\n  <message>" lines
  export function approxR0(p: SimParams): number;
  export function calibrateBeta(p: SimParams, targetR0: number): number;           // unclamped, unrounded, as Python _calibrate_beta
  export function clampBeta(beta: number): number;                                 // max(0.001, min(1000, beta)) then pyRound(., 6)
  export function recalibrateBeta(p: SimParams, r0Before: number, before: SimParams): SimParams;
  export function getVaccine(p: SimParams): Intervention | null; getTreatment; getSeasonality
  export function spectralRadius3(m: number[][]): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/sim/params.test.ts
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BETA, approxR0, calibrateBeta, clampBeta, getVaccine, recalibrateBeta, spectralRadius3, validateParams,
} from "@/lib/sim/params";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

describe("SimParams validation", () => {
  it("fills every default like pydantic", () => {
    const p = must({ beta: DEFAULT_BETA });
    expect(p).toMatchObject({
      disease_type: "sir", n_agents: 10000, n_contacts: 4, network_type: "random", network_beta: 1, beta: 22.8125,
      init_prev: 0.01, dur_inf: 10, dur_exp: null, dur_immune: null, p_death: 0, p_asymp: 0.3, rel_trans_asymp: 0.5,
      sim_dur_years: 1, interventions: [], rand_seed: null, use_demographics: false, birth_rate: 20, death_rate: 10,
      age_pct_under18: null, age_pct_18_64: null, age_pct_over65: null, country: null, auto_demographics: true,
      demographics_year: 2022, demographics_source: null,
    });
  });

  it("requires beta and enforces the bounds", () => {
    expect(validateParams({})).toEqual({ ok: false, error: expect.stringContaining("beta") });
    expect(validateParams({ beta: 1, n_agents: -5 }).ok).toBe(false);
    expect(validateParams({ beta: 1, n_agents: 5 }).ok).toBe(false);
    expect(validateParams({ beta: 1, n_agents: 1_000_001 }).ok).toBe(false);
    expect(validateParams({ beta: 0 }).ok).toBe(false);
    expect(validateParams({ beta: 1, init_prev: 1 }).ok).toBe(false);
    expect(validateParams({ beta: 1, sim_dur_years: 21 }).ok).toBe(false);
    expect(validateParams({ beta: 1, disease_type: "sirv" }).ok).toBe(false);
  });

  it("names the field in the error text like pydantic", () => {
    const r = validateParams({ beta: 1, n_agents: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^1 validation error for SimParams\nn_agents\n  /);
  });

  it("applies the two model validators with pydantic's messages", () => {
    const ages = validateParams({ beta: 1, age_pct_under18: 50, age_pct_18_64: 50, age_pct_over65: 10 });
    expect(ages.ok).toBe(false);
    if (!ages.ok) expect(ages.error).toContain("age_pct fields must sum to 100 (got 110.0)");
    const seir = validateParams({ beta: 1, disease_type: "seir" });
    expect(seir.ok).toBe(false);
    if (!seir.ok) expect(seir.error).toContain("dur_exp is required when disease_type is 'seir', 'seirs', or 'seiar'");
    const sirs = validateParams({ beta: 1, disease_type: "sirs" });
    if (!sirs.ok) expect(sirs.error).toContain("dur_immune is required when disease_type is 'sirs' or 'seirs'");
    expect(validateParams({ beta: 1, age_pct_under18: 30, age_pct_18_64: 60.5, age_pct_over65: 10 }).ok).toBe(true);
  });

  it("normalizes the country code and intervention aliases, and coerces capacity", () => {
    expect(must({ beta: 1, country: " bra " }).country).toBe("BRA");
    expect(must({ beta: 1, country: "Brazil" }).country).toBeNull();
    const p = must({ beta: 1, interventions: [{ type: "vaccination", coverage: 0.5 }, { type: "treat", capacity: 20.4 }, { type: "seasonal" }] });
    expect(p.interventions.map((i) => i.type)).toEqual(["vaccine", "treatment", "seasonality"]);
    expect(p.interventions[1].capacity).toBe(20);
    expect(p.interventions[0]).toEqual({ type: "vaccine", coverage: 0.5, start_day: 0, capacity: null, scale: 0.2, shift: 0 });
    expect(getVaccine(p)?.coverage).toBe(0.5);
  });
});

describe("R0 math", () => {
  it("matches the Python reference values", () => {
    expect(approxR0(must({ beta: DEFAULT_BETA }))).toBeCloseTo(2.5, 12);
    expect(approxR0(must({ beta: DEFAULT_BETA, network_type: "age_structured", age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8 }))).toBeCloseTo(3.54004728034979, 9);
    expect(approxR0(must({ beta: DEFAULT_BETA, network_type: "age_structured" }))).toBeCloseTo(6.8767640174459785, 9);
    expect(approxR0(must({ beta: DEFAULT_BETA, disease_type: "seiar", dur_exp: 3, p_asymp: 0.4, rel_trans_asymp: 0.5 }))).toBeCloseTo(2.0, 12);
  });

  it("calibrates beta to a target R0 and clamps and rounds like the agent", () => {
    const m = must({ beta: 1, dur_inf: 8 });
    expect(clampBeta(calibrateBeta(m, 15))).toBe(171.09375);
    expect(clampBeta(1e9)).toBe(1000);
    expect(clampBeta(1e-9)).toBe(0.001);
    expect(clampBeta(0.47222222222)).toBe(0.472222);
  });

  it("recalibrates after a network switch to hold the R0, and recovers a changed beta's intent", () => {
    const before = must({ beta: 171.09375, disease_type: "seir", dur_exp: 11, dur_inf: 8 });
    expect(approxR0(before)).toBeCloseTo(15, 9);
    const after = must({ ...before, network_type: "age_structured", age_pct_under18: 38.6, age_pct_18_64: 57.6, age_pct_over65: 3.8, use_demographics: true, birth_rate: 27.3, death_rate: 7.2, country: "KEN" });
    const rec = recalibrateBeta(after, approxR0(before), before);
    expect(rec.beta).toBe(120.827306);
    expect(approxR0(rec)).toBeCloseTo(15, 2);
    const changed = must({ ...before, beta: 2 });
    const rec2 = recalibrateBeta(changed, approxR0(before), before);
    expect(rec2.beta).toBe(2);
    expect(approxR0(rec2)).toBeCloseTo(0.1753, 4);
  });

  it("finds the dominant eigenvalue of the contact matrix to machine precision", () => {
    expect(spectralRadius3([[7, 2.5, 0.5], [2.5, 9, 1.5], [0.5, 1.5, 3.5]])).toBeCloseTo(6.8767640174459785 / (DEFAULT_BETA * 10 / 365), 10);
    expect(spectralRadius3([[2, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(2, 12);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/sim/params.test.ts`
Expected: cannot resolve `@/lib/sim/params`.

- [ ] **Step 3: Implement**

```ts
// web/lib/sim/params.ts
/**
 * The simulation parameter schema, a field-for-field port of epichat/schema.py
 * (pydantic), plus the R0 math from schema.py and parser.py. The sim service
 * validates again with the Python schema; this copy exists so the agent's
 * tools can merge, validate, and calibrate without a round trip.
 */
import { z } from "zod";
import { pyRound } from "./pyformat";

export const DEFAULT_BETA = 22.8125;
export const DISEASE_TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"] as const;
export type DiseaseType = (typeof DISEASE_TYPES)[number];
export const NETWORK_TYPES = ["random", "age_structured"] as const;
export const INTERVENTION_TYPES = ["vaccine", "treatment", "seasonality"] as const;

const TYPE_ALIASES: Record<string, string> = {
  vaccination: "vaccine", vaccinate: "vaccine",
  treat: "treatment", treatment_intervention: "treatment",
  seasonal: "seasonality",
};

const nullable = <T extends z.ZodTypeAny>(inner: T) => inner.nullable().default(null);

export const InterventionSchema = z.object({
  type: z.preprocess((v) => (typeof v === "string" ? (TYPE_ALIASES[v.toLowerCase()] ?? v) : v), z.enum(INTERVENTION_TYPES)),
  coverage: nullable(z.number().min(0).max(1)),
  start_day: z.number().int().min(0).default(0),
  capacity: nullable(z.preprocess((v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v) : v), z.number().int().min(1))),
  scale: z.number().min(0).max(1).default(0.2),
  shift: z.number().min(0).max(1).default(0),
});
export type Intervention = z.infer<typeof InterventionSchema>;

const country = z.preprocess((v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  return s.length === 3 && /^[A-Z]{3}$/.test(s) ? s : null;
}, z.string().nullable()).default(null);

export const SimParamsSchema = z
  .object({
    disease_type: z.enum(DISEASE_TYPES).default("sir"),
    n_agents: z.number().int().min(10).max(1_000_000).default(10000),
    n_contacts: z.number().int().min(1).max(100).default(4),
    network_type: z.enum(NETWORK_TYPES).default("random"),
    network_beta: z.number().gt(0).max(10).default(1),
    beta: z.number().gt(0).max(1000),
    init_prev: z.number().gt(0).lt(1).default(0.01),
    dur_inf: z.number().gt(0).default(10),
    dur_exp: nullable(z.number().gt(0)),
    dur_immune: nullable(z.number().gt(0)),
    p_death: z.number().min(0).max(1).default(0),
    p_asymp: z.number().min(0).max(1).default(0.3),
    rel_trans_asymp: z.number().min(0).max(1).default(0.5),
    sim_dur_years: z.number().gt(0).max(20).default(1),
    interventions: z.array(InterventionSchema).default([]),
    rand_seed: nullable(z.number().int()),
    use_demographics: z.boolean().default(false),
    birth_rate: z.number().gt(0).default(20),
    death_rate: z.number().gt(0).default(10),
    age_pct_under18: nullable(z.number().min(0).max(100)),
    age_pct_18_64: nullable(z.number().min(0).max(100)),
    age_pct_over65: nullable(z.number().min(0).max(100)),
    country,
    auto_demographics: z.boolean().default(true),
    demographics_year: z.number().int().min(1950).max(2100).default(2022),
    demographics_source: nullable(z.string()),
  })
  .superRefine((p, ctx) => {
    const pcts = [p.age_pct_under18, p.age_pct_18_64, p.age_pct_over65];
    if (pcts.every((x) => x !== null)) {
      const total = (pcts as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 1) {
        ctx.addIssue({ code: "custom", message: `Value error, age_pct fields must sum to 100 (got ${total.toFixed(1)})`, path: [] });
      }
    }
    if (["seir", "seirs", "seiar"].includes(p.disease_type) && p.dur_exp === null) {
      ctx.addIssue({ code: "custom", message: "Value error, dur_exp is required when disease_type is 'seir', 'seirs', or 'seiar'", path: [] });
    }
    if (["sirs", "seirs"].includes(p.disease_type) && p.dur_immune === null) {
      ctx.addIssue({ code: "custom", message: "Value error, dur_immune is required when disease_type is 'sirs' or 'seirs'", path: [] });
    }
  });
export type SimParams = z.infer<typeof SimParamsSchema>;

export type ParamsResult = { ok: true; params: SimParams } | { ok: false; error: string };

/** Validate like pydantic's model_validate; the error text has pydantic's shape so CONFIG ERROR results read the same. */
export function validateParams(input: unknown): ParamsResult {
  const r = SimParamsSchema.safeParse(input);
  if (r.success) return { ok: true, params: r.data };
  const issues = r.error.issues;
  const lines = issues.map((i) => `${i.path.length ? i.path.join(".") : "SimParams"}\n  ${i.message}`);
  const n = issues.length;
  return { ok: false, error: `${n} validation error${n === 1 ? "" : "s"} for SimParams\n${lines.join("\n")}` };
}

export function getVaccine(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "vaccine") ?? null;
}
export function getTreatment(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "treatment") ?? null;
}
export function getSeasonality(p: SimParams): Intervention | null {
  return p.interventions.find((i) => i.type === "seasonality") ?? null;
}

/** The POLYMOD-inspired three-group contact matrix shared with the templates. */
export const CONTACT_MATRIX: number[][] = [[7.0, 2.5, 0.5], [2.5, 9.0, 1.5], [0.5, 1.5, 3.5]];

/** Largest eigenvalue of a non-negative 3×3 matrix (its Perron root), by power iteration with Rayleigh refinement. */
export function spectralRadius3(m: number[][]): number {
  let v = [1, 1, 1];
  let lambda = 0;
  for (let k = 0; k < 2000; k++) {
    const w = m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    const norm = Math.hypot(w[0], w[1], w[2]);
    if (norm === 0) return 0;
    const next = w.map((x) => x / norm);
    const num = next.reduce((s, x, i) => s + x * (m[i][0] * next[0] + m[i][1] * next[1] + m[i][2] * next[2]), 0);
    const den = next.reduce((s, x) => s + x * x, 0);
    const estimate = num / den;
    const converged = Math.abs(estimate - lambda) <= 1e-16 * Math.abs(estimate);
    lambda = estimate;
    v = next;
    if (converged && k > 50) break;
  }
  return lambda;
}

function asympFactor(p: SimParams): number {
  return p.disease_type === "seiar" ? 1 - p.p_asymp * (1 - p.rel_trans_asymp) : 1;
}

function hasAgeShares(p: SimParams): p is SimParams & { age_pct_under18: number; age_pct_18_64: number; age_pct_over65: number } {
  return p.age_pct_under18 !== null && p.age_pct_18_64 !== null && p.age_pct_over65 !== null;
}

function ngmUnit(p: SimParams): number[][] {
  if (!hasAgeShares(p)) return CONTACT_MATRIX;
  const pop = [p.age_pct_under18 / 100, p.age_pct_18_64 / 100, p.age_pct_over65 / 100];
  return CONTACT_MATRIX.map((row) => row.map((c, j) => c * pop[j]));
}

/** schema.py SimParams.approx_r0 */
export function approxR0(p: SimParams): number {
  const scale = p.beta * p.network_beta * asympFactor(p) * (p.dur_inf / 365);
  if (p.network_type === "age_structured") return scale * spectralRadius3(ngmUnit(p));
  return scale * p.n_contacts;
}

/** parser.py _calibrate_beta: the beta whose approx_r0 is target_r0 on the current network. Unclamped. */
export function calibrateBeta(p: SimParams, targetR0: number): number {
  const denomBase = p.network_beta * asympFactor(p) * (p.dur_inf / 365);
  const denom = p.network_type === "age_structured" ? denomBase * spectralRadius3(ngmUnit(p)) : denomBase * p.n_contacts;
  return targetR0 / denom;
}

/** The agent's clamp-and-round applied to every calibrated beta. */
export function clampBeta(beta: number): number {
  return pyRound(Math.max(0.001, Math.min(1000, beta)), 6);
}

/** parser.py recalibrate_beta */
export function recalibrateBeta(p: SimParams, r0Before: number, before: SimParams): SimParams {
  const target =
    Math.abs(p.beta - before.beta) > 1e-4
      ? p.beta * p.network_beta * asympFactor(p) * (p.dur_inf / 365) * p.n_contacts
      : r0Before;
  return { ...p, beta: clampBeta(calibrateBeta(p, target)) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix web test -- tests/sim/params.test.ts`
Expected: all pass. If `recalibrates…` fails on `120.827306` by one unit in the last place, the power iteration has not converged: raise the iteration cap, never loosen the assertion.

- [ ] **Step 5: Run the whole web suite, typecheck, lint; commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/sim/params.ts web/tests/sim/params.test.ts
git commit -m "feat(sim): SimParams schema and R0 calibration ported from the Python package"
```

---
### Task 4: Python exports and the parity fixture

**Files:**
- Create: `scripts/export_web_data.py`, `scripts/export_un_locations.py`, `scripts/export_parity_fixtures.py`
- Create (generated): `web/data/disease_db.json`, `web/data/system_prompt.json`, `web/data/un_locations.json`, `web/tests/fixtures/parity.json`, `web/tests/fixtures/adapters/*.csv|json`
- Modify: `web/package.json` (`sync-data` script)
- Test: `tests/test_web_exports.py`

**Interfaces:**
- Consumes: `epichat.disease_db.load_db/parameter_summary/_range_of/check_params`, `epichat.agent._SYSTEM`, `epichat.schema.SimParams`, `epichat.parser._calibrate_beta/recalibrate_beta`, the three adapters.
- Produces, read by Tasks 5, 6, 11:
  - `web/data/disease_db.json`: `{ "diseases": { key: { "display_name", "aliases": [...], "summaries": { param: ParameterSummary | null }, "flat": { param: { "min", "max", "typical", "source", "unit", "note", "range_text" } | null } } } }` in file order; the seven params are `r0, incubation_days, infectious_days, fatality_rate, average_contacts_daily, immunity_duration, asymptomatic_fraction`.
  - `web/data/system_prompt.json`: `{ "system": "<_SYSTEM verbatim>" }`.
  - `web/data/un_locations.json`: `{ "ABW": 533, ... }` sorted by key.
  - `web/tests/fixtures/parity.json`: `{ "version": 1, "params": [ { "input", "approx_r0", "calibrate": [ { "target_r0", "beta" } ], "recalibrate": [ { "r0_before", "before", "after_input", "beta" } ] } ], "warnings": [ { "disease", "r0", "dur_inf", "dur_exp", "p_death", "n_contacts", "dur_immune", "p_asymp", "warnings" } ], "adapters": { "un_wpp": [ { "file", "location_id", "fields" } ], "who_gho": [ { "codes", "files": {code: file}, "iso3", "fields" } ], "wb_data360": [ { "codes", "files", "iso3", "fields" } ] } }` where every `fields` item is `{ "field", "value", "citation", "description", "alternatives": [...] }`.

- [ ] **Step 1: Write the failing Python test**

```python
# tests/test_web_exports.py
"""The web app's data files are produced by Python and committed. These tests
prove the scripts are deterministic and that the committed files are fresh,
so a change on the Python side cannot leave the TypeScript side stale."""
import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _same(generated: Path, committed: Path):
    assert committed.exists(), f"{committed} is missing: run `npm --prefix web run sync-data`"
    assert generated.read_text(encoding="utf-8") == committed.read_text(encoding="utf-8"), (
        f"{committed.relative_to(ROOT)} is stale: run `npm --prefix web run sync-data`")


def test_export_web_data_is_deterministic_and_fresh(tmp_path):
    mod = _load("export_web_data")
    mod.main(tmp_path)
    mod.main(tmp_path / "again")
    for name in ("disease_db.json", "system_prompt.json"):
        assert (tmp_path / "data" / name).read_bytes() == (tmp_path / "again" / "data" / name).read_bytes()
        _same(tmp_path / "data" / name, WEB / "data" / name)


def test_disease_db_export_shape(tmp_path):
    mod = _load("export_web_data")
    mod.main(tmp_path)
    db = json.loads((tmp_path / "data" / "disease_db.json").read_text(encoding="utf-8"))
    keys = list(db["diseases"])
    assert keys[:2] == ["measles", "covid19"] and len(keys) == 16
    measles = db["diseases"]["measles"]
    assert measles["summaries"]["r0"]["status"] == "ok"
    assert measles["flat"]["r0"]["range_text"] == "12–18"
    assert db["diseases"]["dengue"]["flat"]["r0"]["range_text"] == "1.0–103.0"
    assert db["diseases"]["dengue"]["flat"]["fatality_rate"] is None
    assert measles["summaries"]["immunity_duration"]["status"] == "estimates_only"
    prompt = json.loads((tmp_path / "data" / "system_prompt.json").read_text(encoding="utf-8"))
    assert prompt["system"].startswith("You are EpiChat") and "—" in prompt["system"]


def test_export_parity_fixtures_is_deterministic_and_fresh(tmp_path):
    mod = _load("export_parity_fixtures")
    mod.main(tmp_path)
    mod.main(tmp_path / "again")
    fixtures = tmp_path / "tests" / "fixtures"
    for rel in sorted(p.relative_to(fixtures) for p in fixtures.rglob("*") if p.is_file()):
        assert (fixtures / rel).read_bytes() == (tmp_path / "again" / "tests" / "fixtures" / rel).read_bytes()
        _same(fixtures / rel, WEB / "tests" / "fixtures" / rel)
    parity = json.loads((fixtures / "parity.json").read_text(encoding="utf-8"))
    assert len(parity["params"]) >= 200
    assert len(parity["warnings"]) >= 300
    assert all(len(case["calibrate"]) == 3 for case in parity["params"])
    assert any(case["warnings"] for case in parity["warnings"])
    assert parity["adapters"]["un_wpp"] and parity["adapters"]["who_gho"] and parity["adapters"]["wb_data360"]


def test_un_locations_table_is_committed():
    table = json.loads((WEB / "data" / "un_locations.json").read_text(encoding="utf-8"))
    assert len(table) >= 200
    assert table["KEN"] == 404 and table["USA"] == 840 and table["BRA"] == 76
    assert list(table) == sorted(table)


@pytest.mark.skipif(not os.environ.get("EPICHAT_TEST_LIVE"), reason="Set EPICHAT_TEST_LIVE=1 to refresh from the UN API")
def test_un_locations_export_matches_the_committed_table(tmp_path):
    mod = _load("export_un_locations")
    mod.main(tmp_path)
    _same(tmp_path / "data" / "un_locations.json", WEB / "data" / "un_locations.json")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `py -3.10 -m pytest tests/test_web_exports.py -q`
Expected: every test fails or errors (`FileNotFoundError` for the scripts, missing committed files).

- [ ] **Step 3: Write the data export**

```python
# scripts/export_web_data.py
"""Export the disease database, pre-flattened, and the agent's system prompt
for the web app. Python stays the source of truth; the TypeScript side reads
these files and never re-derives summaries or range text.

    py -3.10 scripts/export_web_data.py          # writes web/data/
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.agent import _SYSTEM  # noqa: E402
from epichat.disease_db import _range_of, load_db, parameter_summary  # noqa: E402

PARAMS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
          "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def flat_view(entry: dict, param: str) -> dict | None:
    data = entry.get(param)
    if not isinstance(data, dict):
        return None
    rng = _range_of(entry, param)
    return {
        "min": data.get("min"),
        "max": data.get("max"),
        "typical": data.get("typical"),
        "source": data.get("source", ""),
        "unit": data.get("unit"),
        "note": data.get("note"),
        # Python prints an int as 12 and a float as 1.0; JavaScript cannot tell
        # them apart after parsing, so the text travels pre-rendered.
        "range_text": f"{rng[0]}–{rng[1]}" if rng else None,
    }


def disease_db_payload() -> dict:
    db = load_db()
    return {"diseases": {
        key: {
            "display_name": entry.get("display_name"),
            "aliases": list(entry.get("aliases", [])),
            "summaries": {p: parameter_summary(entry, p) for p in PARAMS},
            "flat": {p: flat_view(entry, p) for p in PARAMS},
        }
        for key, entry in db["diseases"].items()
    }}


def main(web_dir: Path = ROOT / "web") -> None:
    write_json(web_dir / "data" / "disease_db.json", disease_db_payload())
    write_json(web_dir / "data" / "system_prompt.json", {"system": _SYSTEM})


if __name__ == "__main__":
    main()
    print("wrote web/data/disease_db.json and web/data/system_prompt.json")
```

```python
# scripts/export_un_locations.py
"""Export the UN Population Data Portal's location table (ISO3 -> id) for the
web app, so the serverless adapter never has to download it at start-up.
Needs UN_API_KEY in the environment or the root .env.

    py -3.10 scripts/export_un_locations.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from epichat.adapters.un_wpp import UNWPPAdapter  # noqa: E402


def main(web_dir: Path = ROOT / "web") -> None:
    adapter = UNWPPAdapter(api_key=os.environ.get("UN_API_KEY") or None)
    table = adapter.iso3_table()
    if len(table) < 200:
        sys.exit("The UN locations list could not be fetched (is UN_API_KEY set?); nothing written.")
    out = web_dir / "data" / "un_locations.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(sorted(table.items())), indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
    print("wrote web/data/un_locations.json")
```

- [ ] **Step 4: Write the parity export**

```python
# scripts/export_parity_fixtures.py
"""Export the parity fixture the TypeScript tests pin themselves to: R0 math
on a few hundred seeded parameter sets, literature warnings on seeded
arguments, and the three adapters' row mapping on recorded responses.

    py -3.10 scripts/export_parity_fixtures.py   # writes web/tests/fixtures/
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.adapters.un_wpp import UNWPPAdapter  # noqa: E402
from epichat.adapters.who_gho import WHOGHOAdapter  # noqa: E402
from epichat.adapters.wb_data360 import WorldBankData360Adapter  # noqa: E402
from epichat.disease_db import check_params, load_db  # noqa: E402
from epichat.parser import _calibrate_beta, recalibrate_beta  # noqa: E402
from epichat.resolver import DataQuery, ResolvedField  # noqa: E402
from epichat.schema import SimParams  # noqa: E402

SEED = 20261008
TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"]

UN_HEADER = ("LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|"
             "Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|"
             "EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value")


def un_row(ind, time_id, year, method, age_id, age_label, value, variant="4", sex="3"):
    return (f"840|United States of America|USA|US|4|{ind}|x|x|27|World Population Prospects|0|{variant}|Median|Median|Median|"
            f"{time_id}|{year}|{year}.5|0|Not applicable|1|Model-based Estimates|{method}|m|{sex}|Both sexes|{age_id}|{age_label}|0|-1|0|{value}")


ADAPTER_FILES = {
    "un_wpp_birth_death.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(55, 73, 2022, 2, 188, "Total", "10.981"),
        un_row(55, 74, 2023, 2, 188, "Total", "10.648"),
        un_row(59, 74, 2023, 2, 188, "Total", "8.663"),
    ]) + "\n",
    "un_wpp_age.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(71, 74, 2023, 2, 188, "Total", "100"),
        un_row(71, 74, 2023, 2, 901, "0-17", "21.577"),
        un_row(71, 74, 2023, 2, 902, "65+", "17.432"),
    ]) + "\n",
    "un_wpp_population.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(49, 73, 2022, 3, 188, "Total", "333287558"),
        un_row(49, 74, 2023, 3, 188, "Total", "334914895"),
    ]) + "\n",
    "un_wpp_combined.csv": "sep =|\r\n" + UN_HEADER + "\r\n" + "\r\n".join([
        un_row(55, 74, 2023, 2, 188, "Total", "10.648"),
        un_row(59, 74, 2023, 2, 188, "Total", "8.663"),
        un_row(59, 74, 2023, 2, 188, "Total", "99", variant="2"),
        un_row(71, 74, 2023, 2, 901, "0-17", "21.577"),
        un_row(71, 74, 2023, 2, 902, "65+", "17.432"),
        un_row(49, 74, 2023, 2, 188, "Total", "334914.895"),
    ]) + "\r\n",
    "un_wpp_rates_only.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(55, 74, 2023, 2, 188, "Total", "27.342"),
        un_row(59, 74, 2023, 2, 188, "Total", "7.212"),
    ]) + "\n",
    "who_gho_coverage.json": json.dumps({"value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2021", "NumericValue": 72.0},
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2022", "NumericValue": 76.0},
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2023", "NumericValue": None},
    ]}, indent=1) + "\n",
    "who_gho_mcv2.json": json.dumps({"value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2022", "NumericValue": 61.0},
    ]}, indent=1) + "\n",
    "who_gho_empty.json": json.dumps({"value": []}, indent=1) + "\n",
    "wb_beds.json": json.dumps({"count": 2, "value": [
        {"OBS_VALUE": "2.3", "TIME_PERIOD": "2021", "REF_AREA": "KEN"},
        {"OBS_VALUE": "2.1", "TIME_PERIOD": "2020", "REF_AREA": "KEN"},
    ]}, indent=1) + "\n",
    "wb_physicians.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "0.2", "TIME_PERIOD": "2021", "REF_AREA": "KEN"}]}, indent=1) + "\n",
    "wb_nurses.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "1.1", "TIME_PERIOD": "2021", "REF_AREA": "KEN"}]}, indent=1) + "\n",
    "wb_uhc.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "56.0", "TIME_PERIOD": "2022", "REF_AREA": "KEN"}]}, indent=1) + "\n",
    "wb_null.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "null", "TIME_PERIOD": "2022", "REF_AREA": "KEN"}]}, indent=1) + "\n",
}

HEALTH_CODES = ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"]


def field_json(f: ResolvedField) -> dict:
    return {"field": f.field, "value": f.value, "citation": f.citation, "description": f.description,
            "alternatives": [field_json(a) for a in f.alternatives]}


def random_params(rng: random.Random) -> SimParams | None:
    disease_type = rng.choice(TYPES)
    network_type = rng.choice(["random", "age_structured"])
    base = {
        "disease_type": disease_type,
        "network_type": network_type,
        "n_agents": rng.choice([1000, 5000, 10000, 50000]),
        "n_contacts": rng.randint(1, 30),
        "network_beta": rng.choice([1.0, 0.5, 2.0]),
        "beta": round(rng.uniform(0.05, 300.0), 4),
        "dur_inf": round(rng.uniform(1.0, 30.0), 2),
        "p_death": round(rng.choice([0.0, 0.001, 0.01, 0.1]), 3),
    }
    if disease_type in ("seir", "seirs", "seiar"):
        base["dur_exp"] = round(rng.uniform(1.0, 21.0), 2)
    if disease_type in ("sirs", "seirs"):
        base["dur_immune"] = round(rng.uniform(30.0, 2000.0), 1)
    if disease_type == "seiar":
        base["p_asymp"] = round(rng.uniform(0.0, 1.0), 2)
        base["rel_trans_asymp"] = round(rng.uniform(0.0, 1.0), 2)
    if network_type == "age_structured" and rng.random() < 0.7:
        under = round(rng.uniform(10.0, 45.0), 1)
        over = round(rng.uniform(2.0, 20.0), 1)
        base.update({"age_pct_under18": under, "age_pct_over65": over, "age_pct_18_64": round(100.0 - under - over, 1)})
    try:
        return SimParams.model_validate(base)
    except Exception:
        return None


def params_cases(rng: random.Random) -> list[dict]:
    cases = []
    while len(cases) < 240:
        p = random_params(rng)
        if p is None:
            continue
        calibrate = []
        for target in (1.5, 3.0, 15.0):
            beta = max(0.001, min(1000.0, _calibrate_beta(p, target)))
            calibrate.append({"target_r0": target, "beta": round(beta, 6)})
        recalibrate = []
        switched = dict(p.model_dump())
        if p.network_type == "random":
            switched.update({"network_type": "age_structured", "age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8})
        else:
            switched.update({"network_type": "random"})
        for after_input in (switched, {**p.model_dump(), "beta": round(p.beta * 1.7, 4)}):
            after = SimParams.model_validate(after_input)
            rec = recalibrate_beta(after, p.approx_r0(), p)
            recalibrate.append({"r0_before": p.approx_r0(), "before": p.model_dump(), "after_input": after.model_dump(), "beta": rec.beta})
        cases.append({"input": p.model_dump(), "approx_r0": p.approx_r0(), "calibrate": calibrate, "recalibrate": recalibrate})
    return cases


def warning_cases(rng: random.Random) -> list[dict]:
    cases = []
    for disease in load_db()["diseases"]:
        for _ in range(25):
            args = {
                "r0": rng.choice([0.5, 1.3, 3.0, 15.0, 100.0]),
                "dur_inf": rng.choice([1.0, 5.0, 8.0, 12.125, 30.0]),
                "dur_exp": rng.choice([None, 2.0, 11.0, 20.0]),
                "p_death": rng.choice([None, 0.001, 0.05, 0.5]),
                "n_contacts": rng.choice([None, 4, 6, 40]),
                "dur_immune": rng.choice([None, 10.0, 400.0, 36525.0]),
                "p_asymp": rng.choice([None, 0.1, 0.3, 0.99]),
            }
            warnings = check_params(disease, args["r0"], args["dur_inf"], args["dur_exp"], p_death=args["p_death"],
                                    n_contacts=args["n_contacts"], dur_immune=args["dur_immune"], p_asymp=args["p_asymp"])
            cases.append({"disease": disease, **args, "warnings": warnings})
    return cases


def adapter_cases() -> dict:
    un = []
    with patch("epichat.adapters.un_wpp._fetch_text", return_value="sep =|\nId|Name|Iso3|Iso2\n840|United States of America|USA|US\n"):
        adapter = UNWPPAdapter(api_key=None)
    for name in ("un_wpp_birth_death.csv", "un_wpp_age.csv", "un_wpp_population.csv", "un_wpp_combined.csv", "un_wpp_rates_only.csv"):
        with patch("epichat.adapters.un_wpp._fetch_text", return_value=ADAPTER_FILES[name]):
            fields = adapter.fetch(DataQuery(source="un_wpp", indicators=[55, 59, 71, 49], location_id=840))
        un.append({"file": name, "location_id": 840, "fields": [field_json(f) for f in fields]})

    who = []
    for codes, files in (
        (["WHS8_110", "MCV2"], {"WHS8_110": "who_gho_coverage.json", "MCV2": "who_gho_mcv2.json"}),
        (["WHS8_110", "MCV2"], {"WHS8_110": "who_gho_coverage.json", "MCV2": "who_gho_empty.json"}),
        (["WHS3_41"], {"WHS3_41": "who_gho_empty.json"}),
    ):
        def who_fetch(url, files=files):
            for code, file in files.items():
                if f"/{code}?" in url:
                    return ADAPTER_FILES[file]
            raise AssertionError(url)
        with patch("epichat.adapters.who_gho._fetch_text", side_effect=who_fetch):
            fields = WHOGHOAdapter().fetch(DataQuery(source="who_gho", indicator_codes=codes, location_code="KEN"))
        who.append({"codes": codes, "files": files, "iso3": "KEN", "fields": [field_json(f) for f in fields]})

    wb = []
    for files in (
        {"WB_WDI_SH_MED_BEDS_ZS": "wb_beds.json", "WB_WDI_SH_MED_PHYS_ZS": "wb_physicians.json",
         "WB_WDI_SH_MED_NUMW_P3": "wb_nurses.json", "WB_WDI_SH_UHC_SRVS_CV_XD": "wb_uhc.json"},
        {"WB_WDI_SH_MED_BEDS_ZS": "wb_null.json", "WB_WDI_SH_MED_PHYS_ZS": "wb_physicians.json",
         "WB_WDI_SH_MED_NUMW_P3": "wb_nurses.json", "WB_WDI_SH_UHC_SRVS_CV_XD": "wb_uhc.json"},
        {"WB_WDI_SH_MED_BEDS_ZS": "wb_null.json", "WB_WDI_SH_MED_PHYS_ZS": "wb_null.json",
         "WB_WDI_SH_MED_NUMW_P3": "wb_null.json", "WB_WDI_SH_UHC_SRVS_CV_XD": "wb_null.json"},
    ):
        def wb_fetch(url, files=files):
            for code, file in files.items():
                if f"INDICATOR={code}&" in url:
                    return ADAPTER_FILES[file]
            raise AssertionError(url)
        with patch("epichat.adapters.wb_data360._fetch_text", side_effect=wb_fetch):
            fields = WorldBankData360Adapter().fetch(DataQuery(source="wb_data360", indicator_codes=HEALTH_CODES, location_code="KEN"))
        wb.append({"codes": HEALTH_CODES, "files": files, "iso3": "KEN", "fields": [field_json(f) for f in fields]})
    return {"un_wpp": un, "who_gho": who, "wb_data360": wb}


def main(web_dir: Path = ROOT / "web") -> None:
    rng = random.Random(SEED)
    fixtures = web_dir / "tests" / "fixtures"
    (fixtures / "adapters").mkdir(parents=True, exist_ok=True)
    for name, text in ADAPTER_FILES.items():
        (fixtures / "adapters" / name).write_text(text, encoding="utf-8", newline="")
    payload = {"version": 1, "params": params_cases(rng), "warnings": warning_cases(rng), "adapters": adapter_cases()}
    (fixtures / "parity.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
    print("wrote web/tests/fixtures/parity.json and web/tests/fixtures/adapters/")
```

- [ ] **Step 5: Add the npm script and run the exports**

In `web/package.json` scripts add `"sync-data": "py -3.10 ../scripts/export_web_data.py && py -3.10 ../scripts/export_parity_fixtures.py"` (CI runs the Python tests directly, so the launcher name only matters locally).

Run: `npm --prefix web run sync-data && py -3.10 scripts/export_un_locations.py`
Expected: the three "wrote …" lines; `web/data/un_locations.json` has 200+ entries (the UN key is in the root `.env`).

- [ ] **Step 6: Run the Python tests**

Run: `py -3.10 -m pytest tests/test_web_exports.py -v`
Expected: 4 passed, 1 skipped (the live UN refresh).

- [ ] **Step 7: Run the whole root suite and commit**

Run: `py -3.10 -m pytest tests -q`
Expected: all green.

```bash
git add scripts/export_web_data.py scripts/export_un_locations.py scripts/export_parity_fixtures.py tests/test_web_exports.py web/package.json web/data web/tests/fixtures
git commit -m "feat(data): Python exports of the disease database, system prompt, UN locations, and the parity fixture"
```

---

### Task 5: Disease database and literature warnings

**Files:**
- Create: `web/lib/disease/db.ts`, `web/lib/disease/checkParams.ts`
- Test: `web/tests/disease/db.test.ts`, `web/tests/disease/checkParams.test.ts`, `web/tests/sim/parity.test.ts`

**Interfaces:**
- Consumes: `web/data/disease_db.json` (Task 4), `g4`, `f1` (Task 2), `validateParams`, `approxR0`, `calibrateBeta`, `clampBeta`, `recalibrateBeta` (Task 3), `web/tests/fixtures/parity.json` (Task 4).
- Produces:
  ```ts
  export const PARAMETERS = ["r0", "incubation_days", "infectious_days", "fatality_rate", "average_contacts_daily", "immunity_duration", "asymptomatic_fraction"] as const;
  export type ParameterSummary = { status: "ok" | "under_review" | "estimates_only" | "no_source"; n_estimates: number; unit?: string; min?: number; max?: number; typical?: number; source?: string; estimate_range?: [number, number]; estimate_extremes?: { value: number; population?: string; source_type?: string; title?: string }[]; notes?: string; special_value?: string; review_note?: string };
  export type FlatParam = { min: number | null; max: number | null; typical: number | null; source: string; unit: string | null; note: string | null; range_text: string | null };
  export type DiseaseEntry = { key: string; display_name: string; aliases: string[]; summaries: Record<string, ParameterSummary | null>; flat: Record<string, FlatParam | null> };
  export function knownDiseases(): string[];                 // the 16 keys in file order
  export function lookup(name: string): DiseaseEntry | null;  // exact key or alias, case-insensitive, trimmed
  export function detectDisease(text: string): string | null; // longest term first, word boundaries
  export function checkParams(disease: string, r0: number, durInf: number, durExp: number | null, opts?: { pDeath?: number | null; nContacts?: number | null; durImmune?: number | null; pAsymp?: number | null }): string[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/disease/db.test.ts
import { describe, expect, it } from "vitest";

import { detectDisease, knownDiseases, lookup } from "@/lib/disease/db";

describe("disease database", () => {
  it("lists the sixteen diseases in file order", () => {
    const keys = knownDiseases();
    expect(keys).toHaveLength(16);
    expect(keys.slice(0, 3)).toEqual(["measles", "covid19", "mumps"]);
    expect(keys.at(-1)).toBe("mpox");
  });

  it("looks up by key or alias, case-insensitively", () => {
    expect(lookup("measles")?.key).toBe("measles");
    expect(lookup("  German Measles ")?.key).toBe("rubella");
    expect(lookup("unicorn fever")).toBeNull();
    const measles = lookup("measles")!;
    expect(measles.summaries.r0).toMatchObject({ status: "ok", min: 12, max: 18, typical: 15, n_estimates: 11 });
    expect(measles.summaries.r0?.source).toContain("http");
    expect(measles.flat.r0?.range_text).toBe("12–18");
    expect(measles.summaries.immunity_duration?.status).toBe("estimates_only");
    expect(lookup("dengue")!.summaries.fatality_rate).toBeNull();
  });

  it("detects hyphenated aliases and respects word boundaries", () => {
    const cases: [string, string | null][] = [
      ["german measles outbreak", "rubella"], ["the flu season", "influenza"], ["fluid dynamics", null],
      ["sars-cov-2 wave", "covid19"], ["COVID-19 in Brazil", "covid19"], ["whooping cough", "pertussis"],
      ["nothing here", null], ["tb in india", "tuberculosis"], ["Measles", "measles"],
    ];
    for (const [text, expected] of cases) expect(detectDisease(text), text).toBe(expected);
  });
});
```

```ts
// web/tests/disease/checkParams.test.ts
import { describe, expect, it } from "vitest";

import { checkParams } from "@/lib/disease/checkParams";

describe("checkParams", () => {
  it("reproduces the Python warnings", () => {
    expect(checkParams("measles", 100, 8, null)).toEqual([
      "R₀ ≈ 100.0 is outside the literature range for measles (12–18). Source: https://pubmed.ncbi.nlm.nih.gov/28757186/",
    ]);
    expect(checkParams("measles", 15, 30, 20, { pDeath: 0.05, nContacts: 40, durImmune: 10 })).toEqual([
      "Infectious period 30 days is outside the literature range for measles (8–8 days). Source: https://www.cdc.gov/measles/hcp/clinical-overview/index.html",
      "Daily contacts 40 is outside the literature range for measles (0–20). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC4438575/",
    ]);
    expect(checkParams("dengue", 0.5, 4, 6)).toEqual([
      "R₀ ≈ 0.5 is outside the literature range for dengue (1.0–103.0). Source: https://www.sciencedirect.com/science/article/pii/S0013935120300050",
    ]);
    expect(checkParams("covid19", 3, 7, 5, { pAsymp: 0.99 })).toEqual([
      "R₀ ≈ 3.0 is outside the literature range for covid19 (5.5–24). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8992231/#sec3",
      "Asymptomatic fraction 0.99 is outside the literature range for covid19 (20–44 percentage). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8403749/",
    ]);
    expect(checkParams("measles", 15, 8, 11, { pDeath: 0.001, nContacts: 6 })).toEqual([
      "Fatality rate 0.1% is outside the literature range for measles (0.5–6.0%). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC6418190/#ceab10",
    ]);
  });

  it("returns nothing for an unknown disease", () => {
    expect(checkParams("unicorn fever", 100, 8, null)).toEqual([]);
  });
});
```

```ts
// web/tests/sim/parity.test.ts
import { describe, expect, it } from "vitest";

import { checkParams } from "@/lib/disease/checkParams";
import { approxR0, calibrateBeta, clampBeta, recalibrateBeta, validateParams } from "@/lib/sim/params";
import parity from "../fixtures/parity.json";

function must(input: unknown) {
  const r = validateParams(input);
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

describe("parity with the Python package", () => {
  it("has enough cases", () => {
    expect(parity.params.length).toBeGreaterThanOrEqual(200);
    expect(parity.warnings.length).toBeGreaterThanOrEqual(300);
  });

  it("approx_r0, calibrate_beta, and recalibrate_beta agree within 1e-6", () => {
    for (const c of parity.params) {
      const p = must(c.input);
      expect(approxR0(p)).toBeCloseTo(c.approx_r0, 6);
      for (const k of c.calibrate) expect(clampBeta(calibrateBeta(p, k.target_r0))).toBeCloseTo(k.beta, 6);
      for (const r of c.recalibrate) {
        const after = must(r.after_input);
        expect(recalibrateBeta(after, r.r0_before, must(r.before)).beta).toBeCloseTo(r.beta, 6);
      }
    }
  });

  it("check_params warnings are identical strings", () => {
    for (const w of parity.warnings) {
      expect(checkParams(w.disease, w.r0, w.dur_inf, w.dur_exp, { pDeath: w.p_death, nContacts: w.n_contacts, durImmune: w.dur_immune, pAsymp: w.p_asymp }), JSON.stringify(w)).toEqual(w.warnings);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/disease tests/sim/parity.test.ts`
Expected: cannot resolve `@/lib/disease/db` and `@/lib/disease/checkParams`.

- [ ] **Step 3: Implement the database module**

```ts
// web/lib/disease/db.ts
/**
 * The curated disease database as Python exports it (scripts/export_web_data.py):
 * summaries and warning range text are computed there, so this module only
 * resolves names. Mirrors epichat/disease_db.py lookup and detect_disease.
 */
import raw from "@/data/disease_db.json";

export const PARAMETERS = [
  "r0", "incubation_days", "infectious_days", "fatality_rate",
  "average_contacts_daily", "immunity_duration", "asymptomatic_fraction",
] as const;
export type ParameterName = (typeof PARAMETERS)[number];

export type ParameterSummary = {
  status: "ok" | "under_review" | "estimates_only" | "no_source";
  n_estimates: number;
  unit?: string;
  min?: number;
  max?: number;
  typical?: number;
  source?: string;
  estimate_range?: [number, number];
  estimate_extremes?: { value: number; population?: string; source_type?: string; title?: string }[];
  notes?: string;
  special_value?: string;
  review_note?: string;
};

export type FlatParam = {
  min: number | null;
  max: number | null;
  typical: number | null;
  source: string;
  unit: string | null;
  note: string | null;
  range_text: string | null;
};

export type DiseaseEntry = {
  key: string;
  display_name: string;
  aliases: string[];
  summaries: Record<string, ParameterSummary | null>;
  flat: Record<string, FlatParam | null>;
};

type DbFile = { diseases: Record<string, Omit<DiseaseEntry, "key">> };
const DB = raw as unknown as DbFile;
const ENTRIES: DiseaseEntry[] = Object.entries(DB.diseases).map(([key, entry]) => ({ key, ...entry }));

/** Every disease key, in the database's file order. */
export function knownDiseases(): string[] {
  return ENTRIES.map((e) => e.key);
}

/** Exact match on a key or an alias, case-insensitive and trimmed. */
export function lookup(name: string): DiseaseEntry | null {
  const wanted = name.toLowerCase().trim();
  for (const entry of ENTRIES) {
    if (entry.key === wanted) return entry;
    if (entry.aliases.some((alias) => alias.toLowerCase() === wanted)) return entry;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest term first, so "german measles" wins over "measles"; the sort is stable, so file order breaks ties.
const TERMS: { pattern: RegExp; key: string }[] = ENTRIES.flatMap((entry) => [
  { term: entry.key, key: entry.key },
  ...entry.aliases.map((alias) => ({ term: alias.toLowerCase(), key: entry.key })),
])
  .sort((a, b) => b.term.length - a.term.length)
  .map(({ term, key }) => ({ pattern: new RegExp(`\\b${escapeRegExp(term)}\\b`), key }));

/** The first disease whose name or alias appears in the text as a whole word. */
export function detectDisease(text: string): string | null {
  const lower = text.toLowerCase();
  for (const { pattern, key } of TERMS) if (pattern.test(lower)) return key;
  return null;
}
```

- [ ] **Step 4: Implement the warnings**

```ts
// web/lib/disease/checkParams.ts
/**
 * epichat/disease_db.py check_params, with the range text pre-rendered by
 * Python (so "12–18" and "1.0–103.0" come out as the file says) and the
 * value formatting done by the Python-parity helpers.
 */
import { f1, g4 } from "@/lib/sim/pyformat";
import { lookup, type FlatParam } from "./db";

const DAYS_PER_UNIT: Record<string, number> = { days: 1, weeks: 7, months: 30.44, years: 365.25 };

type Range = { lo: number; hi: number; text: string; data: FlatParam };

function rangeOf(flat: Record<string, FlatParam | null>, param: string): Range | null {
  const data = flat[param];
  if (!data || data.min === null || data.max === null || data.range_text === null) return null;
  return { lo: data.min, hi: data.max, text: data.range_text, data };
}

export function checkParams(
  disease: string,
  r0: number,
  durInf: number,
  durExp: number | null,
  opts: { pDeath?: number | null; nContacts?: number | null; durImmune?: number | null; pAsymp?: number | null } = {},
): string[] {
  const entry = lookup(disease);
  if (!entry) return [];
  const out: string[] = [];
  const outside = (r: Range, v: number) => !(r.lo <= v && v <= r.hi);

  let r = rangeOf(entry.flat, "r0");
  if (r && outside(r, r0)) out.push(`R₀ ≈ ${f1(r0)} is outside the literature range for ${disease} (${r.text}). Source: ${r.data.source}`);

  r = rangeOf(entry.flat, "infectious_days");
  if (r && outside(r, durInf)) out.push(`Infectious period ${g4(durInf)} days is outside the literature range for ${disease} (${r.text} days). Source: ${r.data.source}`);

  if (durExp !== null && durExp !== undefined) {
    r = rangeOf(entry.flat, "incubation_days");
    if (r && outside(r, durExp)) out.push(`Incubation period ${g4(durExp)} days is outside the literature range for ${disease} (${r.text} days). Source: ${r.data.source}`);
  }

  const { pDeath, nContacts, durImmune, pAsymp } = opts;
  if (pDeath !== null && pDeath !== undefined) {
    r = rangeOf(entry.flat, "fatality_rate");
    if (r) {
      const percent = r.data.unit === "percentage";
      const value = percent ? pDeath * 100 : pDeath;
      if (outside(r, value)) {
        const u = percent ? "%" : "";
        out.push(`Fatality rate ${g4(value)}${u} is outside the literature range for ${disease} (${r.text}${u}). Source: ${r.data.source}`);
      }
    }
  }

  if (nContacts !== null && nContacts !== undefined) {
    r = rangeOf(entry.flat, "average_contacts_daily");
    if (r && outside(r, nContacts)) out.push(`Daily contacts ${g4(nContacts)} is outside the literature range for ${disease} (${r.text}). Source: ${r.data.source}`);
  }

  if (durImmune !== null && durImmune !== undefined) {
    r = rangeOf(entry.flat, "immunity_duration");
    if (r) {
      const factor = DAYS_PER_UNIT[r.data.unit ?? "days"] ?? 1;
      const lo = r.lo * factor;
      const hi = r.hi * factor;
      if (!(lo <= durImmune && durImmune <= hi)) {
        out.push(`Immunity duration ${g4(durImmune)} days is outside the literature range for ${disease} (${g4(lo)}–${g4(hi)} days). Source: ${r.data.source}`);
      }
    }
  }

  if (pAsymp !== null && pAsymp !== undefined) {
    r = rangeOf(entry.flat, "asymptomatic_fraction");
    if (r) {
      const value = r.data.unit === "percentage" ? pAsymp * 100 : pAsymp;
      if (outside(r, value)) out.push(`Asymptomatic fraction ${g4(pAsymp)} is outside the literature range for ${disease} (${r.text} ${r.data.unit ?? ""}). Source: ${r.data.source}`);
    }
  }
  return out;
}
```

Python's `check_params` calls `lookup(disease_name)` and prints the name as passed; the agent always passes the canonical key, and the tests do too.

- [ ] **Step 5: Run the tests**

Run: `npm --prefix web test -- tests/disease tests/sim/parity.test.ts`
Expected: all pass. A parity failure names the offending case in its message; fix the port, never the fixture.

- [ ] **Step 6: Run the whole web suite, typecheck, lint; commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/disease web/tests/disease web/tests/sim/parity.test.ts
git commit -m "feat(disease): database lookup and literature warnings pinned to the Python parity fixture"
```

---
### Task 6: Data adapters

**Files:**
- Create: `web/lib/data/types.ts`, `web/lib/data/unWpp.ts`, `web/lib/data/whoGho.ts`, `web/lib/data/wbData360.ts`
- Test: `web/tests/data/adapters.test.ts`

**Interfaces:**
- Consumes: `pyRound` (Task 2), `web/data/un_locations.json` and the adapter fixtures plus `parity.json` (Task 4).
- Produces:
  ```ts
  // types.ts
  export type ResolvedField = { field: string; value: unknown; citation: string; description: string; alternatives: ResolvedField[] };
  export type DataQuery = { source: "un_wpp" | "who_gho" | "wb_data360"; indicators?: number[]; locationId?: number; startYear?: number; endYear?: number; indicatorCodes?: string[]; locationCode?: string; databaseId?: string };
  export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
  export const ADAPTER_TIMEOUT_MS = 15_000;
  export function resolved(field: string, value: unknown, citation: string, description?: string, alternatives?: ResolvedField[]): ResolvedField;
  export type AdapterOptions = { fetchImpl?: FetchLike; now?: () => Date };
  // unWpp.ts
  export const UN_BASE_URL: string;
  export function unLocationId(iso3: string): number | null;
  export function parseUnCsv(text: string): Record<string, string>[];
  export function mapUnRows(rows: Record<string, string>[], locationId: number): ResolvedField[];
  export function fetchUnWpp(query: DataQuery, opts: AdapterOptions & { apiKey?: string }): Promise<ResolvedField[]>;
  // whoGho.ts
  export const WHO_INDICATOR_MAP: Record<string, string>;
  export function mapWhoRows(code: string, rows: unknown[], iso3: string): ResolvedField | null;
  export function fetchWhoGho(query: DataQuery, opts?: AdapterOptions): Promise<ResolvedField[]>;
  // wbData360.ts
  export const WB_INDICATOR_MAP: Record<string, [string, string]>;
  export function assembleWbFields(raw: Map<string, { value: number; year: string }>, iso3: string): ResolvedField[];
  export function fetchWbData360(query: DataQuery, opts?: AdapterOptions): Promise<ResolvedField[]>;
  // types.ts also exports Adapters = { unWpp, whoGho, wbData360 }: (query: DataQuery) => Promise<ResolvedField[]>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/data/adapters.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ADAPTER_TIMEOUT_MS, type FetchLike } from "@/lib/data/types";
import { fetchUnWpp, mapUnRows, parseUnCsv, unLocationId } from "@/lib/data/unWpp";
import { assembleWbFields, fetchWbData360 } from "@/lib/data/wbData360";
import { fetchWhoGho, mapWhoRows } from "@/lib/data/whoGho";
import parity from "../fixtures/parity.json";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/adapters/${name}`, import.meta.url), "utf8");

type Call = { url: string; init?: RequestInit };
function fakeFetch(answer: (url: string) => { status: number; body: string } | Error): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const a = answer(url);
    if (a instanceof Error) throw a;
    return new Response(a.body, { status: a.status });
  };
  return { fetchImpl, calls };
}

describe("UN WPP adapter", () => {
  it("knows the location table", () => {
    expect(unLocationId("KEN")).toBe(404);
    expect(unLocationId("ken")).toBe(404);
    expect(unLocationId("XXX")).toBeNull();
  });

  it("parses CRLF and the sep line", () => {
    const rows = parseUnCsv(fixture("un_wpp_combined.csv"));
    expect(rows).toHaveLength(6);
    expect(rows[0].IndicatorId).toBe("55");
    expect(rows[0].Value).toBe("10.648");
    expect(parseUnCsv("sep =|\r\nA|B\r\n1\r\n")).toEqual([{ A: "1", B: "" }]);
  });

  it("maps rows exactly as the Python adapter", () => {
    for (const c of parity.adapters.un_wpp) {
      expect(mapUnRows(parseUnCsv(fixture(c.file)), c.location_id), c.file).toEqual(c.fields);
    }
  });

  it("fetches with the bearer, the current year, and a timeout; returns nothing on failure", async () => {
    const good = fakeFetch(() => ({ status: 200, body: fixture("un_wpp_birth_death.csv") }));
    const fields = await fetchUnWpp({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId: 840 }, { apiKey: "tok", fetchImpl: good.fetchImpl, now: () => new Date("2026-10-08T00:00:00Z") });
    expect(fields.map((f) => f.field)).toEqual(["birth_rate", "death_rate"]);
    expect(good.calls[0].url).toBe("https://population.un.org/dataportalapi/api/v1/data/indicators/55,59,71,49/locations/840/start/2020/end/2026/?format=csv");
    expect((good.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(good.calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    const noKey = fakeFetch(() => ({ status: 200, body: fixture("un_wpp_birth_death.csv") }));
    await fetchUnWpp({ source: "un_wpp", indicators: [55], locationId: 840 }, { fetchImpl: noKey.fetchImpl });
    expect((noKey.calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    const bad = fakeFetch(() => ({ status: 500, body: "boom" }));
    expect(await fetchUnWpp({ source: "un_wpp", indicators: [55], locationId: 840 }, { fetchImpl: bad.fetchImpl })).toEqual([]);
    const down = fakeFetch(() => new Error("ECONNRESET"));
    expect(await fetchUnWpp({ source: "un_wpp", indicators: [55], locationId: 840 }, { fetchImpl: down.fetchImpl })).toEqual([]);
    expect(ADAPTER_TIMEOUT_MS).toBe(15_000);
  });
});

describe("WHO GHO adapter", () => {
  it("maps the latest non-null row", () => {
    const rows = JSON.parse(fixture("who_gho_coverage.json")).value;
    expect(mapWhoRows("WHS8_110", rows, "KEN")).toEqual({ field: "mcv1_coverage", value: 76, citation: "WHO GHO, KEN, 2022", description: "", alternatives: [] });
    expect(mapWhoRows("WHS8_110", [], "KEN")).toBeNull();
    expect(mapWhoRows("NOPE", rows, "KEN")).toBeNull();
  });

  it("fetches each code and matches the Python fields", async () => {
    for (const c of parity.adapters.who_gho) {
      const { fetchImpl, calls } = fakeFetch((url) => {
        for (const [code, file] of Object.entries(c.files)) if (url.includes(`/${code}?`)) return { status: 200, body: fixture(file) };
        return new Error(`unexpected ${url}`);
      });
      const fields = await fetchWhoGho({ source: "who_gho", indicatorCodes: c.codes, locationCode: c.iso3 }, { fetchImpl });
      expect(fields, JSON.stringify(c.codes)).toEqual(c.fields);
      expect(calls[0].url).toBe(`https://ghoapi.azureedge.net/api/${c.codes[0]}?$filter=SpatialDim%20eq%20'KEN'`);
    }
  });

  it("skips a code whose request fails and keeps the rest", async () => {
    const { fetchImpl } = fakeFetch((url) => (url.includes("/MCV2?") ? new Error("down") : { status: 200, body: fixture("who_gho_coverage.json") }));
    const fields = await fetchWhoGho({ source: "who_gho", indicatorCodes: ["WHS8_110", "MCV2"], locationCode: "KEN" }, { fetchImpl });
    expect(fields.map((f) => f.field)).toEqual(["mcv1_coverage"]);
  });
});

describe("World Bank Data360 adapter", () => {
  it("groups capacity candidates like the Python adapter", async () => {
    for (const c of parity.adapters.wb_data360) {
      const { fetchImpl, calls } = fakeFetch((url) => {
        for (const [code, file] of Object.entries(c.files)) if (url.includes(`INDICATOR=${code}&`)) return { status: 200, body: fixture(file) };
        return new Error(`unexpected ${url}`);
      });
      const fields = await fetchWbData360({ source: "wb_data360", indicatorCodes: c.codes, locationCode: c.iso3 }, { fetchImpl });
      expect(fields, JSON.stringify(c.files)).toEqual(c.fields);
      expect(calls[0].url).toBe("https://data360api.worldbank.org/data360/data?DATABASE_ID=WB_WDI&INDICATOR=WB_WDI_SH_MED_BEDS_ZS&REF_AREA=KEN&timePeriodFrom=2020&timePeriodTo=2025");
      expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toBe("EpiChat/1.0");
    }
  });

  it("assembles raw values in request order and picks the latest period", () => {
    const raw = new Map([["WB_WDI_SH_UHC_SRVS_CV_XD", { value: 56, year: "2022" }], ["WB_WDI_SH_MED_PHYS_ZS", { value: 0.2, year: "2021" }]]);
    expect(assembleWbFields(raw, "KEN").map((f) => [f.field, f.description])).toEqual([["uhc_coverage", "UHC service coverage index 0–100"], ["treatment_capacity", "physicians/1,000"]]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/data/adapters.test.ts`
Expected: cannot resolve `@/lib/data/types`.

- [ ] **Step 3: Implement the shared types**

```ts
// web/lib/data/types.ts
/** epichat/resolver.py's ResolvedField and DataQuery, as the adapters exchange them. */
export type ResolvedField = {
  field: string;
  value: unknown;
  citation: string;
  description: string;
  alternatives: ResolvedField[];
};

export type DataQuery = {
  source: "un_wpp" | "who_gho" | "wb_data360";
  indicators?: number[];
  locationId?: number;
  startYear?: number;
  endYear?: number;
  indicatorCodes?: string[];
  locationCode?: string;
  databaseId?: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type AdapterOptions = { fetchImpl?: FetchLike; now?: () => Date };

/** Every outside call gives up after this long; a hung API must not eat the chat route's budget. */
export const ADAPTER_TIMEOUT_MS = 15_000;

export function resolved(field: string, value: unknown, citation: string, description = "", alternatives: ResolvedField[] = []): ResolvedField {
  return { field, value, citation, description, alternatives };
}

/** The three adapters as the tools consume them, bound to one fetch and key. */
export type Adapters = {
  unWpp: (query: DataQuery) => Promise<ResolvedField[]>;
  whoGho: (query: DataQuery) => Promise<ResolvedField[]>;
  wbData360: (query: DataQuery) => Promise<ResolvedField[]>;
};

/** Python's max(): the first of the largest elements. */
export function firstMax<T>(items: T[], key: (item: T) => number | string): T {
  let best = items[0];
  for (const item of items.slice(1)) if (key(item) > key(best)) best = item;
  return best;
}
```

- [ ] **Step 4: Implement the UN adapter**

```ts
// web/lib/data/unWpp.ts
/**
 * epichat/adapters/un_wpp.py. The location table is static (exported by
 * scripts/export_un_locations.py) instead of downloaded at start-up.
 */
import locations from "@/data/un_locations.json";
import { pyRound } from "@/lib/sim/pyformat";
import { ADAPTER_TIMEOUT_MS, firstMax, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const UN_BASE_URL = "https://population.un.org/dataportalapi/api/v1";
const VARIANT_MEDIAN = "4";
const SEX_BOTH = "3";
const METHOD_INTERP = "2";
const TABLE = locations as Record<string, number>;

export function unLocationId(iso3: string): number | null {
  return TABLE[iso3.trim().toUpperCase()] ?? null;
}

/** csv.DictReader with delimiter "|": a "sep" first line is skipped; short rows get "" for missing columns. */
export function parseUnCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines[0]?.startsWith("sep")) lines.shift();
  if (lines.length === 0) return [];
  const header = lines[0].split("|");
  return lines.slice(1).map((line) => {
    const cells = line.split("|");
    const row: Record<string, string> = {};
    header.forEach((name, i) => { row[name] = cells[i] ?? ""; });
    return row;
  });
}

function cite(row: Record<string, string>, locationId: number): string {
  return `UN WPP 2024, ${row.Location || String(locationId)} (${row.Iso3 || String(locationId)}), ${row.TimeLabel ?? ""}`;
}

export function mapUnRows(rows: Record<string, string>[], locationId: number): ResolvedField[] {
  const filtered = rows.filter((r) => r.VariantId === VARIANT_MEDIAN && r.SexId === SEX_BOTH);
  const interp = filtered.filter((r) => r.EstimateMethodId === METHOD_INTERP);
  const results: ResolvedField[] = [];
  const timeId = (r: Record<string, string>) => Number.parseInt(r.TimeId || "0", 10);

  for (const [ind, field] of [["55", "birth_rate"], ["59", "death_rate"]] as const) {
    const candidates = interp.filter((r) => r.IndicatorId === ind && (r.AgeLabel ?? "").trim() === "Total");
    if (candidates.length === 0) continue;
    const best = firstMax(candidates, timeId);
    results.push(resolved(field, pyRound(Number.parseFloat(best.Value), 3), cite(best, locationId)));
  }

  const pop = filtered.filter((r) => r.IndicatorId === "49" && (r.AgeLabel ?? "").trim() === "Total");
  if (pop.length > 0) {
    const best = firstMax(pop, timeId);
    const raw = Number.parseFloat(best.Value);
    const population = best.EstimateMethodId === METHOD_INTERP ? pyRound(raw * 1000, 0) : pyRound(raw, 0);
    results.push(resolved("total_population", population, cite(best, locationId)));
  }

  const ageRows = interp.filter((r) => r.IndicatorId === "71");
  const pct: Record<string, number> = {};
  let ageBest: Record<string, string> | null = null;
  for (const label of ["0-17", "65+"]) {
    const candidates = ageRows.filter((r) => (r.AgeLabel ?? "").trim() === label);
    if (candidates.length === 0) continue;
    ageBest = firstMax(candidates, timeId);
    pct[label] = pyRound(Number.parseFloat(ageBest.Value), 3);
  }
  if ("0-17" in pct && "65+" in pct && ageBest) {
    pct["18-64"] = pyRound(100 - pct["0-17"] - pct["65+"], 3);
    results.push(resolved("age_distribution_pct", pct, cite(ageBest, locationId)));
  }
  return results;
}

export async function fetchUnWpp(query: DataQuery, opts: AdapterOptions & { apiKey?: string } = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const year = (opts.now ?? (() => new Date()))().getUTCFullYear();
  const ids = (query.indicators ?? []).join(",");
  const url = `${UN_BASE_URL}/data/indicators/${ids}/locations/${query.locationId}/start/${query.startYear ?? 2020}/end/${year}/?format=csv`;
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
    if (!response.ok) return [];
    return mapUnRows(parseUnCsv(await response.text()), query.locationId ?? 0);
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Implement the WHO adapter**

```ts
// web/lib/data/whoGho.ts
/** epichat/adapters/who_gho.py */
import { ADAPTER_TIMEOUT_MS, firstMax, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const WHO_BASE_URL = "https://ghoapi.azureedge.net/api/";

export const WHO_INDICATOR_MAP: Record<string, string> = {
  WHS3_40: "bcg_coverage", WHS3_41: "dtp3_coverage", WHS3_43: "polio_coverage", WHS3_45: "hepb3_coverage",
  WHS3_46: "hib3_coverage", WHS8_110: "mcv1_coverage", MCV2: "mcv2_coverage", PCV3: "pcv3_coverage",
  ROTAC: "rotac_coverage", SDGHPV: "hpv_coverage", MENGA: "menga_coverage", WHS3_48: "yfv_coverage", PAB: "pab_coverage",
  WHS3_62: "measles_cases", WHS3_56: "pertussis_cases", WHS3_59: "poliomyelitis_cases", WHS3_55: "diphtheria_cases",
  WHS3_51: "rubella_cases", WHS3_54: "mumps_cases", WHS3_57: "tetanus_cases", WHS3_58: "neonatal_tetanus_cases",
  WHS3_60: "yellow_fever_cases", WHS3_61: "japanese_encephalitis_cases", WHS3_63: "congenital_rubella_cases",
  WHS9_86: "total_population",
};

type Row = { NumericValue?: number | null; TimeDimensionValue?: string | number | null };

export function mapWhoRows(code: string, rows: unknown[], iso3: string): ResolvedField | null {
  const field = WHO_INDICATOR_MAP[code];
  if (!field) return null;
  const usable = (rows as Row[]).filter((r) => r.NumericValue !== null && r.NumericValue !== undefined);
  if (usable.length === 0) return null;
  const best = firstMax(usable, (r) => Number.parseInt(String(r.TimeDimensionValue ?? "0"), 10) || 0);
  const year = best.TimeDimensionValue ?? "unknown";
  return resolved(field, best.NumericValue, `WHO GHO, ${iso3}, ${year}`);
}

export async function fetchWhoGho(query: DataQuery, opts: AdapterOptions = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const iso3 = query.locationCode ?? "";
  const results: ResolvedField[] = [];
  for (const code of query.indicatorCodes ?? []) {
    if (!WHO_INDICATOR_MAP[code]) continue;
    const url = `${WHO_BASE_URL}${code}?$filter=${encodeURIComponent(`SpatialDim eq '${iso3}'`)}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
      if (!response.ok) continue;
      const data = (await response.json()) as { value?: unknown[] };
      const field = mapWhoRows(code, data.value ?? [], iso3);
      if (field) results.push(field);
    } catch {
      continue;
    }
  }
  return results;
}
```

- [ ] **Step 6: Implement the World Bank adapter**

```ts
// web/lib/data/wbData360.ts
/** epichat/adapters/wb_data360.py */
import { ADAPTER_TIMEOUT_MS, firstMax, resolved, type AdapterOptions, type DataQuery, type ResolvedField } from "./types";

export const WB_BASE_URL = "https://data360api.worldbank.org";

export const WB_INDICATOR_MAP: Record<string, [string, string]> = {
  WB_WDI_SH_MED_BEDS_ZS: ["treatment_capacity", "hospital beds/1,000"],
  WB_WDI_SH_MED_PHYS_ZS: ["treatment_capacity", "physicians/1,000"],
  WB_WDI_SH_MED_NUMW_P3: ["treatment_capacity", "nurses/1,000"],
  WB_WDI_SH_UHC_SRVS_CV_XD: ["uhc_coverage", "UHC service coverage index 0–100"],
  WB_WDI_SH_TBS_INCD: ["tb_incidence", "per 100,000/yr"],
  WB_WDI_SH_DYN_AIDS_ZS: ["hiv_prevalence", "% of population ages 15–49"],
  WB_WDI_SH_HIV_INCD_TL_P3: ["hiv_prevalence", "per 1,000 uninfected/yr"],
  WB_WDI_SH_MLR_INCD_P3: ["malaria_incidence", "per 1,000 population at risk/yr"],
  WB_WDI_SH_STA_DIAB_ZS: ["diabetes_prevalence", "% of adults ages 20–79"],
  WB_WDI_SH_HEP_HBVS_ZS: ["hepb_prevalence", "% of population"],
  WB_WDI_SP_DYN_CBRT_IN: ["birth_rate", "crude birth rate/1,000/yr"],
  WB_WDI_SP_DYN_CDRT_IN: ["death_rate", "crude death rate/1,000/yr"],
  WB_WDI_SP_POP_TOTL: ["total_population", "total population"],
  WB_WDI_SP_POP_0014_TO_ZS: ["age_distribution_pct", "population ages 0–14 (%)"],
  WB_WDI_SP_POP_65UP_TO_ZS: ["age_distribution_pct", "population ages 65+ (%)"],
};

const CANDIDATE_GROUPS: Record<string, { primary: string; alternatives: string[] }> = {
  treatment_capacity: { primary: "WB_WDI_SH_MED_BEDS_ZS", alternatives: ["WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3"] },
  hiv_prevalence: { primary: "WB_WDI_SH_DYN_AIDS_ZS", alternatives: ["WB_WDI_SH_HIV_INCD_TL_P3"] },
};

type Raw = { value: number; year: string };

export function assembleWbFields(raw: Map<string, Raw>, iso3: string): ResolvedField[] {
  if (raw.size === 0) return [];
  const results: ResolvedField[] = [];
  const consumed = new Set<string>();
  for (const [field, group] of Object.entries(CANDIDATE_GROUPS)) {
    const primary = raw.get(group.primary);
    if (!primary) continue;
    consumed.add(group.primary);
    const alternatives: ResolvedField[] = [];
    for (const code of group.alternatives) {
      const alt = raw.get(code);
      if (!alt) continue;
      alternatives.push(resolved(field, alt.value, `WB WDI, ${iso3}, ${alt.year}`, WB_INDICATOR_MAP[code][1]));
      consumed.add(code);
    }
    results.push(resolved(field, primary.value, `WB WDI, ${iso3}, ${primary.year}`, WB_INDICATOR_MAP[group.primary][1], alternatives));
  }
  for (const [code, { value, year }] of raw) {
    if (consumed.has(code)) continue;
    const [field, description] = WB_INDICATOR_MAP[code];
    results.push(resolved(field, value, `WB WDI, ${iso3}, ${year}`, description));
  }
  return results;
}

type Obs = { OBS_VALUE?: string | number | null; TIME_PERIOD?: string | null };

export async function fetchWbData360(query: DataQuery, opts: AdapterOptions = {}): Promise<ResolvedField[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const iso3 = query.locationCode ?? "";
  const codes = (query.indicatorCodes ?? []).filter((c) => Object.hasOwn(WB_INDICATOR_MAP, c));
  const fetched = await Promise.all(codes.map(async (code): Promise<[string, Raw | null]> => {
    const url = `${WB_BASE_URL}/data360/data?DATABASE_ID=${query.databaseId ?? "WB_WDI"}&INDICATOR=${code}&REF_AREA=${iso3}&timePeriodFrom=${query.startYear ?? 2020}&timePeriodTo=${query.endYear ?? 2025}`;
    try {
      const response = await fetchImpl(url, { headers: { "User-Agent": "EpiChat/1.0" }, signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS) });
      if (!response.ok) return [code, null];
      const data = (await response.json()) as { value?: Obs[] };
      const rows = (data.value ?? []).filter((r) => r.OBS_VALUE !== null && r.OBS_VALUE !== undefined && r.OBS_VALUE !== "null");
      if (rows.length === 0) return [code, null];
      const best = firstMax(rows, (r) => r.TIME_PERIOD ?? "");
      return [code, { value: Number.parseFloat(String(best.OBS_VALUE)), year: best.TIME_PERIOD ?? "unknown" }];
    } catch {
      return [code, null];
    }
  }));
  const raw = new Map<string, Raw>();
  for (const [code, value] of fetched) if (value) raw.set(code, value);
  return assembleWbFields(raw, iso3);
}
```

- [ ] **Step 7: Run the tests**

Run: `npm --prefix web test -- tests/data/adapters.test.ts`
Expected: all pass. If the WB grouping case with a missing primary fails on order, remember Python emits ungrouped fields in request order and `raw` keeps insertion order: build the map from the `codes` order, as above.

- [ ] **Step 8: Run the whole web suite, typecheck, lint; commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/data web/tests/data
git commit -m "feat(data): UN WPP, WHO GHO, and World Bank adapters with Python-parity row mapping"
```

---

### Task 7: Simulation client

**Files:**
- Create: `web/lib/sim/client.ts`
- Test: `web/tests/sim/client.test.ts`

**Interfaces:**
- Consumes: `SimParams` (Task 3), `FetchLike` (Task 6).
- Produces:
  ```ts
  export type SimStats = { peak_infections: number; peak_day: number; total_infected: number; total_deaths: number; n_agents: number; sim_days: number };
  export type RepairRecord = { attempt: number; error: string; changes?: { field: string; from: unknown; to: unknown }[]; usage?: { model: string; input_tokens: number; output_tokens: number }; repair_error?: string };
  export type SimSuccess = { ok: true; effective_params: SimParams; population: number; stats: SimStats; stats_agents: SimStats; series: Record<string, number[]>; pop_scale: number; repairs: RepairRecord[]; attempts: number; duration_ms: number; cold_start: boolean; starsim_version: string };
  export type SimFailure = { ok: false; status: number; kind: "invalid_params" | "too_large" | "execution_failed" | "timeout" | "unauthorized" | "misconfigured" | "not_configured" | "unavailable"; detail: string; repairs: RepairRecord[]; attempts: number | null; seconds?: number };
  export type SimResult = SimSuccess | SimFailure;
  export type Demographics = { birth_rate: number; death_rate: number; source: string };
  export type SimClient = { simulate(params: SimParams, popScale: number, contextText: string): Promise<SimResult>; demographicsFallback(iso3: string): Promise<Demographics | null> };
  export function createSimClient(opts: { baseUrl: string; secret: string; fetchImpl?: FetchLike; timeoutMs?: number }): SimClient;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/sim/client.test.ts
import { describe, expect, it } from "vitest";

import type { FetchLike } from "@/lib/data/types";
import { createSimClient } from "@/lib/sim/client";
import { validateParams } from "@/lib/sim/params";

const PARAMS = (() => { const r = validateParams({ beta: 22.8125, n_agents: 1000, sim_dur_years: 0.1, rand_seed: 1 }); if (!r.ok) throw new Error(r.error); return r.params; })();

function answering(status: number, body: unknown, capture: { url?: string; init?: RequestInit } = {}): FetchLike {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" } });
  };
}

const SUCCESS = {
  ok: true, effective_params: { ...PARAMS }, population: 1000, stats: { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 37 },
  stats_agents: { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 37 },
  series: { day: [0, 1], n_infected: [10, 9] }, pop_scale: 1, repairs: [], attempts: 1, duration_ms: 4000, cold_start: true, starsim_version: "3.3.2",
};

describe("sim client", () => {
  it("posts the request with the secret and returns the body on success", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const client = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(200, SUCCESS, capture) });
    const result = await client.simulate(PARAMS, 2419.6, "measles in Kenya");
    expect(result).toEqual(SUCCESS);
    expect(capture.url).toBe("http://sim.internal/simulate");
    expect((capture.init?.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(JSON.parse(capture.init?.body as string)).toEqual({ params: PARAMS, pop_scale: 2419.6, context_text: "measles in Kenya" });
    expect(capture.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps each error body to a failure the tool can read", async () => {
    const client = (status: number, body: unknown) => createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(status, body) });
    expect(await client(422, { ok: false, error: { kind: "too_large", detail: "n_agents × sim_dur_years = 2,000,000 exceeds the cap", agent_years: 2e6, cap: 5e5 } }).simulate(PARAMS, 1, ""))
      .toEqual({ ok: false, status: 422, kind: "too_large", detail: "n_agents × sim_dur_years = 2,000,000 exceeds the cap", repairs: [], attempts: null });
    expect(await client(422, { ok: false, error: { kind: "invalid_params", detail: [{ loc: ["params", "n_agents"], msg: "too small", type: "x" }] } }).simulate(PARAMS, 1, ""))
      .toMatchObject({ ok: false, kind: "invalid_params", detail: "params.n_agents: too small" });
    const repairs = [{ attempt: 1, error: "e1", changes: [], usage: { model: "m", input_tokens: 1, output_tokens: 1 } }];
    expect(await client(500, { ok: false, error: { kind: "execution_failed", detail: "boom", repairs, attempts: 2 } }).simulate(PARAMS, 1, ""))
      .toEqual({ ok: false, status: 500, kind: "execution_failed", detail: "boom", repairs, attempts: 2 });
    expect(await client(504, { ok: false, error: { kind: "timeout", seconds: 120, repairs: [], attempts: 1 } }).simulate(PARAMS, 1, ""))
      .toEqual({ ok: false, status: 504, kind: "timeout", detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 1, seconds: 120 });
    expect(await client(502, "<html>bad gateway</html>").simulate(PARAMS, 1, "")).toMatchObject({ ok: false, status: 502, kind: "unavailable" });
    const down = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    expect(await down.simulate(PARAMS, 1, "")).toMatchObject({ ok: false, status: 0, kind: "unavailable", detail: "ECONNREFUSED" });
    const unset = createSimClient({ baseUrl: "", secret: "", fetchImpl: answering(200, SUCCESS) });
    expect(await unset.simulate(PARAMS, 1, "")).toMatchObject({ ok: false, kind: "not_configured" });
  });

  it("reads the demographics fallback and tolerates its failures", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const ok = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(200, { ok: true, iso3: "KEN", birth_rate: 27.342, death_rate: 7.212, source: "UN WPP 2024 — KEN (2022)" }, capture) });
    expect(await ok.demographicsFallback("ken")).toEqual({ birth_rate: 27.342, death_rate: 7.212, source: "UN WPP 2024 — KEN (2022)" });
    expect(capture.url).toBe("http://sim.internal/demographics/KEN");
    const missing = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: answering(404, { ok: false, error: { kind: "not_found" } }) });
    expect(await missing.demographicsFallback("XXX")).toBeNull();
    const down = createSimClient({ baseUrl: "http://sim.internal", secret: "s3", fetchImpl: async () => { throw new Error("down"); } });
    expect(await down.demographicsFallback("KEN")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/sim/client.test.ts`
Expected: cannot resolve `@/lib/sim/client`.

- [ ] **Step 3: Implement**

```ts
// web/lib/sim/client.ts
/**
 * The web app's client for the private simulation service (sub-project 2,
 * docs/superpowers/specs/2026-10-08-sim-service-design.md section 3). Every
 * failure comes back as data: the tool decides what the model is told.
 */
import type { FetchLike } from "@/lib/data/types";
import type { SimParams } from "./params";

export type SimStats = { peak_infections: number; peak_day: number; total_infected: number; total_deaths: number; n_agents: number; sim_days: number };
export type RepairRecord = {
  attempt: number;
  error: string;
  changes?: { field: string; from: unknown; to: unknown }[];
  usage?: { model: string; input_tokens: number; output_tokens: number };
  repair_error?: string;
};
export type SimSuccess = {
  ok: true;
  effective_params: SimParams;
  population: number;
  stats: SimStats;
  stats_agents: SimStats;
  series: Record<string, number[]>;
  pop_scale: number;
  repairs: RepairRecord[];
  attempts: number;
  duration_ms: number;
  cold_start: boolean;
  starsim_version: string;
};
export type SimFailureKind = "invalid_params" | "too_large" | "execution_failed" | "timeout" | "unauthorized" | "misconfigured" | "not_configured" | "unavailable";
export type SimFailure = { ok: false; status: number; kind: SimFailureKind; detail: string; repairs: RepairRecord[]; attempts: number | null; seconds?: number };
export type SimResult = SimSuccess | SimFailure;
export type Demographics = { birth_rate: number; death_rate: number; source: string };

export type SimClient = {
  simulate(params: SimParams, popScale: number, contextText: string): Promise<SimResult>;
  demographicsFallback(iso3: string): Promise<Demographics | null>;
};

/** Just under the chat route's own 300 s limit. */
const DEFAULT_TIMEOUT_MS = 290_000;
const KINDS: readonly string[] = ["invalid_params", "too_large", "execution_failed", "timeout", "unauthorized", "misconfigured"];

function failure(status: number, kind: SimFailureKind, detail: string, extra: Partial<SimFailure> = {}): SimFailure {
  return { ok: false, status, kind, detail, repairs: [], attempts: null, ...extra };
}

type ErrorBody = { ok: false; error: { kind: string; detail?: unknown; repairs?: RepairRecord[]; attempts?: number; seconds?: number } };

function describeDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (e && typeof e === "object" && "msg" in e ? `${((e as { loc?: unknown[] }).loc ?? []).join(".")}: ${(e as { msg: string }).msg}` : JSON.stringify(e)))
      .join("; ");
  }
  return JSON.stringify(detail);
}

export function createSimClient(opts: { baseUrl: string; secret: string; fetchImpl?: FetchLike; timeoutMs?: number }): SimClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = opts.baseUrl.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${opts.secret}` };

  return {
    async simulate(params, popScale, contextText) {
      if (!base) return failure(0, "not_configured", "The simulation service address is not configured.");
      let response: Response;
      try {
        response = await fetchImpl(`${base}/simulate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ params, pop_scale: popScale, context_text: contextText }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return failure(0, "unavailable", error instanceof Error ? error.message : String(error));
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return failure(response.status, "unavailable", `The simulation service answered ${response.status} without a readable body.`);
      }
      if (response.ok && body && typeof body === "object" && (body as { ok?: boolean }).ok === true) return body as SimSuccess;
      const err = (body as ErrorBody)?.error;
      if (!err || !KINDS.includes(err.kind)) return failure(response.status, "unavailable", `The simulation service answered ${response.status}.`);
      const kind = err.kind as SimFailureKind;
      const common = { repairs: err.repairs ?? [], attempts: err.attempts ?? null };
      if (kind === "timeout") {
        return failure(response.status, kind, `The simulation timed out after ${err.seconds ?? "?"} seconds.`, { ...common, seconds: err.seconds });
      }
      return failure(response.status, kind, describeDetail(err.detail ?? ""), common);
    },

    async demographicsFallback(iso3) {
      if (!base) return null;
      try {
        const response = await fetchImpl(`${base}/demographics/${iso3.trim().toUpperCase()}`, { headers, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return null;
        const body = (await response.json()) as { ok?: boolean; birth_rate?: number; death_rate?: number; source?: string };
        if (!body.ok || typeof body.birth_rate !== "number" || typeof body.death_rate !== "number") return null;
        return { birth_rate: body.birth_rate, death_rate: body.death_rate, source: body.source ?? "" };
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix web test -- tests/sim/client.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Run the whole web suite, typecheck, lint; commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/sim/client.ts web/tests/sim/client.test.ts
git commit -m "feat(sim): typed client for the simulation service"
```

---
### Task 8: Tool types, registry, `configure_simulation`, `lookup_disease`

**Files:**
- Create: `web/lib/tools/types.ts`, `web/lib/tools/shared.ts`, `web/lib/tools/index.ts`, `web/lib/tools/configureSimulation.ts`, `web/lib/tools/lookupDisease.ts`
- Test: `web/tests/tools/helpers.ts`, `web/tests/tools/registry.test.ts`, `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/lookupDisease.test.ts`

**Interfaces:**
- Consumes: `SimParams`, `validateParams`, `approxR0`, `calibrateBeta`, `clampBeta`, `DEFAULT_BETA`, `getVaccine` (Task 3); `pyRound` (Task 2); `lookup`, `detectDisease`, `knownDiseases`, `PARAMETERS`, `ParameterSummary` (Task 5); `checkParams` (Task 5); `ResolvedField`, `DataQuery`, `Adapters` (Task 6); `SimClient`, `SimResult` (Task 7); `STAGES`, `Stage` from `lib/enums.ts`.
- Produces (used by Tasks 9, 10 and Plan B):
  ```ts
  // types.ts
  export type WebSource = { title: string; url: string };
  export type Scenario = { id: string | null; seq: number; params: SimParams | null; disease: string | null; countryIso3: string | null; totalPopulation: number | null; dataSources: ResolvedField[]; webSources: WebSource[]; stage: Stage; stageReached: Stage; hasRun: boolean };
  export function emptyScenario(seq?: number): Scenario;
  export function resetScenario(scenario: Scenario): void;          // in place, seq + 1
  export type DiseasePayload = { kind: "disease"; canonical_name: string; display_name: string; parameters: Record<string, ParameterSummary> };
  export type ConfigPayload = { kind: "config"; applied: Record<string, unknown>; approx_r0: number; config: { disease: string | null; disease_type: string; country: string | null; n_agents: number; sim_dur_years: number; dur_inf: number; dur_exp: number | null; interventions: string[] }; warnings: string[]; new_scenario: boolean };
  export type DataPayload = { kind: "data"; source: "un_wpp" | "wb_data360" | "who_gho" | "sim_fallback"; iso3: string; applied: Record<string, unknown>; citations: string[]; warnings?: string[]; approx_r0?: number };
  export type RunPayload = { kind: "run"; run_id: string | null; stats: SimStats; stats_agents: SimStats; attack_rate_pct: number; pop_scale: number; population: number; effective_params: SimParams; warnings: string[]; repairs: RepairRecord[]; data_sources: ResolvedField[]; duration_ms: number; cold_start: boolean; series?: Record<string, number[]> };
  export type ToolErrorPayload = { kind: "tool_error"; message: string };
  export type CardPayload = (DiseasePayload | ConfigPayload | DataPayload | RunPayload | ToolErrorPayload) & { duration_ms?: number };
  export type ToolOutcome = { content: string; isError?: boolean; payload?: CardPayload };
  export type RunRecord = { params: SimParams; popScale: number; result: SimResult; warnings: string[]; dataSources: ResolvedField[] };
  export type ToolDeps = { scenario: Scenario; sim: SimClient; adapters: Adapters; contextText: string; turnId: string; onRun: (run: RunRecord) => Promise<string | null>; onScenarioStart: () => void };
  // shared.ts
  export const NEEDS_CONFIG = "Call configure_simulation first to establish the simulation before fetching data.";
  export function given<T>(v: T | null | undefined): v is T;
  export function upsertIntervention(list: Record<string, unknown>[], kind: string, fields: Record<string, unknown>): Record<string, unknown>[];
  export function paramWarnings(scenario: Scenario, params: SimParams, contextText: string): string[];
  export function errorOutcome(message: string): ToolOutcome;        // { content: message, isError: true, payload: { kind: "tool_error", message } }
  export function recordSources(scenario: Scenario, fields: ResolvedField[]): string[];   // appends, returns citations
  // index.ts
  export const TOOLS: Anthropic.Beta.BetaTool[];                     // six, fixed order
  export function executeTool(name: string, input: unknown, deps: ToolDeps, now?: () => number): Promise<ToolOutcome>;
  ```

- [ ] **Step 1: Write the test helpers and the failing tests**

```ts
// web/tests/tools/helpers.ts
import type { Adapters, ResolvedField } from "@/lib/data/types";
import type { SimClient, SimResult } from "@/lib/sim/client";
import { validateParams, type SimParams } from "@/lib/sim/params";
import { emptyScenario, type RunRecord, type Scenario, type ToolDeps } from "@/lib/tools/types";

export function params(input: Record<string, unknown>): SimParams {
  const r = validateParams({ beta: 22.8125, ...input });
  if (!r.ok) throw new Error(r.error);
  return r.params;
}

export function rf(field: string, value: unknown, citation = "test source"): ResolvedField {
  return { field, value, citation, description: "", alternatives: [] };
}

export type FakeDeps = ToolDeps & { runs: RunRecord[]; starts: number; queries: unknown[] };

export function makeDeps(over: Partial<{
  scenario: Scenario; unWpp: ResolvedField[] | Error; whoGho: ResolvedField[] | Error; wbData360: ResolvedField[] | Error;
  simulate: SimResult | Error; fallback: { birth_rate: number; death_rate: number; source: string } | null; contextText: string; runId: string | null;
}> = {}): FakeDeps {
  const answer = (v: ResolvedField[] | Error | undefined) => async (q: unknown) => { deps.queries.push(q); if (v instanceof Error) throw v; return v ?? []; };
  const sim: SimClient = {
    async simulate() { if (over.simulate instanceof Error) throw over.simulate; if (!over.simulate) throw new Error("no simulate result configured"); return over.simulate; },
    async demographicsFallback() { return over.fallback ?? null; },
  };
  const deps: FakeDeps = {
    scenario: over.scenario ?? emptyScenario(),
    sim,
    adapters: { unWpp: answer(over.unWpp), whoGho: answer(over.whoGho), wbData360: answer(over.wbData360) } as Adapters,
    contextText: over.contextText ?? "",
    turnId: "turn-1",
    runs: [],
    starts: 0,
    queries: [],
    async onRun(run) { deps.runs.push(run); return over.runId === undefined ? "run-1" : over.runId; },
    onScenarioStart() { deps.starts++; },
  };
  return deps;
}
```

```ts
// web/tests/tools/registry.test.ts
import { describe, expect, it } from "vitest";

import { TOOLS, executeTool } from "@/lib/tools";
import { makeDeps } from "./helpers";

describe("tool registry", () => {
  it("declares the six tools in the agent's order with streaming on and no extra properties", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["configure_simulation", "lookup_disease", "fetch_demographics", "fetch_health_system", "fetch_vaccination_coverage", "run_simulation"]);
    for (const tool of TOOLS) {
      expect(tool.eager_input_streaming).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(80);
    }
    const configure = TOOLS[0].input_schema as { properties: Record<string, { description: string }>; required?: string[] };
    expect(Object.keys(configure.properties)).toHaveLength(17);
    expect(configure.properties.vaccine_start_day.description).toBe("Day the vaccination campaign begins. 0 (the\ndefault) means pre-existing immunity at the start rather than\na campaign. Requires vaccine_coverage.");
    expect(configure.required ?? []).toEqual([]);
    expect((TOOLS[1].input_schema as { required: string[] }).required).toEqual(["disease_name"]);
    expect((TOOLS[4].input_schema as { required: string[] }).required).toEqual(["country_iso3", "disease"]);
  });

  it("refuses unknown tools and invalid input, and reports a thrown error as data", async () => {
    const deps = makeDeps();
    expect(await executeTool("nope", {}, deps)).toMatchObject({ isError: true, content: 'Unknown tool "nope".' });
    const invalid = await executeTool("lookup_disease", { disease_name: 5 }, deps);
    expect(invalid.isError).toBe(true);
    expect(JSON.parse(invalid.content).INVALID_INPUT[0]).toMatch(/^disease_name: /);
    const extra = await executeTool("lookup_disease", { disease_name: "measles", extra: 1 }, deps);
    expect(extra.isError).toBe(true);
    const broken = makeDeps({ unWpp: new Error("kaboom"), scenario: { ...deps.scenario, params: null } });
    const thrown = await executeTool("fetch_demographics", { country_iso3: "KEN" }, broken);
    expect(thrown.content).toMatch(/^Call configure_simulation first/);
  });

  it("treats null fields as not passed", async () => {
    const deps = makeDeps();
    const out = await executeTool("configure_simulation", { disease: "measles", n_agents: null, r0: null, vaccine_coverage: null }, deps);
    expect(out.isError).toBeUndefined();
    expect(JSON.parse(out.content).applied).toEqual({ disease: "measles" });
    expect(deps.scenario.params?.n_agents).toBe(10000);
  });

  it("stamps the payload with the tool's duration", async () => {
    const deps = makeDeps();
    let t = 1000;
    const out = await executeTool("lookup_disease", { disease_name: "measles" }, deps, () => (t += 25));
    expect(out.payload?.duration_ms).toBe(25);
  });
});
```

```ts
// web/tests/tools/configureSimulation.test.ts
import { describe, expect, it } from "vitest";

import { getVaccine } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { makeDeps, params } from "./helpers";

const run = (deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) => configureSimulation(input as never, deps);

describe("configure_simulation", () => {
  it("creates params from scratch", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "dengue", country_iso3: "BRA", disease_type: "sir", n_agents: 50000 })).content);
    expect(deps.scenario.params?.n_agents).toBe(50000);
    expect(deps.scenario.params?.country).toBe("BRA");
    expect(deps.scenario.params?.beta).toBe(22.8125);
    expect(out.applied.n_agents).toBe(50000);
    expect(out.applied.disease).toBe("dengue");
    expect(deps.scenario.disease).toBe("dengue");
    expect(deps.scenario.countryIso3).toBe("BRA");
  });

  it("merges without losing prior fields", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "dengue", country_iso3: "BRA", n_agents: 50000 });
    await run(deps, { n_agents: 100000 });
    expect(deps.scenario.params?.n_agents).toBe(100000);
    expect(deps.scenario.params?.country).toBe("BRA");
  });

  it("returns a CONFIG ERROR and preserves state on an invalid value", async () => {
    const deps = makeDeps();
    await run(deps, { n_agents: 50000 });
    const before = deps.scenario.params;
    const out = await run(deps, { n_agents: -5 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^CONFIG ERROR: 1 validation error for SimParams\nn_agents\n/);
    expect(out.payload).toMatchObject({ kind: "tool_error" });
    expect(deps.scenario.params).toBe(before);
  });

  it("calibrates beta to r0", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", disease_type: "sir", r0: 15, dur_inf: 8 })).content);
    expect(out.approx_r0).toBe(15);
    expect(deps.scenario.params?.beta).toBe(171.09375);
    expect(out.applied.r0).toBe(15);
  });

  it("produces literature warnings for out-of-range values", async () => {
    const deps = makeDeps();
    const out = JSON.parse((await run(deps, { disease: "measles", r0: 100, dur_inf: 8 })).content);
    expect(out.warnings.some((w: string) => w.includes("literature"))).toBe(true);
  });

  it("falls back to the conversation text for the disease the warnings use", async () => {
    const deps = makeDeps({ contextText: "please model whooping cough in Kenya" });
    const out = JSON.parse((await run(deps, { r0: 100, dur_inf: 8 })).content);
    expect(out.warnings[0]).toContain("for pertussis");
  });

  it("handles vaccine coverage and start day like the agent", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", vaccine_coverage: 0.8 });
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.8, start_day: 0 });
    await run(deps, { vaccine_start_day: 60 });
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.8, start_day: 60 });
    const fresh = makeDeps();
    await run(fresh, { disease: "measles", n_agents: 5000 });
    const rejected = await run(fresh, { vaccine_start_day: 30 });
    expect(rejected.content).toBe("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    expect(rejected.isError).toBe(true);
    expect(getVaccine(fresh.scenario.params!)).toBeNull();
  });

  it("upserts treatment and seasonality and lists intervention types in order", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", vaccine_coverage: 0.5, treatment_capacity: 20, seasonality_scale: 0.3 });
    await run(deps, { treatment_capacity: 40 });
    const out = JSON.parse((await run(deps, { vaccine_coverage: 0.6 })).content);
    expect(out.config.interventions).toEqual(["seasonality", "treatment", "vaccine"]);
    expect(deps.scenario.params!.interventions.find((i) => i.type === "treatment")).toMatchObject({ coverage: 1, capacity: 40 });
    expect(deps.scenario.params!.interventions.find((i) => i.type === "seasonality")).toMatchObject({ scale: 0.3, shift: 0 });
  });

  it("starts a new scenario when asked", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", n_agents: 5000, country_iso3: "KEN" });
    deps.scenario.dataSources.push({ field: "birth_rate", value: 1, citation: "x", description: "", alternatives: [] });
    const out = await run(deps, { disease: "dengue", start_new_scenario: true });
    expect(deps.starts).toBe(1);
    expect(deps.scenario.seq).toBe(2);
    expect(deps.scenario.params?.n_agents).toBe(10000);
    expect(deps.scenario.params?.country).toBeNull();
    expect(deps.scenario.dataSources).toEqual([]);
    expect(out.payload).toMatchObject({ kind: "config", new_scenario: true });
  });
});
```

```ts
// web/tests/tools/lookupDisease.test.ts
import { describe, expect, it } from "vitest";

import { lookupDisease } from "@/lib/tools/lookupDisease";
import { makeDeps } from "./helpers";

describe("lookup_disease", () => {
  it("returns the measles entry with every parameter's status", async () => {
    const out = await lookupDisease({ disease_name: "measles" }, makeDeps());
    const body = JSON.parse(out.content);
    expect(body.canonical_name).toBe("measles");
    expect(body.display_name).toBe("Measles");
    expect(body.parameters.r0).toMatchObject({ status: "ok", min: 12, max: 18, typical: 15 });
    expect(body.parameters.r0.source).toContain("http");
    expect(Object.keys(body.parameters)).toEqual(["r0", "incubation_days", "infectious_days", "fatality_rate", "average_contacts_daily", "immunity_duration", "asymptomatic_fraction"]);
    expect(out.payload).toMatchObject({ kind: "disease", canonical_name: "measles" });
  });

  it("resolves an alias and omits parameters a disease lacks", async () => {
    expect(JSON.parse((await lookupDisease({ disease_name: "german measles" }, makeDeps())).content).canonical_name).toBe("rubella");
    const dengue = JSON.parse((await lookupDisease({ disease_name: "Dengue fever" }, makeDeps())).content);
    expect(Object.keys(dengue.parameters)).toEqual(["r0", "incubation_days", "infectious_days"]);
  });

  it("lists the known diseases for an unknown name", async () => {
    const out = await lookupDisease({ disease_name: "unicorn fever" }, makeDeps());
    expect(out.content).toBe("UNKNOWN DISEASE: 'unicorn fever'. Known diseases: measles, covid19, mumps, rubella, varicella, pertussis, influenza, meningococcal, hepatitis_a, ebola, dengue, rsv, cholera, polio, tuberculosis, mpox");
    expect(out.isError).toBeUndefined();
    expect(out.payload).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/tools`
Expected: cannot resolve `@/lib/tools/types` (and the others).

- [ ] **Step 3: Implement the types and shared helpers**

```ts
// web/lib/tools/types.ts
import type { Adapters, ResolvedField } from "@/lib/data/types";
import type { ParameterSummary } from "@/lib/disease/db";
import type { Stage } from "@/lib/enums";
import type { RepairRecord, SimClient, SimResult, SimStats } from "@/lib/sim/client";
import type { SimParams } from "@/lib/sim/params";

export type WebSource = { title: string; url: string };

/** The deterministic simulation state (parent spec 9.4); replaces the Python AgentState. */
export type Scenario = {
  id: string | null;
  seq: number;
  params: SimParams | null;
  disease: string | null;
  countryIso3: string | null;
  totalPopulation: number | null;
  dataSources: ResolvedField[];
  webSources: WebSource[];
  stage: Stage;
  stageReached: Stage;
  hasRun: boolean;
};

export function emptyScenario(seq = 1): Scenario {
  return { id: null, seq, params: null, disease: null, countryIso3: null, totalPopulation: null, dataSources: [], webSources: [], stage: "understand", stageReached: "understand", hasRun: false };
}

/** start_new_scenario: the same object becomes the next, empty scenario. */
export function resetScenario(scenario: Scenario): void {
  Object.assign(scenario, emptyScenario(scenario.seq + 1));
}

export type DiseasePayload = { kind: "disease"; canonical_name: string; display_name: string; parameters: Record<string, ParameterSummary> };
export type ConfigPayload = {
  kind: "config";
  applied: Record<string, unknown>;
  approx_r0: number;
  config: { disease: string | null; disease_type: string; country: string | null; n_agents: number; sim_dur_years: number; dur_inf: number; dur_exp: number | null; interventions: string[] };
  warnings: string[];
  new_scenario: boolean;
};
export type DataPayload = { kind: "data"; source: "un_wpp" | "wb_data360" | "who_gho" | "sim_fallback"; iso3: string; applied: Record<string, unknown>; citations: string[]; warnings?: string[]; approx_r0?: number };
export type RunPayload = {
  kind: "run";
  run_id: string | null;
  stats: SimStats;
  stats_agents: SimStats;
  attack_rate_pct: number;
  pop_scale: number;
  population: number;
  effective_params: SimParams;
  warnings: string[];
  repairs: RepairRecord[];
  data_sources: ResolvedField[];
  duration_ms: number;
  cold_start: boolean;
  /** Only on the live stream event; stored without it (the runs row keeps it). */
  series?: Record<string, number[]>;
};
export type ToolErrorPayload = { kind: "tool_error"; message: string };
export type CardPayload = (DiseasePayload | ConfigPayload | DataPayload | RunPayload | ToolErrorPayload) & { duration_ms?: number };

/** What a tool sends back: `content` for the model, `payload` for the card and the event store. */
export type ToolOutcome = { content: string; isError?: boolean; payload?: CardPayload };

export type RunRecord = { params: SimParams; popScale: number; result: SimResult; warnings: string[]; dataSources: ResolvedField[] };

/** Everything a tool may touch. Built fresh for each chat request. */
export type ToolDeps = {
  /** Mutable; tools update it in place and the handler saves it at the end. */
  scenario: Scenario;
  sim: SimClient;
  adapters: Adapters;
  /** The conversation's user texts joined with spaces plus the current text (the Python agent's context_text). */
  contextText: string;
  turnId: string;
  /** Insert the runs row; returns its id or null when the insert failed. */
  onRun: (run: RunRecord) => Promise<string | null>;
  /** The scenario was just reset; the handler records new_scenario. */
  onScenarioStart: () => void;
};
```

```ts
// web/lib/tools/shared.ts
import type { ResolvedField } from "@/lib/data/types";
import { checkParams } from "@/lib/disease/checkParams";
import { detectDisease } from "@/lib/disease/db";
import { approxR0, type SimParams } from "@/lib/sim/params";
import type { Scenario, ToolOutcome } from "./types";

export const NEEDS_CONFIG = "Call configure_simulation first to establish the simulation before fetching data.";

export function given<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/** epichat/agent.py _upsert_intervention: drop every intervention of the kind, append the new one. */
export function upsertIntervention(list: Record<string, unknown>[], kind: string, fields: Record<string, unknown>): Record<string, unknown>[] {
  return [...list.filter((i) => i.type !== kind), { type: kind, ...fields }];
}

/** epichat/agent.py _param_warnings */
export function paramWarnings(scenario: Scenario, params: SimParams, contextText: string): string[] {
  const disease = scenario.disease ?? detectDisease(contextText || "");
  if (!disease) return [];
  return checkParams(disease, approxR0(params), params.dur_inf, params.dur_exp, {
    pDeath: params.p_death || null,
    nContacts: params.n_contacts,
    durImmune: params.dur_immune,
    pAsymp: params.disease_type === "seiar" ? params.p_asymp : null,
  });
}

export function errorOutcome(message: string): ToolOutcome {
  return { content: message, isError: true, payload: { kind: "tool_error", message } };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The agent's _record: remember the fields as data sources and return their citations. */
export function recordSources(scenario: Scenario, fields: ResolvedField[]): string[] {
  scenario.dataSources.push(...fields);
  return fields.map((f) => f.citation);
}
```

- [ ] **Step 4: Implement the two tools**

```ts
// web/lib/tools/configureSimulation.ts
import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { DEFAULT_BETA, approxR0, calibrateBeta, clampBeta, validateParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { errorOutcome, given, paramWarnings, upsertIntervention } from "./shared";
import { resetScenario, type ToolDeps, type ToolOutcome } from "./types";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const ConfigureSimulationInput = z.strictObject({
  disease: opt(z.string()),
  country_iso3: opt(z.string()),
  disease_type: opt(z.string()),
  n_agents: opt(z.number()),
  sim_dur_years: opt(z.number()),
  r0: opt(z.number()),
  dur_inf: opt(z.number()),
  dur_exp: opt(z.number()),
  dur_immune: opt(z.number()),
  p_death: opt(z.number()),
  p_asymp: opt(z.number()),
  init_prev: opt(z.number()),
  vaccine_coverage: opt(z.number()),
  vaccine_start_day: opt(z.number()),
  treatment_capacity: opt(z.number()),
  seasonality_scale: opt(z.number()),
  start_new_scenario: opt(z.boolean()),
});
export type ConfigureSimulationArgs = z.infer<typeof ConfigureSimulationInput>;

const DIRECT = ["disease_type", "n_agents", "sim_dur_years", "dur_inf", "dur_exp", "dur_immune", "p_death", "p_asymp", "init_prev"] as const;

/** Ported from epichat/agent.py configure_simulation, plus start_new_scenario. */
export async function configureSimulation(input: ConfigureSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const newScenario = input.start_new_scenario === true;
  if (newScenario) {
    resetScenario(deps.scenario);
    deps.onScenarioStart();
  }
  const scenario = deps.scenario;
  const base: Record<string, unknown> = scenario.params ? { ...scenario.params } : { beta: DEFAULT_BETA };
  const applied: Record<string, unknown> = {};
  for (const key of DIRECT) {
    const value = input[key];
    if (given(value)) {
      base[key] = value;
      applied[key] = value;
    }
  }
  if (given(input.country_iso3)) {
    base.country = input.country_iso3;
    applied.country = input.country_iso3;
  }

  let interventions = [...((base.interventions as Record<string, unknown>[] | undefined) ?? [])];
  if (given(input.vaccine_coverage) || given(input.vaccine_start_day)) {
    const current = interventions.find((i) => i.type === "vaccine") ?? {};
    const coverage = given(input.vaccine_coverage) ? input.vaccine_coverage : (current.coverage as number | null | undefined);
    const startDay = given(input.vaccine_start_day) ? input.vaccine_start_day : ((current.start_day as number | undefined) ?? 0);
    if (!given(coverage)) {
      return errorOutcome("CONFIG ERROR: a vaccination campaign needs a coverage level — pass vaccine_coverage alongside vaccine_start_day.");
    }
    interventions = upsertIntervention(interventions, "vaccine", { coverage, start_day: startDay });
    applied.vaccine_coverage = coverage;
    applied.vaccine_start_day = startDay;
  }
  if (given(input.treatment_capacity)) {
    interventions = upsertIntervention(interventions, "treatment", { coverage: 1.0, capacity: input.treatment_capacity });
    applied.treatment_capacity = input.treatment_capacity;
  }
  if (given(input.seasonality_scale)) {
    interventions = upsertIntervention(interventions, "seasonality", { scale: input.seasonality_scale });
    applied.seasonality_scale = input.seasonality_scale;
  }
  base.interventions = interventions;

  const validated = validateParams(base);
  if (!validated.ok) return errorOutcome(`CONFIG ERROR: ${validated.error}`);
  let params = validated.params;
  if (given(input.r0)) {
    const beta = clampBeta(calibrateBeta(params, input.r0));
    const revalidated = validateParams({ ...params, beta });
    if (!revalidated.ok) return errorOutcome(`CONFIG ERROR: ${revalidated.error}`);
    params = revalidated.params;
    applied.r0 = input.r0;
  }

  if (given(input.disease)) {
    scenario.disease = detectDisease(input.disease) ?? input.disease.toLowerCase();
    applied.disease = scenario.disease;
  }
  scenario.params = params;
  scenario.countryIso3 = params.country;
  const warnings = paramWarnings(scenario, params, deps.contextText);
  const config = {
    disease: scenario.disease,
    disease_type: params.disease_type,
    country: params.country,
    n_agents: params.n_agents,
    sim_dur_years: params.sim_dur_years,
    dur_inf: params.dur_inf,
    dur_exp: params.dur_exp,
    interventions: params.interventions.map((i) => i.type),
  };
  const approx_r0 = pyRound(approxR0(params), 2);
  return {
    content: JSON.stringify({ applied, approx_r0, config, warnings }),
    payload: { kind: "config", applied, approx_r0, config, warnings, new_scenario: newScenario },
  };
}
```

```ts
// web/lib/tools/lookupDisease.ts
import { z } from "zod";
import { PARAMETERS, detectDisease, knownDiseases, lookup, type ParameterSummary } from "@/lib/disease/db";
import type { ToolDeps, ToolOutcome } from "./types";

export const LookupDiseaseInput = z.strictObject({ disease_name: z.string() });
export type LookupDiseaseArgs = z.infer<typeof LookupDiseaseInput>;

/** Ported from epichat/agent.py lookup_disease; the summaries come pre-computed from Python. */
export async function lookupDisease(input: LookupDiseaseArgs, _deps: ToolDeps): Promise<ToolOutcome> {
  const canonical = detectDisease(input.disease_name);
  const entry = canonical ? lookup(canonical) : lookup(input.disease_name);
  if (!entry) {
    return { content: `UNKNOWN DISEASE: '${input.disease_name}'. Known diseases: ${knownDiseases().join(", ")}` };
  }
  const parameters: Record<string, ParameterSummary> = {};
  for (const p of PARAMETERS) {
    const summary = entry.summaries[p];
    if (summary) parameters[p] = summary;
  }
  const body = { canonical_name: canonical ?? input.disease_name.toLowerCase(), display_name: entry.display_name, parameters };
  return { content: JSON.stringify(body), payload: { kind: "disease", ...body } };
}
```

- [ ] **Step 5: Implement the registry**

The three fetch tools and the run tool are imported here but created in Tasks 9 and 10; until then create each of those four files with only its `*Input` schema and a `run` that returns `errorOutcome("not implemented")`, so this task's tests pass and the later tasks replace the bodies. (A reviewer approving Task 8 approves the registry shape; the stubs are deleted by Tasks 9 and 10 in the same branch.)

```ts
// web/lib/tools/index.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { ConfigureSimulationInput, configureSimulation } from "./configureSimulation";
import { FetchDemographicsInput, fetchDemographics } from "./fetchDemographics";
import { FetchHealthSystemInput, fetchHealthSystem } from "./fetchHealthSystem";
import { FetchVaccinationCoverageInput, fetchVaccinationCoverage } from "./fetchVaccinationCoverage";
import { LookupDiseaseInput, lookupDisease } from "./lookupDisease";
import { RunSimulationInput, runSimulation } from "./runSimulation";
import type { ToolDeps, ToolOutcome } from "./types";

const num = (description: string) => ({ type: ["number", "null"], description });
const int = (description: string) => ({ type: ["integer", "null"], description });
const str = (description: string) => ({ type: ["string", "null"], description });

/**
 * Tool definitions sent to the model, in the Python agent's order. Part of the
 * cached prompt prefix: keep the order fixed and never put per-request values
 * in it. Descriptions are the Python docstrings verbatim.
 */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "configure_simulation",
    description:
      "Create or update the validated simulation configuration.\n\nCall this whenever the user specifies or changes any setting, passing\nonly the fields that changed — earlier settings are preserved. Pass\nr0 to have beta calibrated deterministically to that R0. The result\nreports the validated configuration and any literature-range\nwarnings; a CONFIG ERROR result explains what to fix.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        disease: str('Disease name as the user said it (e.g. "dengue").'),
        country_iso3: str('ISO3 country code (e.g. "BRA").'),
        disease_type: str("Model type: sir, seir, sis, sirs, seirs, or seiar."),
        n_agents: int("Number of simulated agents."),
        sim_dur_years: num("Simulation duration in years."),
        r0: num("Target basic reproduction number; beta is calibrated to it."),
        dur_inf: num("Infectious period in days."),
        dur_exp: num("Incubation period in days (SEIR-family models)."),
        dur_immune: num("Immunity duration in days (SIRS-family models)."),
        p_death: num("Infection fatality rate as a fraction of 1."),
        p_asymp: num("Asymptomatic fraction (SEIAR), fraction of 1."),
        init_prev: num("Initial prevalence as a fraction of 1."),
        vaccine_coverage: num("Vaccine coverage fraction; adds/updates the\nvaccine intervention."),
        vaccine_start_day: int("Day the vaccination campaign begins. 0 (the\ndefault) means pre-existing immunity at the start rather than\na campaign. Requires vaccine_coverage."),
        treatment_capacity: int("Daily treatment capacity; adds/updates the\ntreatment intervention."),
        seasonality_scale: num("Seasonal forcing amplitude 0-1; adds/updates\nthe seasonality intervention."),
        start_new_scenario: { type: ["boolean", "null"], description: "True to begin a new scenario from scratch (a different disease or country) instead of editing the current one. Earlier scenarios are kept for comparison." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_disease",
    description:
      'Look up a disease in the curated, citation-backed parameter database.\n\nCall this before configuring a known disease. Each parameter comes\nback with a status: "ok" (a usable consensus value, with\nestimate_range showing how far published estimates spread and\nestimate_extremes naming where each bound came from), "under_review"\n(held back — cite review_note, never invent a number),\n"estimates_only" (citations exist but the database has adopted no\nconsensus value — report the estimates and say there is no agreed\nvalue), or "no_source" (nothing at all in the database). Pass only\n"ok" values to configure_simulation. Covers 16 diseases.',
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { disease_name: { type: "string", description: 'Disease name or alias (e.g. "whooping cough").' } },
      required: ["disease_name"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_demographics",
    description:
      "Fetch real demographics for a country and apply them deterministically.\n\nUses the UN World Population Prospects (live API, offline CSV\nfallback). Automatically applies age structure (switching to an\nage-structured contact network), birth/death rates, and records the\ntotal population for result scaling — you never copy these numbers\nyourself. Switching the network changes the R0 a given beta implies, so\nbeta is back-solved to hold the configured R0; the result reports\napprox_r0 and any literature warnings it now triggers. Call after\nconfigure_simulation, before running.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { country_iso3: { type: "string", description: 'ISO3 country code (e.g. "BRA", "KEN").' } },
      required: ["country_iso3"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_health_system",
    description:
      "Fetch health-system indicators (World Bank WDI) for a country.\n\nReturns hospital beds, physicians, nurses per 1,000, and UHC\ncoverage. If the simulation has a treatment intervention, its daily\ncapacity is set deterministically from hospital beds scaled to the\nsimulated population. Call after configure_simulation.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { country_iso3: { type: "string", description: 'ISO3 country code (e.g. "BRA").' } },
      required: ["country_iso3"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_vaccination_coverage",
    description:
      "Fetch reported vaccination coverage (WHO GHO) for a disease/country.\n\nIf no vaccine intervention is configured yet, one is added\ndeterministically at the reported coverage. Only some diseases have\nroutine-immunization indicators; the result says when none exists.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        country_iso3: { type: "string", description: 'ISO3 country code (e.g. "BRA").' },
        disease: { type: "string", description: 'Disease name (e.g. "measles").' },
      },
      required: ["country_iso3", "disease"],
      additionalProperties: false,
    },
  },
  {
    name: "run_simulation",
    description:
      "Run the configured Starsim simulation and return the results.\n\nOnly call this after the configuration is complete and the user has\nconfirmed they want to run. Results are scaled to the real\npopulation when demographics were fetched. The result plot is shown\nto the user automatically.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

type Entry = { schema: z.ZodType; run: (input: never, deps: ToolDeps) => Promise<ToolOutcome> };

const REGISTRY: Record<string, Entry> = {
  configure_simulation: { schema: ConfigureSimulationInput, run: configureSimulation },
  lookup_disease: { schema: LookupDiseaseInput, run: lookupDisease },
  fetch_demographics: { schema: FetchDemographicsInput, run: fetchDemographics },
  fetch_health_system: { schema: FetchHealthSystemInput, run: fetchHealthSystem },
  fetch_vaccination_coverage: { schema: FetchVaccinationCoverageInput, run: fetchVaccinationCoverage },
  run_simulation: { schema: RunSimulationInput, run: runSimulation },
};

const FAILED = "This tool failed. Tell the user this part is temporarily unavailable.";

/** Validate a tool call from the model and run it, timing it. Never throws. */
export async function executeTool(name: string, input: unknown, deps: ToolDeps, now: () => number = Date.now): Promise<ToolOutcome> {
  const entry = Object.hasOwn(REGISTRY, name) ? REGISTRY[name] : undefined;
  if (!entry) return { content: `Unknown tool "${name}".`, isError: true, payload: { kind: "tool_error", message: `Unknown tool "${name}".` } };
  const parsed = entry.schema.safeParse(input ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
    return { content: JSON.stringify({ INVALID_INPUT: problems }), isError: true, payload: { kind: "tool_error", message: problems.join("; ") } };
  }
  const started = now();
  let outcome: ToolOutcome;
  try {
    outcome = await entry.run(parsed.data as never, deps);
  } catch {
    outcome = { content: FAILED, isError: true, payload: { kind: "tool_error", message: FAILED } };
  }
  const duration_ms = Math.max(0, now() - started);
  return outcome.payload ? { ...outcome, payload: { ...outcome.payload, duration_ms } } : outcome;
}
```

The stubs for Task 9 and 10 files, each:

```ts
// web/lib/tools/fetchDemographics.ts (stub, replaced in Task 9)
import { z } from "zod";
import { errorOutcome } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";
export const FetchDemographicsInput = z.strictObject({ country_iso3: z.string() });
export async function fetchDemographics(_input: z.infer<typeof FetchDemographicsInput>, _deps: ToolDeps): Promise<ToolOutcome> { return errorOutcome("FETCH ERROR: not implemented"); }
```

and the same shape for `fetchHealthSystem.ts` (`FetchHealthSystemInput = z.strictObject({ country_iso3: z.string() })`), `fetchVaccinationCoverage.ts` (`z.strictObject({ country_iso3: z.string(), disease: z.string() })`), and `runSimulation.ts` (`RunSimulationInput = z.strictObject({})`, returning `errorOutcome("SIMULATION ERROR: not implemented")`). The registry test's "thrown error" case uses `fetch_demographics` with no params, which the stub does not hit; adjust that assertion to the stub's output only if it fails, and restore it in Task 9.

- [ ] **Step 6: Run the tests**

Run: `npm --prefix web test -- tests/tools`
Expected: all pass except possibly the registry's thrown-error case against the stub, which must pass once Task 9 lands; if it fails now, mark it `it.todo` and un-todo it in Task 9.

- [ ] **Step 7: Run the whole web suite, typecheck, lint; commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/tools web/tests/tools
git commit -m "feat(tools): registry, scenario types, configure_simulation, lookup_disease"
```

---

### Task 9: The three fetch tools

**Files:**
- Modify: `web/lib/tools/fetchDemographics.ts`, `web/lib/tools/fetchHealthSystem.ts`, `web/lib/tools/fetchVaccinationCoverage.ts` (replace the stubs)
- Test: `web/tests/tools/fetchTools.test.ts`

**Interfaces:**
- Consumes: Task 8's types and helpers; `unLocationId` (Task 6); `recalibrateBeta`, `approxR0`, `validateParams`, `getTreatment`, `getVaccine` (Task 3); `pyRound` (Task 2); `detectDisease` (Task 5).
- Produces: `fetchDemographics(input, deps)`, `fetchHealthSystem(input, deps)`, `fetchVaccinationCoverage(input, deps)` with the Python behavior; `GHO_CODES`, `HEALTH_CODES` exported.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/tools/fetchTools.test.ts
import { describe, expect, it } from "vitest";

import { getTreatment, getVaccine } from "@/lib/sim/params";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { fetchDemographics } from "@/lib/tools/fetchDemographics";
import { fetchHealthSystem } from "@/lib/tools/fetchHealthSystem";
import { fetchVaccinationCoverage } from "@/lib/tools/fetchVaccinationCoverage";
import { makeDeps, rf } from "./helpers";

async function configured(deps: ReturnType<typeof makeDeps>, input: Record<string, unknown>) {
  await configureSimulation(input as never, deps);
  return deps;
}

describe("fetch_demographics", () => {
  const kenya = [
    rf("age_distribution_pct", { "0-17": 38.6, "18-64": 57.6, "65+": 3.8 }, "UN WPP 2024, Kenya (KEN), 2024"),
    rf("total_population", 213_000_000, "UN WPP 2024"),
    rf("birth_rate", 12.3, "UN WPP 2024"),
    rf("death_rate", 7.1, "UN WPP 2024"),
  ];

  it("applies age structure, population, and vital rates", async () => {
    const deps = await configured(makeDeps({ unWpp: kenya }), { disease: "dengue", n_agents: 50000 });
    const out = JSON.parse((await fetchDemographics({ country_iso3: "ken" }, deps)).content);
    const p = deps.scenario.params!;
    expect(p.age_pct_under18).toBe(38.6);
    expect(p.network_type).toBe("age_structured");
    expect(deps.scenario.totalPopulation).toBe(213_000_000);
    expect(p.birth_rate).toBe(12.3);
    expect(p.use_demographics).toBe(true);
    expect(p.country).toBe("KEN");
    expect(deps.scenario.dataSources).toHaveLength(4);
    expect(out.citations[0]).toContain("UN WPP");
    expect(out.applied.total_population).toBe(213_000_000);
    expect(deps.queries[0]).toEqual({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId: 404 });
  });

  it("falls back to the sim service when the UN call returns nothing", async () => {
    const deps = await configured(makeDeps({ unWpp: [], fallback: { birth_rate: 27.3, death_rate: 7.2, source: "UN WPP 2024 — KEN (2022)" } }), { disease: "dengue" });
    const out = await fetchDemographics({ country_iso3: "KEN" }, deps);
    expect(deps.scenario.params?.birth_rate).toBe(27.3);
    expect(JSON.parse(out.content).citations).toEqual(["UN WPP 2024 — KEN (2022)", "UN WPP 2024 — KEN (2022)"]);
    expect(out.payload).toMatchObject({ kind: "data", source: "sim_fallback", iso3: "KEN" });
  });

  it("falls back when the country is not in the UN table, and reports when both fail", async () => {
    const deps = await configured(makeDeps({ unWpp: kenya, fallback: null }), { disease: "dengue" });
    const out = await fetchDemographics({ country_iso3: "XKX" }, deps);
    expect(deps.queries).toEqual([]);
    expect(out.content).toBe("FETCH ERROR: No demographic data found for XKX in UN WPP, WHO Mortality Database, or World Bank Data360");
    expect(out.isError).toBe(true);
  });

  it("requires configuration first", async () => {
    const out = await fetchDemographics({ country_iso3: "BRA" }, makeDeps({ unWpp: kenya }));
    expect(out.content).toBe("Call configure_simulation first to establish the simulation before fetching data.");
    expect(out.isError).toBe(true);
  });

  it("holds the R0 across the network switch", async () => {
    const deps = makeDeps({ unWpp: [kenya[0], kenya[2], kenya[3]] });
    const configured0 = JSON.parse((await configureSimulation({ disease: "measles", disease_type: "seir", dur_exp: 11, dur_inf: 8, r0: 15, n_agents: 5000 } as never, deps)).content);
    expect(configured0.approx_r0).toBe(15);
    const betaBefore = deps.scenario.params!.beta;
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    expect(deps.scenario.params!.network_type).toBe("age_structured");
    expect(deps.scenario.params!.beta).not.toBe(betaBefore);
    expect(out.approx_r0).toBe(15);
    expect(out.applied.beta_recalibrated_to_hold_r0).toBe(15);
    expect(out.warnings).toEqual([]);
  });

  it("flags an out-of-range R0 after the fetch even without a switch", async () => {
    const deps = await configured(makeDeps({ unWpp: [kenya[2], kenya[3]] }), { disease: "measles", r0: 15, dur_inf: 30 });
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    expect(out.warnings.some((w: string) => w.includes("outside the literature range"))).toBe(true);
  });

  it("applies partial fields without switching the network", async () => {
    const deps = await configured(makeDeps({ unWpp: [kenya[2], kenya[3]] }), { disease: "dengue", r0: 3 });
    const beta = deps.scenario.params!.beta;
    const out = JSON.parse((await fetchDemographics({ country_iso3: "KEN" }, deps)).content);
    expect(deps.scenario.params!.network_type).toBe("random");
    expect(deps.scenario.params!.beta).toBe(beta);
    expect(deps.scenario.params!.use_demographics).toBe(true);
    expect(out.applied).toEqual({ birth_rate: 12.3, death_rate: 7.1 });
    expect(deps.scenario.totalPopulation).toBeNull();
  });

  it("reports an adapter failure as a FETCH ERROR", async () => {
    const deps = await configured(makeDeps({ unWpp: new Error("UN is down"), fallback: null }), { disease: "dengue" });
    const out = await fetchDemographics({ country_iso3: "KEN" }, deps);
    expect(out.content).toBe("FETCH ERROR: UN is down");
    expect(out.isError).toBe(true);
  });
});

describe("fetch_health_system", () => {
  const fields = [
    { ...rf("treatment_capacity", 2.52, "WB WDI, KEN, 2021"), description: "hospital beds/1,000", alternatives: [{ ...rf("treatment_capacity", 0.2, "WB WDI, KEN, 2021"), description: "physicians/1,000" }] },
    { ...rf("uhc_coverage", 56, "WB WDI, KEN, 2022"), description: "UHC service coverage index 0–100" },
  ];

  it("applies capacity to an existing treatment", async () => {
    const deps = await configured(makeDeps({ wbData360: fields }), { disease: "measles", n_agents: 100000, treatment_capacity: 10 });
    const out = JSON.parse((await fetchHealthSystem({ country_iso3: "KEN" }, deps)).content);
    expect(getTreatment(deps.scenario.params!)?.capacity).toBe(252);
    expect(out.applied).toEqual({ treatment_capacity: 2.52, uhc_coverage: 56, applied_treatment_capacity: 252 });
    expect(out.citations).toEqual(["WB WDI, KEN, 2021", "WB WDI, KEN, 2022"]);
    expect(deps.queries[0]).toEqual({ source: "wb_data360", indicatorCodes: ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"], locationCode: "KEN" });
  });

  it("records only when there is no treatment intervention", async () => {
    const deps = await configured(makeDeps({ wbData360: fields }), { disease: "measles" });
    await fetchHealthSystem({ country_iso3: "KEN" }, deps);
    expect(getTreatment(deps.scenario.params!)).toBeNull();
    expect(deps.scenario.dataSources).toHaveLength(2);
  });

  it("reports empty and failed fetches", async () => {
    const empty = await configured(makeDeps({ wbData360: [] }), { disease: "measles" });
    expect((await fetchHealthSystem({ country_iso3: "KEN" }, empty)).content).toBe("FETCH ERROR: no health-system data returned for KEN");
    const down = await configured(makeDeps({ wbData360: new Error("timeout") }), { disease: "measles" });
    expect((await fetchHealthSystem({ country_iso3: "KEN" }, down)).content).toBe("FETCH ERROR: timeout");
    expect((await fetchHealthSystem({ country_iso3: "KEN" }, makeDeps())).content).toMatch(/^Call configure_simulation first/);
  });
});

describe("fetch_vaccination_coverage", () => {
  it("adds a vaccine intervention once", async () => {
    const deps = await configured(makeDeps({ whoGho: [rf("mcv1_coverage", 88, "WHO GHO, KEN, 2022")] }), { disease: "measles" });
    const first = JSON.parse((await fetchVaccinationCoverage({ country_iso3: "KEN", disease: "measles" }, deps)).content);
    expect(getVaccine(deps.scenario.params!)).toMatchObject({ coverage: 0.88, start_day: 0 });
    expect(first.applied).toEqual({ mcv1_coverage: 88, applied_vaccine_coverage: 0.88 });
    expect(deps.queries[0]).toEqual({ source: "who_gho", indicatorCodes: ["WHS8_110", "MCV2"], locationCode: "KEN" });
    await fetchVaccinationCoverage({ country_iso3: "KEN", disease: "measles" }, deps);
    expect(deps.scenario.params!.interventions.filter((i) => i.type === "vaccine")).toHaveLength(1);
  });

  it("says when no indicator exists and when the adapter fails", async () => {
    const deps = await configured(makeDeps({ whoGho: new Error("boom") }), { disease: "dengue" });
    const none = await fetchVaccinationCoverage({ country_iso3: "BRA", disease: "dengue fever" }, deps);
    expect(none.content).toBe("NO VACCINE INDICATOR: no routine-immunization coverage indicator is available for dengue.");
    expect(none.isError).toBeUndefined();
    const failed = await fetchVaccinationCoverage({ country_iso3: "BRA", disease: "measles" }, deps);
    expect(failed.content).toBe("FETCH ERROR: boom");
    const empty = await configured(makeDeps({ whoGho: [] }), { disease: "measles" });
    expect((await fetchVaccinationCoverage({ country_iso3: "BRA", disease: "measles" }, empty)).content).toBe("FETCH ERROR: no vaccination data returned for BRA");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/tools/fetchTools.test.ts`
Expected: failures on the stubs' "not implemented" content.

- [ ] **Step 3: Implement the three tools**

```ts
// web/lib/tools/fetchDemographics.ts
import { z } from "zod";
import { resolved, type ResolvedField } from "@/lib/data/types";
import { unLocationId } from "@/lib/data/unWpp";
import { approxR0, recalibrateBeta, validateParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { NEEDS_CONFIG, errorMessage, errorOutcome, paramWarnings, recordSources } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchDemographicsInput = z.strictObject({ country_iso3: z.string() });
export type FetchDemographicsArgs = z.infer<typeof FetchDemographicsInput>;

const isRecord = (v: unknown): v is Record<string, number> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Ported from epichat/agent.py fetch_demographics; the CSV fallback is the sim service's route. */
export async function fetchDemographics(input: FetchDemographicsArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    let fields: ResolvedField[] = [];
    let source: "un_wpp" | "sim_fallback" = "un_wpp";
    const locationId = unLocationId(iso3);
    if (locationId) fields = await deps.adapters.unWpp({ source: "un_wpp", indicators: [55, 59, 71, 49], locationId });
    if (fields.length === 0) {
      const demo = await deps.sim.demographicsFallback(iso3);
      if (!demo) throw new Error(`No demographic data found for ${iso3} in UN WPP, WHO Mortality Database, or World Bank Data360`);
      fields = [resolved("birth_rate", demo.birth_rate, demo.source), resolved("death_rate", demo.death_rate, demo.source)];
      source = "sim_fallback";
    }

    const before = scenario.params;
    const r0Before = approxR0(before);
    const base: Record<string, unknown> = { ...before };
    const applied: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.field === "age_distribution_pct" && isRecord(f.value)) {
        base.network_type = "age_structured";
        base.age_pct_under18 = f.value["0-17"];
        base.age_pct_18_64 = f.value["18-64"];
        base.age_pct_over65 = f.value["65+"];
        applied.age_structure_pct = f.value;
      } else if (f.field === "total_population") {
        scenario.totalPopulation = Math.trunc(Number(f.value));
        applied.total_population = scenario.totalPopulation;
      } else if (f.field === "birth_rate" || f.field === "death_rate") {
        base[f.field] = f.value;
        base.use_demographics = true;
        applied[f.field] = f.value;
      }
    }
    base.country = iso3;
    const validated = validateParams(base);
    if (!validated.ok) throw new Error(validated.error);
    let params = validated.params;
    if (params.network_type !== before.network_type) {
      // The network switch changes what R0 a beta implies; hold the R0 the user confirmed.
      params = recalibrateBeta(params, r0Before, before);
      applied.network_type = params.network_type;
      applied.beta_recalibrated_to_hold_r0 = pyRound(r0Before, 2);
    }
    scenario.params = params;
    scenario.countryIso3 = iso3;
    const warnings = paramWarnings(scenario, params, deps.contextText);
    const citations = recordSources(scenario, fields);
    const approx_r0 = pyRound(approxR0(params), 2);
    return {
      content: JSON.stringify({ applied, approx_r0, warnings, citations }),
      payload: { kind: "data", source, iso3, applied, citations, warnings, approx_r0 },
    };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
```

```ts
// web/lib/tools/fetchHealthSystem.ts
import { z } from "zod";
import { getTreatment, validateParams } from "@/lib/sim/params";
import { pyRound } from "@/lib/sim/pyformat";
import { NEEDS_CONFIG, errorMessage, errorOutcome, recordSources } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchHealthSystemInput = z.strictObject({ country_iso3: z.string() });
export type FetchHealthSystemArgs = z.infer<typeof FetchHealthSystemInput>;

export const HEALTH_CODES = ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"];

/** Ported from epichat/agent.py fetch_health_system. */
export async function fetchHealthSystem(input: FetchHealthSystemArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    const fields = await deps.adapters.wbData360({ source: "wb_data360", indicatorCodes: HEALTH_CODES, locationCode: iso3 });
    if (fields.length === 0) return errorOutcome(`FETCH ERROR: no health-system data returned for ${iso3}`);
    const applied: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.field, f.value]));
    const cap = fields.find((f) => f.field === "treatment_capacity");
    if (cap && getTreatment(scenario.params)) {
      const capacity = Math.max(1, pyRound((Number(cap.value) * scenario.params.n_agents) / 1000, 0));
      const validated = validateParams({
        ...scenario.params,
        interventions: scenario.params.interventions.map((i) => (i.type === "treatment" ? { ...i, capacity } : i)),
      });
      if (!validated.ok) throw new Error(validated.error);
      scenario.params = validated.params;
      applied.applied_treatment_capacity = capacity;
    }
    const citations = recordSources(scenario, fields);
    return { content: JSON.stringify({ applied, citations }), payload: { kind: "data", source: "wb_data360", iso3, applied, citations } };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
```

```ts
// web/lib/tools/fetchVaccinationCoverage.ts
import { z } from "zod";
import { detectDisease } from "@/lib/disease/db";
import { getVaccine, validateParams } from "@/lib/sim/params";
import { NEEDS_CONFIG, errorMessage, errorOutcome, recordSources, upsertIntervention } from "./shared";
import type { ToolDeps, ToolOutcome } from "./types";

export const FetchVaccinationCoverageInput = z.strictObject({ country_iso3: z.string(), disease: z.string() });
export type FetchVaccinationCoverageArgs = z.infer<typeof FetchVaccinationCoverageInput>;

export const GHO_CODES: Record<string, string[]> = {
  measles: ["WHS8_110", "MCV2"],
  rubella: ["WHS8_110"],
  pertussis: ["WHS3_41"],
  polio: ["WHS3_43"],
  hepatitis_a: ["WHS3_45"],
  tuberculosis: ["WHS3_40"],
  meningococcal: ["MENGA"],
};

/** Ported from epichat/agent.py fetch_vaccination_coverage. */
export async function fetchVaccinationCoverage(input: FetchVaccinationCoverageArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome(NEEDS_CONFIG);
  const iso3 = input.country_iso3.trim().toUpperCase();
  try {
    const canonical = detectDisease(input.disease) ?? input.disease.toLowerCase();
    const codes = GHO_CODES[canonical];
    if (!codes) return { content: `NO VACCINE INDICATOR: no routine-immunization coverage indicator is available for ${canonical}.` };
    const fields = await deps.adapters.whoGho({ source: "who_gho", indicatorCodes: codes, locationCode: iso3 });
    if (fields.length === 0) return errorOutcome(`FETCH ERROR: no vaccination data returned for ${iso3}`);
    const applied: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.field, f.value]));
    const cov = fields.find((f) => f.field.endsWith("_coverage"));
    if (cov && !getVaccine(scenario.params)) {
      const coverage = Math.min(1, Number(cov.value) / 100);
      const validated = validateParams({
        ...scenario.params,
        interventions: upsertIntervention(scenario.params.interventions as unknown as Record<string, unknown>[], "vaccine", { coverage, start_day: 0 }),
      });
      if (!validated.ok) throw new Error(validated.error);
      scenario.params = validated.params;
      applied.applied_vaccine_coverage = coverage;
    }
    const citations = recordSources(scenario, fields);
    return { content: JSON.stringify({ applied, citations }), payload: { kind: "data", source: "who_gho", iso3, applied, citations } };
  } catch (error) {
    return errorOutcome(`FETCH ERROR: ${errorMessage(error)}`);
  }
}
```

- [ ] **Step 4: Run the tool tests**

Run: `npm --prefix web test -- tests/tools`
Expected: all pass, including the registry's thrown-error case if it was marked todo in Task 8 (un-todo it now).

- [ ] **Step 5: Run the whole web suite, typecheck, lint; commit**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/tools/fetchDemographics.ts web/lib/tools/fetchHealthSystem.ts web/lib/tools/fetchVaccinationCoverage.ts web/tests/tools/fetchTools.test.ts web/tests/tools/registry.test.ts
git commit -m "feat(tools): fetch_demographics, fetch_health_system, fetch_vaccination_coverage"
```

---
### Task 10: `run_simulation`

**Files:**
- Modify: `web/lib/tools/runSimulation.ts` (replace the stub)
- Test: `web/tests/tools/runSimulation.test.ts`

**Interfaces:**
- Consumes: `SimClient`, `SimResult`, `SimSuccess` (Task 7); `paramWarnings`, `errorOutcome` (Task 8); `pyRound` (Task 2).
- Produces: `runSimulation(input, deps)`; sets `scenario.hasRun = true` on success; always calls `deps.onRun` once with the `RunRecord`, success or failure.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/tools/runSimulation.test.ts
import { describe, expect, it } from "vitest";

import type { SimSuccess } from "@/lib/sim/client";
import { configureSimulation } from "@/lib/tools/configureSimulation";
import { runSimulation } from "@/lib/tools/runSimulation";
import { makeDeps, params, rf } from "./helpers";

const STATS = { peak_infections: 900, peak_day: 40, total_infected: 6000, total_deaths: 12, n_agents: 50000, sim_days: 366 };
function success(over: Partial<SimSuccess> = {}): SimSuccess {
  return {
    ok: true, effective_params: params({ n_agents: 50000 }), population: 213_000_000,
    stats: { ...STATS, peak_infections: 900 * 4260, total_infected: 6000 * 4260, total_deaths: 12 * 4260 },
    stats_agents: STATS, series: { day: [0, 1], n_infected: [500, 600] }, pop_scale: 4260, repairs: [], attempts: 1,
    duration_ms: 7000, cold_start: false, starsim_version: "3.3.2", ...over,
  };
}

describe("run_simulation", () => {
  it("runs with the population scale, records the run, and returns stats without the series", async () => {
    const deps = makeDeps({ simulate: success(), runId: "run-9" });
    await configureSimulation({ disease: "dengue", n_agents: 50000 } as never, deps);
    deps.scenario.totalPopulation = 213_000_000;
    deps.scenario.dataSources.push(rf("total_population", 213_000_000, "UN WPP 2024"));
    const out = await runSimulation({}, deps);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content);
    expect(body.stats).toEqual(success().stats);
    expect(body.attack_rate_pct).toBe(12);
    expect(body.pop_scale).toBe(4260);
    expect(body.series).toBeUndefined();
    expect(body.data_sources).toEqual([{ field: "total_population", value: 213_000_000, citation: "UN WPP 2024" }]);
    expect(out.payload).toMatchObject({ kind: "run", run_id: "run-9", attack_rate_pct: 12, pop_scale: 4260, population: 213_000_000, series: { day: [0, 1] } });
    expect(deps.scenario.hasRun).toBe(true);
    expect(deps.runs).toHaveLength(1);
    expect(deps.runs[0].popScale).toBe(4260);
    expect(deps.runs[0].result.ok).toBe(true);
  });

  it("uses pop_scale 1 without a population and rounds the reported scale", async () => {
    const deps = makeDeps({ simulate: success({ population: 10000, pop_scale: 1 }) });
    await configureSimulation({ disease: "dengue" } as never, deps);
    deps.scenario.totalPopulation = 12345;
    await runSimulation({}, deps);
    expect(deps.runs[0].popScale).toBeCloseTo(1.2345, 9);
    expect((await runSimulation({}, makeDeps({ simulate: success(), scenario: { ...deps.scenario, totalPopulation: null } }))).content).toContain('"pop_scale": 1');
  });

  it("reports a failed run as a SIMULATION ERROR with the repair log and still records it", async () => {
    const repairs = [{ attempt: 1, error: "KeyError: dur_exp", changes: [{ field: "dur_exp", from: null, to: 5 }], usage: { model: "claude-opus-5-5", input_tokens: 10, output_tokens: 5 } }];
    const deps = makeDeps({ simulate: { ok: false, status: 500, kind: "execution_failed", detail: "Traceback …", repairs, attempts: 2 } });
    await configureSimulation({ disease: "dengue" } as never, deps);
    const out = await runSimulation({}, deps);
    expect(out.isError).toBe(true);
    expect(out.content.startsWith("SIMULATION ERROR: Traceback …")).toBe(true);
    expect(out.content).toContain('"attempt": 1');
    expect(out.payload).toMatchObject({ kind: "tool_error" });
    expect(deps.scenario.hasRun).toBe(false);
    expect(deps.runs[0].result.ok).toBe(false);
  });

  it("explains a timeout and a cap refusal in terms the model can act on", async () => {
    const timeout = makeDeps({ simulate: { ok: false, status: 504, kind: "timeout", detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 1, seconds: 120 } });
    await configureSimulation({ disease: "dengue" } as never, timeout);
    expect((await runSimulation({}, timeout)).content).toBe("SIMULATION ERROR: The simulation timed out after 120 seconds. Fewer agents or a shorter duration usually fixes this.");
    const capped = makeDeps({ simulate: { ok: false, status: 422, kind: "too_large", detail: "n_agents × sim_dur_years = 2,000,000 exceeds the cap of 500,000 agent-years; reduce n_agents or sim_dur_years", repairs: [], attempts: null } });
    await configureSimulation({ disease: "dengue" } as never, capped);
    expect((await runSimulation({}, capped)).content).toBe("SIMULATION ERROR: n_agents × sim_dur_years = 2,000,000 exceeds the cap of 500,000 agent-years; reduce n_agents or sim_dur_years");
  });

  it("requires configuration and tolerates a failed run insert", async () => {
    expect((await runSimulation({}, makeDeps())).content).toBe("Call configure_simulation first to establish the simulation before running.");
    const deps = makeDeps({ simulate: success(), runId: null });
    await configureSimulation({ disease: "dengue" } as never, deps);
    const out = await runSimulation({}, deps);
    expect(out.payload).toMatchObject({ kind: "run", run_id: null });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/tools/runSimulation.test.ts`
Expected: failures on the stub's "not implemented" content.

- [ ] **Step 3: Implement**

The attack rate uses the agent counts (`stats_agents.total_infected / stats_agents.n_agents`), which equals the scaled total over the population; dividing the scaled total by the unscaled agent count, as a literal reading of the spec's sentence would, inflates it by the population scale.

```ts
// web/lib/tools/runSimulation.ts
import { z } from "zod";
import { pyRound } from "@/lib/sim/pyformat";
import { errorOutcome, paramWarnings } from "./shared";
import type { RunPayload, ToolDeps, ToolOutcome } from "./types";

export const RunSimulationInput = z.strictObject({});
export type RunSimulationArgs = z.infer<typeof RunSimulationInput>;

/** Ported from epichat/agent.py run_simulation; the executor is the simulation service. */
export async function runSimulation(_input: RunSimulationArgs, deps: ToolDeps): Promise<ToolOutcome> {
  const scenario = deps.scenario;
  if (!scenario.params) return errorOutcome("Call configure_simulation first to establish the simulation before running.");
  const params = scenario.params;
  const popScale = scenario.totalPopulation && params.n_agents > 0 ? scenario.totalPopulation / params.n_agents : 1.0;
  const result = await deps.sim.simulate(params, popScale, deps.contextText);
  const warnings = paramWarnings(scenario, params, deps.contextText);
  const dataSources = [...scenario.dataSources];
  const runId = await deps.onRun({ params, popScale, result, warnings, dataSources });

  if (!result.ok) {
    const detail = result.kind === "timeout" ? `${result.detail} Fewer agents or a shorter duration usually fixes this.` : result.detail;
    let message = `SIMULATION ERROR: ${detail}`;
    if (result.repairs.length > 0) message += `\nRepair log: ${JSON.stringify(result.repairs, null, 1)}`;
    return errorOutcome(message);
  }

  scenario.hasRun = true;
  const agents = result.stats_agents;
  const n = agents.n_agents || params.n_agents || 1;
  const attack_rate_pct = pyRound((agents.total_infected / n) * 100, 1);
  const pop_scale = pyRound(popScale, 2);
  const sources = dataSources.map((f) => ({ field: f.field, value: f.value, citation: f.citation }));
  const payload: RunPayload = {
    kind: "run",
    run_id: runId,
    stats: result.stats,
    stats_agents: agents,
    attack_rate_pct,
    pop_scale,
    population: result.population,
    effective_params: result.effective_params,
    warnings,
    repairs: result.repairs,
    data_sources: dataSources,
    duration_ms: result.duration_ms,
    cold_start: result.cold_start,
    series: result.series,
  };
  return {
    content: JSON.stringify({
      stats: result.stats, attack_rate_pct, pop_scale, effective_params: result.effective_params,
      warnings, repairs: result.repairs, data_sources: sources,
    }),
    payload,
  };
}
```

- [ ] **Step 4: Run the tool tests, the whole suite, typecheck, lint; commit**

Run: `npm --prefix web test -- tests/tools && npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green.

```bash
git add web/lib/tools/runSimulation.ts web/tests/tools/runSimulation.test.ts
git commit -m "feat(tools): run_simulation through the simulation service"
```

---

### Task 11: System prompt, suggestions, stages

**Files:**
- Create: `web/lib/chat/prompt.ts`, `web/lib/chat/next.ts`, `web/lib/chat/stages.ts`
- Test: `web/tests/chat/prompt.test.ts`, `web/tests/chat/next.test.ts`, `web/tests/chat/stages.test.ts`

**Interfaces:**
- Consumes: `web/data/system_prompt.json` (Task 4), `TOOLS` (Task 8), `Scenario`, `emptyScenario` (Task 8), `STAGES`, `Stage` (`lib/enums.ts`).
- Produces:
  ```ts
  export const SYSTEM_PROMPT: string;                                   // Python _SYSTEM + three sections
  export function systemBlocks(): Anthropic.Beta.BetaTextBlockParam[];  // one block with cache_control ephemeral
  export function firstUserMessage(dateIso: string, text: string): string;   // "Today's date: 2026-10-08.\n\n<text>"
  export function parseNext(text: string): string[] | null;             // 1..3 suggestions from the last complete ```next block
  export function withoutNext(text: string): string;
  export const STAGE_INDEX: Record<Stage, number>;
  export function deriveStage(scenario: Pick<Scenario, "params" | "dataSources" | "hasRun">, running?: boolean): Stage;
  export function advanceStage(scenario: Scenario, running?: boolean): { stage: Stage; changed: boolean; reached: Stage | null };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/chat/prompt.test.ts
import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT, firstUserMessage, systemBlocks } from "@/lib/chat/prompt";
import { TOOLS } from "@/lib/tools";
import promptFile from "@/data/system_prompt.json";

describe("system prompt", () => {
  it("starts with the Python agent's prompt verbatim and adds the three sections", () => {
    expect(SYSTEM_PROMPT.startsWith((promptFile as { system: string }).system)).toBe(true);
    for (const heading of ["## Suggested replies", "## Cards", "## Repairs"]) expect(SYSTEM_PROMPT).toContain(heading);
    expect(SYSTEM_PROMPT).toContain("```next");
  });

  it("keeps the phrases the Python tests pin", () => {
    for (const phrase of ["under_review", "no_source", "estimates_only", "estimate_range", "estimate_extremes", "illustrative assumption", "not a forecast", "web_search", "web_fetch", "medical advice"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
    expect(/transmissib|virulen/.test(SYSTEM_PROMPT)).toBe(true);
    for (const tool of TOOLS) expect(SYSTEM_PROMPT).toContain(tool.name);
  });

  it("is deterministic, dateless, and long enough to cache", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(5000);
    expect(systemBlocks()).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  });

  it("puts the date on the first line of the first user message", () => {
    expect(firstUserMessage("2026-10-08", "Model measles in Kenya")).toBe("Today's date: 2026-10-08.\n\nModel measles in Kenya");
  });
});
```

```ts
// web/tests/chat/next.test.ts
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
});
```

```ts
// web/tests/chat/stages.test.ts
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
    expect(STAGE_INDEX).toEqual({ understand: 0, configure: 1, ground: 2, run: 3, interpret: 4 });
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
    expect(advanceStage(s, true)).toEqual({ stage: "run", changed: true, reached: null });
    expect(s.stageReached).toBe("interpret");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/chat`
Expected: cannot resolve `@/lib/chat/prompt` (and the others).

- [ ] **Step 3: Implement**

```ts
// web/lib/chat/prompt.ts
/**
 * The system prompt: the Python agent's text verbatim (exported by
 * scripts/export_web_data.py, so the port cannot drift), followed by the three
 * additions from the agent-core spec, section 10. Sent as one cached block.
 * Keep it free of dates and anything else that differs between requests.
 */
import type Anthropic from "@anthropic-ai/sdk";
import promptFile from "@/data/system_prompt.json";

const PYTHON_SYSTEM = (promptFile as { system: string }).system;

const ADDITIONS = `

## Suggested replies

- End every reply with a fenced block tagged \`next\` holding one to three short replies the user might send next, one per line. Each is a complete message that fits the moment ("Yes, fetch the data", "Run it", "Set R0 to 12", "Compare with 90% coverage"), never a placeholder the user would have to fill in. The interface turns the block into buttons and never shows it as text, so nothing else goes in it:

\`\`\`next
Yes, fetch the data
Run it
\`\`\`

## Cards

- The interface renders disease parameters, the configuration, fetched data, and simulation results as cards built from your tool results. Do not retype those numbers in tables or lists; interpret them: what the peak means, what the interventions did, what the limitations are.

## Repairs

- When run_simulation reports repairs, say which parameters were changed to make the run succeed and why, before interpreting the results.`;

export const SYSTEM_PROMPT = PYTHON_SYSTEM + ADDITIONS;

export function systemBlocks(): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
}

/** The first message of a conversation carries the date, so the system prompt stays byte-stable. */
export function firstUserMessage(dateIso: string, text: string): string {
  return `Today's date: ${dateIso}.\n\n${text}`;
}
```

```ts
// web/lib/chat/next.ts
/**
 * The ```next block the assistant ends each reply with: one to three
 * suggested replies. Adapted from CampusOtter's nextStep.ts without the
 * stage line (stages are derived from tool events, never declared).
 */
const MAX_SUGGESTIONS = 3;
const MAX_CHARS = 80;
const COMPLETE_BLOCK = /```next[ \t]*\n([\s\S]*?)\n?```/g;
// A block that has started and not yet closed, or the first backticks of one.
const ARRIVING_BLOCK = /\n*```(?:n(?:e(?:x(?:t[\s\S]*)?)?)?)?$|\n*`{1,2}$/;

export function parseNext(text: string): string[] | null {
  const blocks = [...text.matchAll(COMPLETE_BLOCK)];
  const last = blocks.at(-1);
  if (!last) return null;
  const items: string[] = [];
  for (const raw of last[1].split("\n")) {
    const line = raw.trim();
    if (!line || /^stage:/i.test(line)) continue;
    if (items.length < MAX_SUGGESTIONS) items.push(line.replace(/^[-*]\s+/, "").slice(0, MAX_CHARS).trim());
  }
  return items;
}

/** The reply as the user should read it: no block, whether complete or still arriving. */
export function withoutNext(text: string): string {
  const shown = text.replace(COMPLETE_BLOCK, "");
  const arriving = ARRIVING_BLOCK.exec(shown);
  if (!arriving) return shown.trim();
  // An odd number of fences before it means another code block is open and these backticks close it.
  const fencesBefore = shown.slice(0, arriving.index).split("```").length - 1;
  return (fencesBefore % 2 === 1 ? shown : shown.slice(0, arriving.index)).trim();
}
```

```ts
// web/lib/chat/stages.ts
/** Parent spec 10.1: the stage is derived from the scenario, never declared by the model. */
import { STAGES, type Stage } from "@/lib/enums";
import type { Scenario } from "@/lib/tools/types";

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<Stage, number>;

export function deriveStage(scenario: Pick<Scenario, "params" | "dataSources" | "hasRun">, running = false): Stage {
  if (running) return "run";
  if (scenario.hasRun) return "interpret";
  if (scenario.dataSources.length > 0) return "ground";
  if (scenario.params) return "configure";
  return "understand";
}

/** Update the scenario's stage; report a change and, when the furthest stage advances, the stage newly reached. */
export function advanceStage(scenario: Scenario, running = false): { stage: Stage; changed: boolean; reached: Stage | null } {
  const stage = deriveStage(scenario, running);
  const changed = stage !== scenario.stage;
  scenario.stage = stage;
  let reached: Stage | null = null;
  if (STAGE_INDEX[stage] > STAGE_INDEX[scenario.stageReached]) {
    scenario.stageReached = stage;
    reached = stage;
  }
  return { stage, changed, reached };
}
```

- [ ] **Step 4: Run the tests, the whole suite, typecheck, lint; commit**

Run: `npm --prefix web test -- tests/chat && npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all green. If the prompt-length test fails, the export in Task 4 did not run: `npm --prefix web run sync-data`.

```bash
git add web/lib/chat web/tests/chat
git commit -m "feat(chat): system prompt from the Python export, next-block parsing, stage derivation"
```

---

## Self-review notes

- **Spec coverage.** Section 4 settings and price table: Task 1. Section 5 modules: `models` (1), `sim/pyformat` (2), `sim/params` (3), the three scripts and `web/data` (4), `disease/*` (5), `data/*` (6), `sim/client` (7), `tools/*` (8, 9, 10), `chat/prompt`, `chat/next`, `chat/stages` (11). Section 6 tools and payloads: Tasks 8 to 10; the export shapes and parity fixture: Task 4. Section 10 prompt: Task 11. Sections 3, 7, 8 (events and blocks), 9, 11, 12, 14 are Plan B. Section 13's Python-side tests: Task 4.
- **Deviations stated.** The prompt text is imported from the export rather than transcribed (Task 11); the attack rate is computed from agent counts (Task 10, with the reason); `Adapters` lives in `data/types.ts`; Task 8 creates four stub files that Tasks 9 and 10 replace, so the registry compiles from the first commit.
- **Type consistency.** `ResolvedField` and `DataQuery` are defined once in `data/types.ts` and consumed by Tasks 6, 8, 9, 10. `SimResult`/`SimSuccess`/`RepairRecord`/`SimStats` from Task 7 are used by Task 8's payload types and Task 10. `Scenario`, `ToolDeps`, `RunRecord` from Task 8 are used by Tasks 9, 10, 11. `validateParams` returns `ParamsResult` everywhere; `clampBeta(calibrateBeta(p, r0))` is the one calibration idiom (Tasks 3, 5, 8). `pyRound` is the only rounding used for anything a person reads.
- **Review Focus mapping.** 1 → Task 8 `treats null fields as not passed`; 2 → Task 5 `detects hyphenated aliases and respects word boundaries`; 3 → Task 6 `parses CRLF and the sep line`; 4 → Task 2 `g4 and f1 match Python on ties`; 5 → Task 9 `applies partial fields without switching the network`.
- **Placeholder scan.** The only "not implemented" strings are the Task 8 stubs that Tasks 9 and 10 delete; no step describes work without its code.
