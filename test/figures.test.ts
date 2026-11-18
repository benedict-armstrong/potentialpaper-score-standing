import { describe, expect, it } from 'vitest';
import { cached, memoryStore } from '../src/cache';
import { curveModel, curveReadout, histogramModel } from '../src/figures';

const bins = (counts: number[], lo = 1, hi = 10): PP.Bins => ({ lo, hi, width: (hi - lo) / counts.length, counts });

/** A small field: accepted high, rejected low, its bins as the site makes them (4 between 1 and 10). */
function field(): Pick<PP.ScoreField, 'values' | 'bins' | 'split' | 'min' | 'max'> {
  const accepted = [6, 6.5, 7, 8, 8];
  const rejected = [2, 3, 3.5, 4, 5, 5.5];
  const values = [...accepted, ...rejected].sort((a, b) => a - b);
  const binOf = (vs: number[]) => {
    const counts = [0, 0, 0, 0];
    for (const v of vs) counts[Math.min(3, Math.floor((v - 1) / 2.25))] += 1;
    return bins(counts);
  };
  const none = { count: 0, values: [], bins: bins([0, 0, 0, 0]) };
  return {
    values,
    bins: binOf(values),
    min: 1,
    max: 10,
    split: {
      accepted: { count: accepted.length, values: accepted, bins: binOf(accepted) },
      rejected: { count: rejected.length, values: rejected, bins: binOf(rejected) },
      withdrawn: none,
      pending: none,
    },
  };
}

describe('the histogram', () => {
  it("marks the paper's bin, and stacks the outcomes to the bin's total when split", () => {
    const f = field();
    const plain = histogramModel(f, false, 6.5);
    expect(plain.totals).toEqual([2, 3, 4, 2]);
    expect(plain.total).toBe(11);
    expect(plain.peak).toBe(4);
    expect(plain.mine).toBe(2);
    expect(plain.layers).toEqual([]);

    const split = histogramModel(f, true, null);
    expect(split.mine).toBeNull();
    expect(split.layers.map((l) => l.outcome)).toEqual(['accepted', 'rejected']);
    expect(split.layers[1].to).toEqual(split.totals);
    expect(split.layers[0].from).toEqual([0, 0, 0, 0]);
    expect(split.layers[1].from).toEqual(split.layers[0].to);
  });
});

describe('the curve', () => {
  it("spans the form's range, takes in the paper, and peaks at one", () => {
    const f = field();
    const m = curveModel(f, false, 6.5);
    expect(m.domain).toEqual([1, 10]);
    expect(Math.max(...m.ys)).toBeCloseTo(1, 10);
    expect(m.layers).toEqual([]);
    // Without a form's range, the means' extremes rounded out to whole scores: never past the scale's ends.
    const unranged = curveModel({ ...f, min: null, max: null }, false).domain;
    expect(unranged).toEqual([Math.floor(f.values[0]), Math.ceil(f.values[f.values.length - 1])]);
    expect(curveModel(f, false, 12).domain[1]).toBe(12);
  });

  it('divides its height by outcome, the shares summing to one, accepted rising with the score', () => {
    const f = field();
    const m = curveModel(f, true);
    const top = m.layers[m.layers.length - 1].to;
    top.forEach((y, i) => expect(y).toBeCloseTo(m.ys[i], 9));
    const acc = m.shares.accepted!;
    const rej = m.shares.rejected!;
    acc.forEach((a, i) => expect(a + rej[i]).toBeCloseTo(1, 9));
    expect(acc[0]).toBeLessThan(0.2);
    expect(acc[acc.length - 1]).toBeGreaterThan(0.8);

    expect(curveReadout(m, f.values, 5.2)).toMatchObject({ below: 5 });
    const low = curveReadout(m, f.values, 2).acceptRate!;
    const high = curveReadout(m, f.values, 8).acceptRate!;
    expect(low).toBeLessThan(high);
    expect(curveReadout(curveModel(f, false), f.values, 8).acceptRate).toBeNull();
  });
});

describe('the cache', () => {
  it('fetches a field once per computedAt, and again when the statistics change', async () => {
    const store = memoryStore<number[]>();
    let fetched = 0;
    const fetch = async () => {
      fetched += 1;
      return [1, 2, 3];
    };
    expect(await cached(store, 'k', 't1', fetch)).toEqual([1, 2, 3]);
    expect(await cached(store, 'k', 't1', fetch)).toEqual([1, 2, 3]);
    expect(fetched).toBe(1);
    await cached(store, 'k', 't2', fetch);
    expect(fetched).toBe(2);
  });

  it('keeps fifty fields, dropping the oldest', async () => {
    const store = memoryStore<number>();
    for (let i = 0; i < 51; i += 1) await cached(store, `k${i}`, 't', async () => i, i);
    expect(store.entries.size).toBe(50);
    expect(store.entries.has('k0')).toBe(false);
  });
});
