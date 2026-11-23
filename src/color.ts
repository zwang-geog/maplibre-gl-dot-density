/**
 * Color inputs for the layer. One value per group, in any mix of:
 *
 *   "#e7298a"              hex (3, 4, 6, or 8 digits; optional `#`)
 *   "rgb(231, 41, 138)"    CSS `rgb()` / `rgba()`, commas or spaces, `%` ok
 *   [231, 41, 138]         channels: 0–255 if any RGB > 1, else 0–1
 *   [231, 41, 138, 255]    alpha 0–255 if > 1, else 0–1  (so both 255 and 1 work)
 */

export type ColorInput = string | readonly number[];

/** Straight (non-premultiplied) RGBA in 0–1. Premultiply when uploading to GL. */
export type Rgba = [number, number, number, number];

const DEFAULT_COLOR: Rgba = [1, 0, 0, 1]; // #ff0000

export function parseColors(inputs: ColorInput | readonly ColorInput[] | undefined): Rgba[] {
  if (inputs === undefined) return [DEFAULT_COLOR];
  const list = isColorList(inputs) ? inputs : [inputs];
  if (list.length === 0) return [DEFAULT_COLOR];
  return list.map((input, i) => {
    try {
      return parseColor(input);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new TypeError(`colors[${i}]: ${why}`);
    }
  });
}

export function parseColor(input: ColorInput): Rgba {
  if (typeof input === "string") return parseCssColor(input.trim());
  if (Array.isArray(input) || isArrayLike(input)) return parseChannelArray(input);
  throw new TypeError(`expected a CSS color string or [r,g,b(,a)], got ${typeof input}`);
}

function isColorList(input: ColorInput | readonly ColorInput[]): input is readonly ColorInput[] {
  // A numeric channel array is [number, number, …]. A colors list is
  // ["#hex", …] or [[r,g,b], …] — never a flat list of numbers.
  if (!Array.isArray(input)) return false;
  if (input.length === 0) return true;
  return typeof input[0] === "string" || Array.isArray(input[0]);
}

function isArrayLike(input: unknown): input is readonly number[] {
  return Array.isArray(input);
}

function parseCssColor(raw: string): Rgba {
  if (raw.startsWith("#") || /^[0-9a-f]{3,8}$/i.test(raw)) return parseHex(raw);
  const fn = raw.match(/^(rgba?)\(\s*([\s\S]+)\)\s*$/i);
  if (fn) return parseRgbFn(fn[2]);
  throw new TypeError(`unsupported color "${raw}" (use hex, rgb(), rgba(), or [r,g,b,a])`);
}

function parseHex(raw: string): Rgba {
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  let r: number;
  let g: number;
  let b: number;
  let a = 255;
  if (hex.length === 3 || hex.length === 4) {
    r = nibble(hex[0]);
    g = nibble(hex[1]);
    b = nibble(hex[2]);
    if (hex.length === 4) a = nibble(hex[3]);
  } else if (hex.length === 6 || hex.length === 8) {
    r = byte(hex.slice(0, 2));
    g = byte(hex.slice(2, 4));
    b = byte(hex.slice(4, 6));
    if (hex.length === 8) a = byte(hex.slice(6, 8));
  } else {
    throw new TypeError(`hex color must be 3, 4, 6, or 8 digits, got "${raw}"`);
  }
  return [r / 255, g / 255, b / 255, a / 255];
}

function nibble(ch: string): number {
  const v = parseInt(ch + ch, 16);
  if (!Number.isFinite(v)) throw new TypeError(`bad hex digit "${ch}"`);
  return v;
}

function byte(pair: string): number {
  const v = parseInt(pair, 16);
  if (!Number.isFinite(v)) throw new TypeError(`bad hex "${pair}"`);
  return v;
}

function parseRgbFn(body: string): Rgba {
  // "231, 41, 138, 0.5"  |  "231 41 138 / 50%"  |  "90% 16% 54%"
  const slash = body.split("/");
  const main = slash[0].trim();
  const alphaPart = slash[1]?.trim();
  const parts = main.split(/[\s,]+/).filter(Boolean);
  if (alphaPart) parts.push(alphaPart);
  if (parts.length !== 3 && parts.length !== 4) {
    throw new TypeError(`rgb() needs 3 or 4 channels, got ${parts.length}`);
  }
  const r = cssChannel(parts[0], 255);
  const g = cssChannel(parts[1], 255);
  const b = cssChannel(parts[2], 255);
  const a = parts[3] !== undefined ? cssChannel(parts[3], 1) : 1;
  return [r, g, b, a];
}

/** `scale` is the unit for a unitless number: 255 for RGB, 1 for alpha. */
function cssChannel(token: string, scale: number): number {
  const t = token.trim();
  if (t.endsWith("%")) {
    const pct = Number(t.slice(0, -1));
    if (!Number.isFinite(pct)) throw new TypeError(`bad % channel "${token}"`);
    return clamp01(pct / 100);
  }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new TypeError(`bad channel "${token}"`);
  return clamp01(n / scale);
}

function parseChannelArray(channels: readonly number[]): Rgba {
  if (channels.length !== 3 && channels.length !== 4) {
    throw new TypeError(`channel array must have 3 or 4 numbers, got ${channels.length}`);
  }
  const rIn = channels[0];
  const gIn = channels[1];
  const bIn = channels[2];
  const aIn = channels[3];
  if (![rIn, gIn, bIn, aIn ?? 0].every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new TypeError("channel array must be finite numbers");
  }
  // 0–1 vs 0–255: if any RGB component is > 1, treat RGB as bytes.
  const rgbByte = rIn > 1 || gIn > 1 || bIn > 1;
  const r = clamp01(rgbByte ? rIn / 255 : rIn);
  const g = clamp01(rgbByte ? gIn / 255 : gIn);
  const b = clamp01(rgbByte ? bIn / 255 : bIn);
  let a = 1;
  if (aIn !== undefined) {
    // [231, 41, 138, 255] → 1;  [0.27, 0.46, 0.71, 0.5] → 0.5
    a = clamp01(aIn > 1 ? aIn / 255 : aIn);
  }
  return [r, g, b, a];
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Premultiply for `gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`. */
export function premultiply(c: Rgba): Rgba {
  return [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];
}
