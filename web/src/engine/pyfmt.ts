/**
 * Python-exact number formatting and rounding.
 *
 * Python's float formatting rounds the exact binary value correctly, sending exact ties to even
 * (f"{26.5:.0f}" == "26"), while JavaScript's toFixed sends them up ("27"). Percentiles such as 26.5
 * are common here, so the port formats with exact BigInt arithmetic to match Python byte for byte.
 */

const view = new DataView(new ArrayBuffer(8));

/** Decompose a finite double into mantissa * 2^exponent (mantissa a non-negative BigInt). */
function decompose(x: number): { mant: bigint; exp: number } {
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (biased === 0) return { mant: frac, exp: -1074 };
  return { mant: frac | (1n << 52n), exp: biased - 1075 };
}

/** Equivalent of Python f"{x:.{digits}f}" (no thousands separator). */
export function pyFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const negative = x < 0 || Object.is(x, -0);
  const { mant, exp } = decompose(x);
  const scale = 10n ** BigInt(digits);
  let q: bigint;
  if (exp >= 0) {
    q = (mant << BigInt(exp)) * scale;
  } else {
    const num = mant * scale;
    const den = 1n << BigInt(-exp);
    q = num / den;
    const rem2 = (num % den) * 2n;
    if (rem2 > den || (rem2 === den && q % 2n === 1n)) q += 1n;
  }
  let s = q.toString();
  if (digits > 0) {
    s = s.padStart(digits + 1, "0");
    s = `${s.slice(0, -digits)}.${s.slice(-digits)}`;
  }
  return (negative ? "-" : "") + s;
}

/** Python round(x, digits) for floats: the double nearest the correctly rounded decimal. */
export function pyRound(x: number, digits: number): number {
  return Number(pyFixed(x, digits));
}

/** Insert thousands separators into a formatted number string ("-1234567.8" -> "-1,234,567.8"). */
export function commas(s: string): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [int, frac] = body.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + (frac !== undefined ? `.${frac}` : "");
}

/** Python f"{x:,.{digits}f}". */
export function pyComma(x: number, digits: number): string {
  return commas(pyFixed(x, digits));
}

/** Python f"{x:+.{digits}f}". */
export function pySigned(x: number, digits: number): string {
  const s = pyFixed(x, digits);
  return s.startsWith("-") ? s : `+${s}`;
}

/** Python f"{x:+g}" for the small lever values used in scenario text. */
export function pyPlusG(x: number): string {
  let s: string;
  if (Number.isInteger(x)) s = String(x);
  else s = String(Number(x.toPrecision(6)));
  if (Object.is(x, -0)) s = "-0";
  return x >= 0 && !Object.is(x, -0) ? `+${s}` : s;
}

/** Python f"{x:.0%}". */
export function pyPercent0(x: number): string {
  return `${pyFixed(x * 100, 0)}%`;
}

/** Python str.title(): a cased letter is uppercased after a non-cased character, lowercased otherwise. */
export function pyTitle(s: string): string {
  let out = "";
  let prevCased = false;
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    const cased = lower !== upper;
    out += cased ? (prevCased ? lower : upper) : ch;
    prevCased = cased;
  }
  return out;
}

/** Port of kpis.ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 53rd. */
export function ordinal(value: number): string {
  const n = Number.parseInt(pyFixed(value, 0), 10);
  const m100 = ((n % 100) + 100) % 100;
  const m10 = ((n % 10) + 10) % 10;
  const suffix = m100 >= 10 && m100 <= 20 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[m10] ?? "th";
  return `${n}${suffix}`;
}
