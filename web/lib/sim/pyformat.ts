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
  const fixed = Math.abs(x).toFixed(EXACT_DIGITS); // "12.1250000000000000000000000"
  const [whole, frac] = fixed.split(".");
  return { digits: whole + frac, pointAt: whole.length, negative };
}

/** Round the digit string to `keep` digits after the point, half to even on the exact expansion. */
function roundDigits(digits: string, pointAt: number, keep: number): { digits: string; pointAt: number } {
  const cut = pointAt + keep; // digits kept
  if (cut >= digits.length) return { digits, pointAt };
  if (cut < 0) return { digits: "0", pointAt: 1 };
  const kept = digits.slice(0, cut);
  const rest = digits.slice(cut);
  const first = rest.charCodeAt(0) - 48;
  const tail = rest.slice(1);
  const exactlyHalf = first === 5 && /^0*$/.test(tail);
  const lastKept = kept.length > 0 ? kept.charCodeAt(kept.length - 1) - 48 : 0;
  const up = first > 5 || (first === 5 && !exactlyHalf) || (exactlyHalf && lastKept % 2 === 1);
  if (kept.length === 0) return up ? { digits: "1", pointAt: pointAt + 1 } : { digits: "0", pointAt: 1 };
  if (!up) return { digits: kept, pointAt };
  const arr = kept.split("");
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === "9") {
      arr[i] = "0";
      i--;
    } else {
      arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1);
      break;
    }
  }
  if (i < 0) {
    arr.unshift("1");
    return { digits: arr.join(""), pointAt: pointAt + 1 };
  }
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
  return (v < 0 ? "-" : "") + s;
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
  // round to 4 significant digits: keep (3 - exponent) digits after the point
  const r = roundDigits(digits, pointAt, 3 - exponent);
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
  const s = Math.abs(Math.trunc(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
    const grouped = commaInt(Number(whole));
    return frac ? `${grouped}.${frac}` : grouped;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>)
      .slice(0, 3)
      .map(([k, vv]) => `${k}: ${String(vv)}`)
      .join(", ");
  }
  return String(v);
}
