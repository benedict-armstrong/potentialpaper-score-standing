import { describe, expect, it } from 'vitest';
import {
  countBelow,
  density,
  modes,
  niceTicks,
  peakScaled,
  percentAhead,
  quantile,
  scaleBandwidth,
  standingBand,
  yAt,
} from '../src/distribution';

/** A seeded generator, so the simulations are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** ICLR's scale. */
const SCALE = [1, 3, 5, 6, 8, 10];

/**
 * A simulated venue: each submission has a latent quality (unimodal), and `k` reviewers each pick the scale's value
 * nearest a noisy reading of it. The means bunch on a lattice, but the field itself has one mode.
 */
function venue(n: number, ks: number[], seed: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const quality = 5 + 1.3 * normal(r);
    const k = ks[Math.floor(r() * ks.length)];
    let sum = 0;
    for (let j = 0; j < k; j += 1) {
      const x = quality + 1.5 * normal(r);
      sum += SCALE.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), SCALE[0]);
    }
    out.push(sum / k);
  }
  return out.sort((a, b) => a - b);
}

describe('the kernel, as acceptodds draws it', () => {
  it('is 6% of the scale wide', () => {
    expect(scaleBandwidth(1, 4)).toBeCloseTo(0.18, 10);
    expect(scaleBandwidth(1, 10)).toBeCloseTo(0.54, 10);
    expect(scaleBandwidth(5, 5)).toBe(1);
  });

  it('draws one bump for a simulated ICLR-sized venue, whose means bunch on a lattice', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const values = venue(10_000, [3, 4, 5], seed * 7919);
      expect(modes(density(values, { h: scaleBandwidth(1, 10), domain: [1, 10] }).ys), `seed=${seed}`).toBe(1);
    }
  });

  it('keeps a real second mode', () => {
    const r = rng(3);
    const values = Array.from({ length: 4000 }, (_, i) => (i % 2 ? 3 : 7.5) + 0.5 * normal(r)).sort((a, b) => a - b);
    expect(modes(density(values, { h: scaleBandwidth(1, 10) }).ys)).toBe(2);
  });
});

describe('the density', () => {
  it('integrates to about one, and adds up across subsets drawn with the same kernel', () => {
    const values = venue(2000, [4], 11);
    const d = density(values, { h: scaleBandwidth(1, 10) });
    const step = d.xs[1] - d.xs[0];
    expect(d.ys.reduce((a, y) => a + y * step, 0)).toBeCloseTo(1, 2);

    const low = values.filter((v) => v < 5);
    const high = values.filter((v) => v >= 5);
    const opts = { h: d.bandwidth, domain: d.domain };
    const a = density(low, opts);
    const b = density(high, opts);
    d.ys.forEach((y, i) => {
      expect((a.ys[i] * low.length + b.ys[i] * high.length) / values.length).toBeCloseTo(y, 10);
    });
  });

  it('scales linearly to a peak of one', () => {
    expect(peakScaled([0, 1, 4, 2])).toEqual([0, 0.25, 1, 0.5]);
    expect(peakScaled([0, 0])).toEqual([0, 0]);
  });

  it('reads the curve between its samples', () => {
    expect(yAt({ xs: [0, 1, 2], ys: [0, 1, 0] }, 0.5)).toBeCloseTo(0.5);
    expect(yAt({ xs: [0, 1, 2], ys: [0, 1, 0] }, 5)).toBe(0);
    expect(yAt({ xs: [0, 1, 2], ys: [0.2, 1, 0] }, -1)).toBe(0.2);
  });
});

describe('standings', () => {
  it('counts strictly below, so ties are not beaten', () => {
    const values = [1, 3, 3, 3, 5, 6];
    expect(countBelow(values, 3)).toBe(1);
    expect(countBelow(values, 3.01)).toBe(4);
    expect(countBelow(values, 0)).toBe(0);
    expect(countBelow(values, 11)).toBe(6);
  });

  it('rounds the share ahead down and says it as a band', () => {
    expect(percentAhead(0, 1)).toBeNull();
    expect(percentAhead(99, 101)).toBe(99);
    expect(percentAhead(1, 4)).toBe(33);
    expect(standingBand(88)).toBe('Top 12%');
    expect(standingBand(100)).toBe('Top 1%');
    expect(standingBand(0)).toBe('Bottom 1%');
    expect(standingBand(27)).toBe('Bottom 27%');
  });

  it('interpolates quantiles and picks round ticks', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    expect(niceTicks(1, 10, 5)).toEqual([2, 4, 6, 8, 10]);
    expect(niceTicks(1, 10, 4)).toEqual([5, 10]);
    expect(niceTicks(0.5, 4.5, 4)).toEqual([1, 2, 3, 4]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });
});
