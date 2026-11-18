// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The panel end to end in a DOM, against a fake `pp` that answers as the site's host does (`scope.scores`,
 * `reviews.forPaper`, settings): which calls it makes on a paper and a venue, what it draws, what a screen reader
 * gets, and that a field already fetched at the same `computedAt` is not fetched again.
 */

const bins = (counts: number[]): PP.Bins => ({ lo: 1, hi: 10, width: 9 / counts.length, counts });
const page = (kind: PP.PageKind, identifier: string, name = identifier): PP.PageSummary => ({
  kind,
  identifier,
  address: `/${identifier}`,
  url: `https://site/${identifier}`,
  name,
});

function summary(
  venue: { id: string; name: string; page?: PP.PageSummary | null },
  field: string,
  extra: Partial<PP.ScoreSummary> = {},
): PP.ScoreSummary {
  return {
    venue: { page: null, ...venue },
    field,
    label: field[0].toUpperCase() + field.slice(1),
    count: 8,
    min: 1,
    max: 10,
    byStatus: { accepted: 3, rejected: 5, withdrawn: 0, pending: 0 },
    decisionsOut: true,
    hidden: false,
    computedAt: '2027-05-01T00:00:00.000Z',
    ...extra,
  };
}

function scoreField(s: PP.ScoreSummary, scope: PP.PageSummary): PP.ScoreField {
  const accepted = [6, 6.5, 8];
  const rejected = [2, 3, 4, 4.5, 5];
  const none = { count: 0, values: [], bins: bins([0, 0, 0]) };
  return {
    ...s,
    page: scope,
    values: [...accepted, ...rejected].sort((a, b) => a - b),
    bins: bins([2, 3, 3]),
    split: {
      accepted: { count: 3, values: accepted, bins: bins([0, 0, 3]) },
      rejected: { count: 5, values: rejected, bins: bins([2, 3, 0]) },
      withdrawn: none,
      pending: none,
    },
  };
}

const review = (content: PP.Note['content'], createdAt: string): PP.Note => ({
  externalId: createdAt,
  replyTo: null,
  kind: 'review',
  invitation: 'Official_Review',
  signature: 'Reviewer_a',
  content,
  license: 'CC BY 4.0',
  url: null,
  createdAt,
});

const ICLR = { id: 'openreview:ICLR.cc/2027/Conference', name: 'ICLR 2027' };
const NEURIPS = { id: 'openreview:NeurIPS.cc/2026/Conference', name: 'NeurIPS 2026' };
const ICLR_PAGE = page('venue', 'venue:iclr/2027', 'ICLR 2027');
const NEURIPS_PAGE = page('venue', 'venue:neurips/2026', 'NeurIPS 2026');

interface Fake {
  calls: { method: string; args: unknown[] }[];
  settings: Record<string, unknown>;
  emit(event: string, params: unknown): void;
}

function fakePp(context: Partial<PP.Context>, answers: {
  lists: Record<string, PP.ScoreList>;
  submissions?: PP.Submission[];
  /** `marks` by scope, for `{ marks: true }`. */
  marks?: Record<string, PP.ScoreMark[] | null>;
  /** Values by scope, in place of the default field's. */
  values?: Record<string, number[]>;
}): Fake {
  const listeners = new Map<string, ((p: unknown) => void)[]>();
  const fake: Fake = {
    calls: [],
    settings: { view: 'both', field: '', splitByDecision: 'auto' },
    emit: (event, params) => (listeners.get(event) ?? []).forEach((l) => l(params)),
  };
  const ctx = {
    plugin: { id: 'benedict-armstrong/score-standing', name: 'Score standing', version: '0.1.0', sha: null, dev: true },
    surface: { type: 'panel', panel: 'standing', slot: 'venue.main' },
    page: null,
    scopes: [],
    viewer: { signedIn: true, isOwner: false },
    theme: { mode: 'light', tokens: {} },
    settings: fake.settings,
    site: 'https://site',
    methods: [],
    ...context,
  } as PP.Context;
  const on = (event: string, listener: (p: unknown) => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    return () => {};
  };
  const pp = {
    apiVersion: 1,
    ready: Promise.resolve(ctx),
    context: ctx,
    on,
    settings: {
      get: async () => fake.settings,
      set: async (name: string, value: unknown) => {
        fake.calls.push({ method: 'settings.set', args: [name, value] });
        fake.settings = { ...fake.settings, [name]: value };
      },
      onChange: (listener: (s: Record<string, unknown>) => void) => on('settings.change', listener as never),
    },
    reviews: {
      forPaper: async () => {
        fake.calls.push({ method: 'reviews.forPaper', args: [] });
        return { submissions: answers.submissions ?? [] };
      },
    },
    scope: {
      scores: async (identifier?: string, venue?: string, field?: string, options?: { marks?: boolean }) => {
        fake.calls.push({
          method: 'scope.scores',
          args: [identifier, venue, field, options].filter((a) => a !== undefined),
        });
        const scope = identifier ?? ctx.page!.identifier;
        const list = answers.lists[scope];
        if (!list) throw Object.assign(new Error('not a scope'), { code: 'Unavailable' });
        if (!venue) return list;
        if (!field) return { ...list, scores: list.scores.filter((x) => x.venue.id === venue) };
        const s = list.scores.find((x) => x.venue.id === venue && x.field === field)!;
        const out = scoreField(s, list.page);
        if (answers.values?.[scope]) out.values = answers.values[scope];
        if (options?.marks) out.marks = answers.marks && scope in answers.marks ? answers.marks[scope] : [];
        return out;
      },
    },
    ui: {
      openUrl: async (url: string) => {
        fake.calls.push({ method: 'ui.openUrl', args: [url] });
      },
    },
  };
  (globalThis as unknown as { pp: unknown }).pp = pp;
  return fake;
}

/** The bar chart / distribution switch's button with this label. */
function viewButton(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('.switch button')].find((b) => b.textContent === label)!;
}

async function boot() {
  vi.resetModules();
  await import('../src/main');
  await vi.waitFor(() => {
    if (document.querySelector('.note')?.textContent === 'Loading…') throw new Error('still loading');
  });
}

const fieldCalls = (fake: Fake) => fake.calls.filter((c) => c.method === 'scope.scores' && c.args.length >= 3);

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
});
afterEach(() => {
  delete (globalThis as { pp?: unknown }).pp;
});

describe('on a paper', () => {
  const submissions: PP.Submission[] = [
    {
      venue: { ...ICLR, url: null, forms: {} },
      externalId: 'a',
      number: 1,
      status: 'accepted',
      decision: 'Accept (poster)',
      url: null,
      fetchedAt: '2027-06-01T00:00:00Z',
      notes: [review({ rating: '6: marginally above', soundness: 3 }, '2026-11-01T00:00:00Z'), review({ rating: 7, soundness: 2 }, '2026-11-02T00:00:00Z')],
    },
    {
      venue: { ...NEURIPS, url: null, forms: {} },
      externalId: 'b',
      number: 2,
      status: 'rejected',
      decision: 'Reject',
      url: null,
      fetchedAt: '2027-06-01T00:00:00Z',
      notes: [review({ rating: 3 }, '2026-07-01T00:00:00Z')],
    },
  ];
  const lists = {
    [ICLR_PAGE.identifier]: {
      page: ICLR_PAGE,
      hideUntil: 'never' as const,
      scores: [summary(ICLR, 'rating'), summary(ICLR, 'soundness')],
    },
    [NEURIPS_PAGE.identifier]: { page: NEURIPS_PAGE, hideUntil: 'never' as const, scores: [summary(NEURIPS, 'rating')] },
  };

  it("shows its standing at each venue it went to, opening on the one that accepted it, split once decisions are out", async () => {
    const fake = fakePp(
      { page: page('paper', 'arxiv:2701.00001'), scopes: [NEURIPS_PAGE, ICLR_PAGE, page('topic', 'topic:x')] },
      { lists, submissions },
    );
    await boot();

    // The paper's reviews, and the statistics of its venue pages only (not the topic).
    expect(fake.calls.map((c) => [c.method, ...c.args])).toEqual(
      expect.arrayContaining([
        ['reviews.forPaper'],
        ['scope.scores', 'venue:neurips/2026'],
        ['scope.scores', 'venue:iclr/2027'],
        ['scope.scores', 'venue:iclr/2027', ICLR.id, 'rating'],
      ]),
    );
    expect(fake.calls.some((c) => c.args[0] === 'topic:x')).toBe(false);

    const tabs = [...document.querySelectorAll('[role=tab]')];
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([
      ['NeurIPS 2026', 'false'],
      ['ICLR 2027', 'true'],
    ]);
    // Mean 6.5 over two reviews: 2, 3, 4, 4.5, 5 and 6 are below it, of 8.
    expect(document.querySelector('.caption')!.textContent).toBe('6.5 mean over 2 reviews, above 6 of 8 · Top 15%');
    // One figure at a time: the bar chart, and the distribution behind the switch.
    const figures = [...document.querySelectorAll('svg[role=img]')];
    expect(figures.map((f) => f.getAttribute('aria-label'))).toEqual([
      'Histogram of rating means at ICLR 2027; This paper, Top 15%',
    ]);
    const describedBy = figures[0].getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)!.textContent).toContain('3 accepted, 5 rejected; 38% of decided submissions accepted.');
    viewButton('Distribution').click();
    expect([...document.querySelectorAll('svg[role=img]')].map((f) => f.getAttribute('aria-label'))).toEqual([
      'Curve of rating means at ICLR 2027; This paper, Top 15%',
    ]);
    expect(viewButton('Distribution').getAttribute('aria-pressed')).toBe('true');
    expect(fake.calls.some((c) => c.method === 'settings.set' && c.args[0] === 'view' && c.args[1] === 'curve')).toBe(true);
    expect(document.querySelectorAll('path.layer.o-accepted').length).toBe(1);
    expect(document.querySelector('.legend')!.textContent).toContain('Accepted 3');

    // The other venue: its own figure, with its own mean.
    (tabs[0] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.caption')?.textContent).toMatch(/^3 mean over 1 review,/));
  });

  it('under one submission, draws that venue alone, without tabs', async () => {
    const under = (venue: { id: string; name: string }) =>
      ({ type: 'panel', panel: 'standing', slot: 'paper.submission', submission: { venue } }) as PP.Context['surface'];
    fakePp(
      { page: page('paper', 'arxiv:2701.00001'), scopes: [NEURIPS_PAGE, ICLR_PAGE], surface: under(NEURIPS) },
      { lists, submissions },
    );
    await boot();
    expect(document.querySelectorAll('[role=tab]').length).toBe(0);
    expect(document.querySelector('.caption')!.textContent).toMatch(/^3 mean over 1 review,/);
    expect(document.querySelector('svg[role=img]')!.getAttribute('aria-label')).toContain('at NeurIPS 2026');
  });

  it('under a submission whose venue has no statistics, says so by name', async () => {
    fakePp(
      {
        page: page('paper', 'arxiv:2701.00001'),
        scopes: [ICLR_PAGE],
        surface: { type: 'panel', panel: 'standing', slot: 'paper.submission', submission: { venue: { id: 'openreview:TMLR', name: 'TMLR' } } },
      },
      { lists, submissions },
    );
    await boot();
    expect(document.querySelector('.note')!.textContent).toBe('No score statistics for TMLR yet.');
  });

  it('switches the field and keeps it as the setting; a field fetched once is not fetched again', async () => {
    const fake = fakePp({ page: page('paper', 'arxiv:2701.00001'), scopes: [ICLR_PAGE] }, { lists, submissions });
    await boot();
    expect(fieldCalls(fake).length).toBe(1);
    const select = document.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Rating', 'Soundness']);
    select.value = 'soundness';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('.caption')?.textContent).toMatch(/^2.5 mean over 2 reviews/));
    expect(fake.calls).toContainEqual({ method: 'settings.set', args: ['field', 'soundness'] });

    // Back to rating: from the cache.
    fake.emit('settings.change', { ...fake.settings, field: 'rating' });
    await vi.waitFor(() => expect(document.querySelector('.caption')?.textContent).toMatch(/^6.5 mean/));
    expect(fieldCalls(fake).map((c) => c.args[2])).toEqual(['rating', 'soundness']);
  });

  it('draws one figure as the view setting says, and no split when told not to', async () => {
    const fake = fakePp({ page: page('paper', 'arxiv:2701.00001'), scopes: [ICLR_PAGE] }, { lists, submissions });
    fake.settings.view = 'curve';
    fake.settings.splitByDecision = 'off';
    // The context's settings object is the fake's at boot.
    (globalThis as unknown as { pp: { context: PP.Context } }).pp.context.settings = fake.settings;
    await boot();
    const figures = [...document.querySelectorAll('svg[role=img]')];
    expect(figures.map((f) => f.getAttribute('aria-label')?.split(' ')[0])).toEqual(['Curve']);
    expect(document.querySelector('.legend')).toBeNull();
    expect(document.querySelector('path.area')).not.toBeNull();
  });
});

describe('on a venue', () => {
  it('shows the whole distribution, a tab per venue on a series, with no paper marked', async () => {
    const series = page('venue', 'venue:iclr', 'ICLR');
    const older = { id: 'openreview:ICLR.cc/2026/Conference', name: 'ICLR 2026' };
    const fake = fakePp(
      { page: series },
      {
        lists: {
          'venue:iclr': { page: series, hideUntil: 'never', scores: [summary(ICLR, 'rating'), summary(older, 'rating')] },
        },
      },
    );
    await boot();
    expect(fake.calls.some((c) => c.method === 'reviews.forPaper')).toBe(false);
    expect([...document.querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual(['ICLR 2027', 'ICLR 2026']);
    expect(document.querySelector('.caption')!.textContent).toBe('8 submissions at ICLR 2027');
    expect(document.querySelector('.you')).toBeNull();
    expect(document.querySelector('svg[role=img]')!.getAttribute('aria-label')).toBe('Histogram of rating means at ICLR 2027');
  });

  it("says so when the site holds the statistics back until decisions, and fetches nothing", async () => {
    const fake = fakePp(
      { page: ICLR_PAGE },
      {
        lists: {
          [ICLR_PAGE.identifier]: {
            page: ICLR_PAGE,
            hideUntil: 'decisions',
            scores: [summary(ICLR, 'rating', { hidden: true, decisionsOut: false })],
          },
        },
      },
    );
    await boot();
    expect(document.querySelector('.note')!.textContent).toMatch(/once the venue's decisions are out/);
    expect(fieldCalls(fake)).toEqual([]);
  });
});

describe('on an organisation', () => {
  const org = page('org', 'org:eth', 'ETH Zurich');
  const iclr = { ...ICLR, page: ICLR_PAGE };
  const marks: PP.ScoreMark[] = [
    { identifier: 'arxiv:2701.00001', address: '/abs/2701.00001', title: 'Attention again', mean: 3, outcome: 'rejected' },
    { identifier: 'arxiv:2701.00002', address: '/abs/2701.00002', title: 'Linear everything', mean: 6.5, outcome: 'accepted' },
  ];
  const lists = (orgScores: PP.ScoreSummary[]) => ({
    'org:eth': { page: org, hideUntil: 'never' as const, scores: orgScores },
    [ICLR_PAGE.identifier]: {
      page: ICLR_PAGE,
      hideUntil: 'never' as const,
      scores: [summary(iclr, 'rating', { computedAt: '2027-05-02T00:00:00.000Z' }), summary(iclr, 'soundness')],
    },
  });

  it("draws the venue's whole distribution from its own page, with the organisation's papers as named open circles", async () => {
    const fake = fakePp(
      { page: org },
      { lists: lists([summary(iclr, 'rating', { count: 2 })]), marks: { 'org:eth': marks }, values: { 'org:eth': [3, 6.5] } },
    );
    await boot();

    // The org's list, the venue page's list for that venue, the venue's field, and the org's own by name.
    expect(fake.calls.filter((c) => c.method === 'scope.scores').map((c) => c.args)).toEqual([
      [],
      ['venue:iclr/2027', ICLR.id],
      ['venue:iclr/2027', ICLR.id, 'rating'],
      ['org:eth', ICLR.id, 'rating', { marks: true }],
    ]);
    expect(document.querySelector('.caption')!.textContent).toBe("2 of ETH Zurich's submissions among 8 at ICLR 2027");
    const hist = document.querySelector('svg[role=img]')!;
    viewButton('Distribution').click();
    const curve = document.querySelector('svg[role=img]')!;
    expect(curve.getAttribute('aria-label')).toBe(
      "Curve of rating means at ICLR 2027; ETH Zurich's 2 submissions marked",
    );
    // One open circle per paper on the curve; on the histogram, one per bar that holds some.
    expect(curve.querySelectorAll('circle.mark').length).toBe(2);
    expect(hist.querySelectorAll('circle.mark').length).toBe(2);
    expect(document.querySelector('.you')).toBeNull();
    const said = document.getElementById(curve.getAttribute('aria-describedby')!)!.textContent!;
    expect(said).toContain('Rating at ICLR 2027: 8 submissions');
    expect(said).toContain("2 of ETH Zurich's submissions are marked");
    expect(said).toContain('Linear everything · 6.5, Top 15%, accepted');

    // The arrow keys step from one marked paper to the next and name it; Enter opens it.
    curve.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const tip = curve.parentElement!.querySelector('.tip')!;
    expect(tip.textContent).toContain('Attention again · 3');
    curve.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(tip.textContent).toContain('Linear everything · 6.5, Top 15%, accepted');
    expect(curve.querySelectorAll('circle.mark.on').length).toBe(1);
    curve.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fake.calls).toContainEqual({ method: 'ui.openUrl', args: ['https://site/abs/2701.00002'] });

    // On the histogram, up and down move between the bars that hold its papers.
    hist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(hist.parentElement!.querySelector('.tip')!.textContent).toContain('Attention again');
  });

  it("falls back to the organisation's own numbers for a venue with no page, and says when there are too many to name", async () => {
    const fake = fakePp(
      { page: org },
      { lists: { 'org:eth': { page: org, hideUntil: 'never', scores: [summary(ICLR, 'rating')] } }, marks: { 'org:eth': null } },
    );
    await boot();
    expect(fake.calls.filter((c) => c.method === 'scope.scores').map((c) => c.args)).toEqual([
      [],
      ['org:eth', ICLR.id, 'rating'],
      ['org:eth', ICLR.id, 'rating', { marks: true }],
    ]);
    expect(document.querySelector('.note')!.textContent).toMatch(/more submissions here than can be named/);
    expect(document.querySelectorAll('circle.mark').length).toBe(0);
  });

  it("holds back when the site withholds the venue's numbers", async () => {
    const fake = fakePp(
      { page: org },
      {
        lists: {
          'org:eth': { page: org, hideUntil: 'decisions', scores: [summary(iclr, 'rating')] },
          [ICLR_PAGE.identifier]: {
            page: ICLR_PAGE,
            hideUntil: 'decisions',
            scores: [summary(iclr, 'rating', { hidden: true, decisionsOut: false })],
          },
        },
      },
    );
    await boot();
    expect(document.querySelector('.note')!.textContent).toMatch(/once the venue's decisions are out/);
    expect(fieldCalls(fake)).toEqual([]);
  });
});
