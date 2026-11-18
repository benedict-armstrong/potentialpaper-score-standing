/**
 * The shape of a venue's review scores: kernel densities, quantiles and standings. Pure, no DOM. Drawn as
 * acceptodds draws its review distribution (`lib/reviews.ts`): a kernel 6% of the scale wide, scaled to a peak of 1.
 */

/** The `p` quantile of sorted `values`, linearly interpolated. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const i = (values.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return values[lo] + (values[hi] - values[lo]) * (i - lo);
}

/**
 * The kernel's width, as a share of the scale, as acceptodds draws it. A mean of three whole-number scores falls on
 * thirds, so anything narrow draws a comb; at this width neighbouring thirds of a 1–4 scale (a ninth of it apart)
 * blend into one shape. The curve is only the shape: the marker and every share read off it come from the real means.
 */
export const BANDWIDTH_OF_SCALE = 0.06;

/** The kernel's width on a scale from `lo` to `hi`. */
export function scaleBandwidth(lo: number, hi: number): number {
  return hi > lo ? (hi - lo) * BANDWIDTH_OF_SCALE : 1;
}

export interface Density {
  /** Evenly spaced from `domain[0]` to `domain[1]`. */
  xs: number[];
  /** The Gaussian kernel density at each x; integrates to ~1 over the whole line. */
  ys: number[];
  domain: [number, number];
  bandwidth: number;
}

/** Each distinct value with how often it occurs: the KDE sums over these, so 40k means at a few dozen values is cheap. */
function weighted(values: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[0] === v) last[1] += 1;
    else out.push([v, 1]);
  }
  return out;
}

/**
 * A Gaussian kernel density of sorted `values` at `points` evenly spaced x's over `domain` (by default three
 * bandwidths past the extremes, where the curve has all but reached zero), with kernel width `h`. Pass the whole
 * field's `h` so that subsets (one outcome) are drawn with the same kernel and add up to it.
 */
export function density(
  values: readonly number[],
  options: { h: number; points?: number; domain?: [number, number] },
): Density {
  const h = options.h;
  const points = options.points ?? 160;
  const domain: [number, number] = options.domain ?? [
    (values[0] ?? 0) - 3 * h,
    (values[values.length - 1] ?? 0) + 3 * h,
  ];
  const [lo, hi] = domain;
  const xs: number[] = [];
  const ys: number[] = [];
  const pairs = weighted(values);
  const norm = values.length ? 1 / (values.length * h * Math.sqrt(2 * Math.PI)) : 0;
  for (let i = 0; i < points; i += 1) {
    const x = lo + ((hi - lo) * i) / (points - 1);
    let sum = 0;
    for (const [v, w] of pairs) sum += w * Math.exp(-0.5 * ((x - v) / h) ** 2);
    xs.push(x);
    ys.push(sum * norm);
  }
  return { xs, ys, domain, bandwidth: h };
}

/** Densities for drawing: scaled linearly so the highest is 1, as acceptodds draws them. */
export function peakScaled(ys: readonly number[], peak = Math.max(...ys)): number[] {
  return ys.map((y) => (peak > 0 ? Math.max(0, y) / peak : 0));
}

/** How many of sorted `values` are strictly below `x`, by binary search. */
export function countBelow(values: readonly number[], x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The number of local maxima of a sampled curve: a plateau counts once. For tests and checks. */
export function modes(ys: readonly number[], tolerance = 1e-9): number {
  let count = 0;
  let rising = true;
  for (let i = 1; i < ys.length; i += 1) {
    const d = ys[i] - ys[i - 1];
    if (d > tolerance) rising = true;
    else if (d < -tolerance) {
      if (rising) count += 1;
      rising = false;
    }
  }
  return rising && ys.length > 1 ? count + 1 : count;
}

/**
 * About `count` round tick values inside `[lo, hi]`: steps of 1, 2 or 5 times a power of ten.
 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

/**
 * The share of the rest of the field a paper is strictly ahead of, as a percentage rounded down, so it never
 * flatters. Ties are not beaten. `null` for a field of one, where there is nobody to be ahead of.
 */
export function percentAhead(below: number, fieldSize: number): number | null {
  if (fieldSize <= 1) return null;
  return Math.floor((100 * below) / (fieldSize - 1));
}

/** `percentAhead` as a band: "Top 12%" from half-way up, "Bottom 12%" below it; never 0%. */
export function standingBand(ahead: number): string {
  const top = ahead >= 50;
  return `${top ? 'Top' : 'Bottom'} ${Math.max(1, Math.ceil(top ? 100 - ahead : ahead))}%`;
}

/** The density at `x`, linearly interpolated between the sampled points. */
export function yAt(d: { xs: readonly number[]; ys: readonly number[] }, x: number): number {
  const i = d.xs.findIndex((v) => v >= x);
  if (i === -1) return d.ys[d.ys.length - 1] ?? 0;
  if (i === 0) return d.ys[0];
  const t = (x - d.xs[i - 1]) / (d.xs[i] - d.xs[i - 1]);
  return d.ys[i - 1] + (d.ys[i] - d.ys[i - 1]) * t;
}
