import { describe, expect, it } from 'vitest';
import {
  binIndex,
  binRange,
  chooseField,
  firstTab,
  paperMean,
  paperTabs,
  readSettings,
  scopeTabs,
  scoreOf,
  shareText,
  splitOn,
  standingOf,
  summaryText,
  markerLabel,
} from '../src/standing';

const note = (kind: PP.Note['kind'], content: PP.Note['content'], createdAt = '2026-01-01T00:00:00Z'): PP.Note => ({
  externalId: Math.random().toString(36),
  replyTo: null,
  kind,
  invitation: 'Official_Review',
  signature: 'Reviewer_x',
  content,
  license: 'CC BY 4.0',
  url: null,
  createdAt,
});

const submission = (
  venue: string,
  notes: PP.Note[],
  status: PP.Submission['status'] = null,
): PP.Submission => ({
  venue: { id: venue, name: venue, url: null, forms: {} },
  externalId: venue,
  number: 1,
  status,
  decision: null,
  url: null,
  fetchedAt: '2027-01-01T00:00:00Z',
  notes,
});

const summary = (venue: string, field: string, extra: Partial<PP.ScoreSummary> = {}): PP.ScoreSummary => ({
  venue: { id: venue, name: venue.toUpperCase() },
  field,
  label: field[0].toUpperCase() + field.slice(1),
  count: 10,
  min: 1,
  max: 10,
  byStatus: { accepted: 0, rejected: 0, withdrawn: 0, pending: 10 },
  decisionsOut: false,
  hidden: false,
  computedAt: '2027-01-01T00:00:00Z',
  ...extra,
});

const page = (identifier: string): PP.PageSummary => ({
  kind: 'venue',
  identifier,
  address: '/v/x',
  url: 'https://site/v/x',
  name: identifier,
});

describe('settings', () => {
  it('reads leniently: anything unexpected is the default', () => {
    expect(readSettings(undefined)).toEqual({ view: 'both', field: '', splitByDecision: 'auto' });
    expect(readSettings({ view: 'curve', field: ' soundness ', splitByDecision: 'off' })).toEqual({
      view: 'curve',
      field: 'soundness',
      splitByDecision: 'off',
    });
    expect(readSettings({ view: 'pie', field: 3, splitByDecision: true })).toEqual({
      view: 'both',
      field: '',
      splitByDecision: 'auto',
    });
  });

  it('splits once decisions are out on auto, always on on, never on off', () => {
    expect(splitOn('auto', false)).toBe(false);
    expect(splitOn('auto', true)).toBe(true);
    expect(splitOn('on', false)).toBe(true);
    expect(splitOn('off', true)).toBe(false);
  });

  it("takes the field the setting names if the venue has it, else the venue's first", () => {
    const fields = [summary('a', 'rating'), summary('a', 'soundness')];
    expect(chooseField(fields, '')?.field).toBe('rating');
    expect(chooseField(fields, 'soundness')?.field).toBe('soundness');
    expect(chooseField(fields, 'novelty')?.field).toBe('rating');
    expect(chooseField([], 'rating')).toBeNull();
  });
});

describe("a paper's mean", () => {
  it('reads scores as the site does: numbers, and text by its leading number', () => {
    expect(scoreOf(6)).toBe(6);
    expect(scoreOf('6: marginally above the acceptance threshold')).toBe(6);
    expect(scoreOf(' 2.5 ')).toBe(2.5);
    expect(scoreOf('marginally above')).toBeNull();
    expect(scoreOf('6 of 10')).toBeNull();
    expect(scoreOf(Number.NaN)).toBeNull();
    expect(scoreOf(['6'])).toBeNull();
  });

  it('averages over the reviews that score the field, and nothing else', () => {
    const s = submission('iclr', [
      note('review', { rating: '8: accept', soundness: 3 }),
      note('review', { rating: 5 }),
      note('review', { soundness: 2 }),
      note('meta_review', { rating: 1 }),
      note('comment', { rating: 1 }),
    ]);
    expect(paperMean(s, 'rating')).toEqual({ mean: 6.5, reviews: 2 });
    expect(paperMean(s, 'soundness')).toEqual({ mean: 2.5, reviews: 2 });
    expect(paperMean(s, 'novelty')).toBeNull();
  });
});

describe('bins', () => {
  const bins = { lo: 1, hi: 10, width: 0.45, counts: Array(20).fill(0) };
  it('finds the bin a mean falls in, the last closed at the top, outside at the nearest end', () => {
    expect(binIndex(bins, 1)).toBe(0);
    expect(binIndex(bins, 1.45)).toBe(1);
    expect(binIndex(bins, 10)).toBe(19);
    expect(binIndex(bins, 12)).toBe(19);
    expect(binIndex(bins, -3)).toBe(0);
    expect(binIndex({ lo: 5, width: 0, counts: [3] }, 5)).toBe(0);
    expect(binRange(bins, 2)).toBe('1.9–2.35');
  });

  it('says a sliver as "<1%" rather than 0%', () => {
    expect(shareText(1, 1000)).toBe('<1%');
    expect(shareText(0, 1000)).toBe('0%');
    expect(shareText(250, 1000)).toBe('25%');
    expect(shareText(1, 0)).toBe('0%');
  });
});

describe('standing and its words', () => {
  const values = [2, 3, 4, 5, 5, 6, 7, 8];
  it('counts the paper among the field even before the statistics include it', () => {
    expect(standingOf(values, { mean: 6, reviews: 4 })).toMatchObject({ below: 5, size: 8, ahead: 71, band: 'Top 29%' });
    expect(standingOf([], { mean: 6, reviews: 4 })).toMatchObject({ below: 0, size: 1, ahead: null, band: null });
    expect(markerLabel(standingOf(values, { mean: 6, reviews: 4 }))).toBe('This paper, Top 29%');
  });

  it('summarises the figure for a screen reader, with the accept rate when split', () => {
    const field = {
      label: 'Rating',
      venue: { id: 'iclr', name: 'ICLR 2027' },
      values,
      split: {
        accepted: { count: 3, values: [6, 7, 8], bins: { lo: 0, hi: 0, width: 0, counts: [] } },
        rejected: { count: 4, values: [2, 3, 4, 5], bins: { lo: 0, hi: 0, width: 0, counts: [] } },
        withdrawn: { count: 1, values: [5], bins: { lo: 0, hi: 0, width: 0, counts: [] } },
        pending: { count: 0, values: [], bins: { lo: 0, hi: 0, width: 0, counts: [] } },
      },
    };
    const text = summaryText({ field, standing: standingOf(values, { mean: 6, reviews: 4 }), split: true });
    expect(text).toBe(
      "Rating at ICLR 2027: 8 submissions, median 5. This paper's mean is 6 over 4 reviews, above 5 of 8 submissions (Top 29%). 3 accepted, 4 rejected, 1 withdrawn; 43% of decided submissions accepted.",
    );
    expect(summaryText({ field, standing: null, split: false })).toBe('Rating at ICLR 2027: 8 submissions, median 5.');
  });
});

describe('tabs', () => {
  const list = (identifier: string, scores: PP.ScoreSummary[]): PP.ScoreList => ({
    page: page(identifier),
    hideUntil: 'never',
    scores,
  });

  it("make one tab per venue of a scope's statistics, its fields in order", () => {
    const tabs = scopeTabs(
      list('venue:iclr', [summary('iclr2027', 'rating'), summary('iclr2027', 'soundness'), summary('iclr2026', 'rating')]),
    );
    expect(tabs.map((t) => [t.venue.id, t.scope, t.fields.map((f) => f.field)])).toEqual([
      ['iclr2027', 'venue:iclr', ['rating', 'soundness']],
      ['iclr2026', 'venue:iclr', ['rating']],
    ]);
    expect(firstTab(tabs)).toBe(0);
  });

  it("make one tab per submission at a venue with statistics, oldest first, opening on the accepted one", () => {
    const submissions = [
      submission('iclr', [note('review', { rating: 8 }, '2027-11-01T00:00:00Z')], 'accepted'),
      submission('neurips', [note('review', { rating: 4 }, '2027-06-01T00:00:00Z')], 'rejected'),
      submission('tmlr', [note('review', { rating: 4 }, '2028-01-01T00:00:00Z')], null),
    ];
    const tabs = paperTabs(submissions, [
      list('venue:iclr/2027', [summary('iclr', 'rating')]),
      list('venue:neurips/2027', [summary('neurips', 'rating')]),
    ]);
    expect(tabs.map((t) => [t.venue.id, t.scope, t.submission?.status])).toEqual([
      ['neurips', 'venue:neurips/2027', 'rejected'],
      ['iclr', 'venue:iclr/2027', 'accepted'],
    ]);
    expect(firstTab(tabs)).toBe(1);
    expect(firstTab(tabs.slice(0, 1))).toBe(0);
    expect(firstTab([])).toBe(0);
  });
});
