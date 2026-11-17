/// <reference path="./pp.d.ts" />
/**
 * The two figures as numbers, before any drawing: the histogram's stacked bars and the curve's layers. Pure, so the
 * tests can check what is drawn without a DOM.
 */
import { bandwidth, countBelow, density, rootScaled } from './distribution';
import { binIndex, OUTCOMES, type Outcome } from './standing';

export interface Layer {
  outcome: Outcome;
  /** Per bin (histogram) or per sample (curve): where the layer starts and ends, stacked from the base. */
  from: number[];
  to: number[];
}

export interface HistogramModel {
  bins: PP.Bins;
  /** Every submission per bin. */
  totals: number[];
  peak: number;
  total: number;
  /** By outcome, stacked in `OUTCOMES` order; empty when not split. */
  layers: Layer[];
  /** The paper's bin, or `null` with no paper. */
  mine: number | null;
}

export function histogramModel(field: Pick<PP.ScoreField, 'bins' | 'split'>, split: boolean, mean: number | null): HistogramModel {
  const { bins } = field;
  const totals = bins.counts.slice();
  const layers: Layer[] = [];
  if (split) {
    const base = totals.map(() => 0);
    for (const outcome of OUTCOMES) {
      const counts = field.split[outcome]?.bins.counts ?? [];
      if (!counts.some((c) => c > 0)) continue;
      const from = base.slice();
      counts.forEach((c, i) => (base[i] += c));
      layers.push({ outcome, from, to: base.slice() });
    }
  }
  return {
    bins,
    totals,
    peak: Math.max(1, ...totals),
    total: totals.reduce((a, b) => a + b, 0),
    layers,
    mine: mean === null ? null : binIndex(bins, mean),
  };
}

export interface CurveModel {
  xs: number[];
  /** Root-scaled to peak at 1: the curve's height at each x. */
  ys: number[];
  domain: [number, number];
  bandwidth: number;
  /**
   * By outcome, each a share of the curve's height: at each x, the layers split the height in proportion to how
   * many submissions of each outcome the kernel puts there, so the accepted layer's share is the accept rate there.
   */
  layers: Layer[];
  /** The share of each outcome at each x (sums to 1 where the curve is above zero). */
  shares: Partial<Record<Outcome, number[]>>;
}

/**
 * The curve: a kernel density of the means (one kernel for the whole field, `bandwidth`), root-scaled. Its domain is
 * the form's range when the form gives one (no score falls outside it), else three kernels past the extremes, and
 * always takes in `include` (the paper's mean).
 */
export function curveModel(
  field: Pick<PP.ScoreField, 'values' | 'split' | 'min' | 'max'>,
  split: boolean,
  include: number | null = null,
  points = 160,
): CurveModel {
  const values = field.values;
  const h = bandwidth(values);
  let lo = field.min ?? (values[0] ?? 0) - 3 * h;
  let hi = field.max ?? (values[values.length - 1] ?? 0) + 3 * h;
  if (values.length) {
    lo = Math.min(lo, values[0]);
    hi = Math.max(hi, values[values.length - 1]);
  }
  if (include !== null) {
    lo = Math.min(lo, include);
    hi = Math.max(hi, include);
  }
  if (!(hi > lo)) {
    lo -= 1;
    hi += 1;
  }
  const domain: [number, number] = [lo, hi];
  const total = density(values, { h, domain, points });
  const ys = rootScaled(total.ys);
  const layers: Layer[] = [];
  const shares: CurveModel['shares'] = {};
  if (split && values.length) {
    const base = ys.map(() => 0);
    for (const outcome of OUTCOMES) {
      const part = field.split[outcome];
      if (!part || part.count === 0) continue;
      const d = density(part.values, { h, domain, points });
      const share = d.ys.map((y, i) => (total.ys[i] > 0 ? (y * part.values.length) / (total.ys[i] * values.length) : 0));
      shares[outcome] = share;
      const from = base.slice();
      share.forEach((s, i) => (base[i] += s * ys[i]));
      layers.push({ outcome, from, to: base.slice() });
    }
  }
  return { xs: total.xs, ys, domain, bandwidth: h, layers, shares };
}

/** What hovering the curve at `x` reads off: how many submissions are below, and (split) the accept rate there. */
export function curveReadout(
  model: CurveModel,
  values: readonly number[],
  x: number,
): { below: number; acceptRate: number | null } {
  const below = countBelow(values, x);
  const accepted = model.shares.accepted;
  const rejected = model.shares.rejected;
  if (!accepted && !rejected) return { below, acceptRate: null };
  const i = Math.round(((x - model.domain[0]) / (model.domain[1] - model.domain[0])) * (model.xs.length - 1));
  const at = Math.min(model.xs.length - 1, Math.max(0, i));
  const a = accepted?.[at] ?? 0;
  const r = rejected?.[at] ?? 0;
  return { below, acceptRate: a + r > 1e-6 ? a / (a + r) : null };
}
