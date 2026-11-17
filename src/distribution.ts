/**
 * The shape of a venue's review scores: kernel densities, quantiles and standings. Pure, no DOM. Ported from
 * acceptodds' `lib/distribution.ts` (the "where you stand" chart), with a bandwidth chosen for scores, which are
 * discrete.
 */

/** The `p` quantile of sorted `values`, linearly interpolated. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const i = (values.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return values[lo] + (values[hi] - values[lo]) * (i - lo);
}

/** The share of the mass the "heavy" values hold, whose gaps set the bandwidth's floor. */
const HEAVY_MASS = 0.9;

/**
 * The widest gap between neighbouring values among those that hold most of the mass. Review scores are discrete
 * (ICLR rates on {1, 3, 5, 6, 8, 10}), so a submission's mean over three or four reviews falls on a few values, most
 * of the mass on a lattice (quarters, thirds) and a little on rarer values between. The distinct values are taken
 * from the most common down until they hold `HEAVY_MASS` of the submissions; the result is the widest gap between
 * two of them that are neighbours. `values` sorted ascending.
 */
export function latticeGap(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size < 2) return 0;
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const heavy: number[] = [];
  let mass = 0;
  for (const [value, count] of byCount) {
    heavy.push(value);
    mass += count;
    if (mass >= HEAVY_MASS * values.length && heavy.length >= 2) break;
  }
  heavy.sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < heavy.length; i += 1) gap = Math.max(gap, heavy[i] - heavy[i - 1]);
  return gap;
}

/**
 * Two equal Gaussians `d` apart sum to one bump while `h ≥ d/2`, and to two with a dip between once they are further
 * apart. Neighbours are rarely equal: means over 3–5 ICLR-style reviews put a light value between two heavy ones, and
 * at `h = 0.6·d` a spurious second mode still showed in some simulated ICLR-sized venues (`test/distribution.test.ts`).
 * At `0.8·d` none did, from a thousand submissions up.
 */
const LATTICE_FACTOR = 0.8;

/** The narrowest a kernel may be, as a share of the values' range: a flat field still draws a visible bump. */
const MIN_BANDWIDTH_OF_RANGE = 1 / 40;

/**
 * The kernel's width for sorted `values`: Silverman's rule of thumb, `0.9 · min(σ, IQR/1.34) · n^(−1/5)`, but never
 * narrower than `LATTICE_FACTOR` times the widest gap between the values that hold most of the mass
 * (`latticeGap`). Narrower, the curve would show a mode at every value the means bunch at and invent dips between
 * them; the histogram shows that bunching honestly instead. Also floored at a share of the range, and above zero
 * for a field of identical values.
 */
export function bandwidth(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 1;
  const mean = values.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  const iqr = quantile(values, 0.75) - quantile(values, 0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  const silverman = 0.9 * spread * n ** -0.2;
  const range = values[n - 1] - values[0];
  return Math.max(silverman, LATTICE_FACTOR * latticeGap(values), range * MIN_BANDWIDTH_OF_RANGE, 1e-3);
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
 * bandwidths past the extremes, where the curve has all but reached zero). `h` defaults to `bandwidth(values)`;
 * pass the whole field's so that subsets (one outcome) are drawn with the same kernel and add up to it.
 */
export function density(
  values: readonly number[],
  options: { points?: number; domain?: [number, number]; h?: number } = {},
): Density {
  const h = options.h ?? bandwidth(values);
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

/**
 * Densities for drawing: scaled so the highest is 1, then square-rooted (a rootogram's scale), so the tails of a
 * peaked field still read beside its crowd. Still monotonic: a taller curve is still more papers.
 */
export function rootScaled(ys: readonly number[], peak = Math.max(...ys)): number[] {
  return ys.map((y) => (peak > 0 ? Math.sqrt(Math.max(0, y) / peak) : 0));
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
