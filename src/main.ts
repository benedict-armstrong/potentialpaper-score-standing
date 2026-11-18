/// <reference path="./pp.d.ts" />
/**
 * Score standing, a PotentialPaper plugin. One figure, shown differently on each kind of page:
 *
 * - on a paper (under each of its submissions, `paper.submission`): the paper's standing at that submission's venue;
 * - on a venue (the main column): the whole distribution, split by decision once decisions are out, a tab per
 *   venue on a series;
 * - on an organisation: each venue's whole distribution (from the venue's own page), with the organisation's
 *   submissions as open circles on it, named on hover (acceptodds' `marks`); a tab per venue.
 *
 * Data comes from the site's score statistics only (`pp.scope.scores`, with `marks` for the organisation's papers by
 * name), plus the paper's own reviews for its mean.
 */
import './style.css';
import { cached, defaultStore } from './cache';
import { curve, histogram } from './render';
import {
  chooseField,
  count,
  firstTab,
  markerLabel,
  marksSummaryText,
  orgTabs,
  placeMarks,
  type PlacedMark,
  OUTCOME_LABELS,
  OUTCOMES,
  type Outcome,
  outcomeCounts,
  paperMean,
  paperTabs,
  readSettings,
  scopeTabs,
  scoreText,
  shareText,
  splitOn,
  standingOf,
  summaryText,
  type Settings,
  type VenueTab,
} from './standing';

const app = document.getElementById('app')!;
/** The figures stop growing here, so a wide column doesn't stretch them; the text around them still runs full width. */
const MAX_FIGURE_WIDTH = 720;
const store = defaultStore<PP.ScoreField>();

let settings: Settings = readSettings(null);
let tabs: VenueTab[] = [];
let tabIndex = 0;
/** The field picked in this frame, ahead of the setting's round trip. */
let pickedField: string | null = null;
let current: {
  tab: VenueTab;
  summary: PP.ScoreSummary;
  field: PP.ScoreField | null;
  /** On an organisation: its submissions in this field (`null`: too many to name). */
  marks?: PP.ScoreMark[] | null;
} | null = null;
let loadToken = 0;
/** The venue pages' lists asked for in this load, by `<page>\n<venue>`: small, and asked once per page. */
let venueLists = new Map<string, Promise<PP.ScoreList>>();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function message(text: string) {
  app.replaceChildren(el('p', { className: 'note' }, text));
}

/** The paper's venue pages' statistics, matched to its submissions; or the scope's own. */
async function loadTabs(ctx: PP.Context): Promise<VenueTab[]> {
  if (!ctx.page) return [];
  if (ctx.page.kind === 'paper') {
    const venues = ctx.scopes.filter((s) => s.kind === 'venue');
    const [{ submissions }, lists] = await Promise.all([
      pp.reviews.forPaper(),
      Promise.all(venues.map((v) => pp.scope.scores(v.identifier).catch(() => null))),
    ]);
    const all = paperTabs(
      submissions,
      lists.filter((l): l is PP.ScoreList => l !== null),
    );
    // Under one submission (`paper.submission`): that venue's figure only. In another slot, a tab per venue.
    const under = ctx.surface.type === 'panel' ? ctx.surface.submission : undefined;
    return under ? all.filter((t) => t.venue.id === under.venue.id) : all;
  }
  if (ctx.page.kind === 'org') return orgTabs(await pp.scope.scores());
  return scopeTabs(await pp.scope.scores());
}

async function loadField(scope: string, summary: PP.ScoreSummary, marks = false): Promise<PP.ScoreField> {
  const key = `${marks ? 'marks\n' : ''}${scope}\n${summary.venue.id}\n${summary.field}`;
  return cached(store, key, summary.computedAt, () =>
    pp.scope.scores(scope, summary.venue.id, summary.field, marks ? { marks: true } : undefined),
  );
}

/**
 * The summary of the field the distribution is drawn from: the tab's own, or on an organisation the venue page's
 * (whose `computedAt` and `hidden` are the whole venue's). `null` when the venue's page has no such field.
 */
async function distributionSummary(tab: VenueTab, summary: PP.ScoreSummary): Promise<PP.ScoreSummary | null> {
  if (!tab.marks || tab.scope === tab.marks.scope) return summary;
  const key = `${tab.scope}\n${tab.venue.id}`;
  let list = venueLists.get(key);
  if (!list) {
    list = pp.scope.scores(tab.scope, tab.venue.id);
    venueLists.set(key, list);
    list.catch(() => venueLists.delete(key));
  }
  return (await list).scores.find((s) => s.venue.id === tab.venue.id && s.field === summary.field) ?? null;
}

/** Pick the tab's field and fetch it (from the cache when it hasn't changed), then draw. */
async function show() {
  const token = ++loadToken;
  const tab = tabs[tabIndex];
  if (!tab) {
    const under = pp.context?.surface.type === 'panel' ? pp.context.surface.submission : undefined;
    return message(under ? `No score statistics for ${under.venue.name} yet.` : 'No score statistics here yet.');
  }
  const summary = chooseField(tab.fields, pickedField ?? settings.field);
  if (!summary) return message(`No score statistics for ${tab.venue.name} yet.`);
  current = { tab, summary, field: null };
  if (summary.hidden) return draw();
  draw(true);
  try {
    if (tab.marks) {
      // The venue's whole field, and the organisation's submissions in it by name.
      const whole = await distributionSummary(tab, summary);
      if (token !== loadToken) return;
      const scope = whole ? tab.scope : tab.marks.scope;
      const shown = whole ?? summary;
      if (shown.hidden) {
        current = { tab, summary: shown, field: null };
        return draw();
      }
      const [field, own] = await Promise.all([
        loadField(scope, shown),
        loadField(tab.marks.scope, summary, true),
      ]);
      if (token !== loadToken) return;
      current = { tab, summary, field, marks: own.marks ?? null };
      return draw();
    }
    const field = await loadField(tab.scope, summary);
    if (token !== loadToken) return;
    current = { tab, summary, field };
    draw();
  } catch (e) {
    if (token !== loadToken) return;
    message(`Couldn't load the scores: ${(e as Error).message}`);
  }
}

const VIEWS: { view: Settings['view']; label: string }[] = [
  { view: 'histogram', label: 'Bar chart' },
  { view: 'curve', label: 'Distribution' },
];

/** Bar chart or distribution: one figure at a time, the choice kept as the plugin's `view` setting. */
function viewSwitch(): HTMLElement {
  const group = el('div', { className: 'switch' });
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Figure');
  for (const v of VIEWS) {
    const button = el('button', { type: 'button', textContent: v.label });
    button.setAttribute('aria-pressed', String(settings.view === v.view));
    button.addEventListener('click', () => {
      if (settings.view === v.view) return;
      settings = { ...settings, view: v.view };
      draw();
      pp.settings.set('view', v.view).catch(() => {});
    });
    group.append(button);
  }
  return group;
}

/** The venue tabs, when there is more than one venue. */
function venueTabs(): HTMLElement | null {
  if (tabs.length <= 1) return null;
  const bar = el('div', { className: 'controls' });
  const list = el('div', { className: 'tabs' });
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Venue');
  tabs.forEach((t, i) => {
    const button = el('button', { type: 'button', className: 'tab', textContent: t.venue.name });
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(i === tabIndex));
    if (t.submission?.status) button.title = `${t.venue.name}: ${t.submission.decision ?? t.submission.status.replace('_', ' ')}`;
    button.addEventListener('click', () => {
      tabIndex = i;
      void show();
    });
    list.append(button);
  });
  bar.append(list);
  return bar;
}

/** The score picker (or the score's name, when there is only one), drawn at the right of the first line. */
function fieldPicker(tab: VenueTab, summary: PP.ScoreSummary): HTMLElement {
  const bar = el('div', { className: 'picker' });
  bar.append(viewSwitch());
  if (tab.fields.length > 1) {
    const select = el('select', { id: 'field' });
    for (const f of tab.fields) select.append(el('option', { value: f.field, textContent: f.label, selected: f.field === summary.field }));
    select.addEventListener('change', () => {
      pickedField = select.value;
      void show();
      // The setting follows, so the next page opens on the same field; signed out it stays in this frame.
      pp.settings.set('field', select.value).catch(() => {});
    });
    bar.append(el('label', { className: 'field', htmlFor: 'field' }, 'Score '), select);
  } else {
    bar.append(el('span', { className: 'field' }, summary.label));
  }
  return bar;
}

let summaryId = 0;

function draw(loading = false) {
  if (!current) return;
  const { tab, summary, field, marks } = current;
  const top = venueTabs();
  const parts: Node[] = top ? [top] : [];
  const picker = fieldPicker(tab, summary);
  // The first line under the tabs, with the picker at its right.
  const done = () => {
    const first = top ? 1 : 0;
    const line = parts[first];
    parts[first] = line ? el('div', { className: 'head' }, line, picker) : picker;
    app.replaceChildren(...parts);
  };
  if (summary.hidden) {
    parts.push(
      el(
        'p',
        { className: 'note' },
        `${count(summary.count)} submissions at ${tab.venue.name} have a ${summary.label.toLowerCase()}. The site shows how they stand once the venue's decisions are out.`,
      ),
    );
    done();
    return;
  }
  if (!field || loading) {
    parts.push(el('p', { className: 'note' }, 'Loading…'));
    done();
    return;
  }
  const split = splitOn(settings.splitByDecision, field.decisionsOut);
  const mean = tab.submission ? paperMean(tab.submission, field.field) : null;
  const standing = mean ? standingOf(field.values, mean) : null;
  const label = standing ? markerLabel(standing) : null;
  const width = Math.min(MAX_FIGURE_WIDTH, Math.max(220, Math.floor(app.clientWidth || document.body.clientWidth || 300)));
  const describedBy = `summary-${++summaryId}`;
  const placed: PlacedMark[] | null = tab.marks && marks ? placeMarks(field.values, marks) : null;
  const options = {
    field,
    split,
    standing,
    label,
    width,
    describedBy,
    marks: tab.marks && placed ? { name: tab.marks.name, list: placed } : null,
    open: (mark: PlacedMark) => {
      if (mark.address) pp.ui.openUrl(new URL(mark.address, pp.context?.site ?? location.origin).toString()).catch(() => {});
    },
  };

  if (standing) {
    parts.push(
      el(
        'p',
        { className: 'caption' },
        el('strong', {}, scoreText(standing.mean)),
        ` mean over ${standing.reviews} review${standing.reviews === 1 ? '' : 's'}, above ${count(standing.below)} of ${count(standing.size)}`,
        standing.band ? ` · ${standing.band}` : '',
      ),
    );
  } else if (tab.submission) {
    parts.push(el('p', { className: 'caption' }, `This paper's reviews give no ${field.label.toLowerCase()}.`));
  } else if (tab.marks && placed) {
    parts.push(
      el(
        'p',
        { className: 'caption' },
        el('span', { className: 'mark-key' }),
        `${count(placed.length)} of ${tab.marks.name}'s submission${placed.length === 1 ? '' : 's'} among ${count(field.values.length)} at ${field.venue.name}`,
      ),
    );
  } else if (tab.marks) {
    parts.push(el('p', { className: 'caption' }, `${count(field.values.length)} submissions at ${field.venue.name}`));
    parts.push(
      el('p', { className: 'note' }, `${tab.marks.name} has more submissions here than can be named one by one (over 1,000).`),
    );
  } else {
    parts.push(el('p', { className: 'caption' }, `${count(field.values.length)} submissions at ${field.venue.name}`));
  }
  if (field.values.length === 0) {
    parts.push(el('p', { className: 'note' }, 'No submission has this score yet.'));
  } else {
    parts.push(settings.view === 'curve' ? curve(options) : histogram(options));
  }
  if (split) {
    const counts = outcomeCounts(field);
    const decided = (field.split.accepted?.count ?? 0) + (field.split.rejected?.count ?? 0);
    const legend = el('ul', { className: 'legend' });
    for (const o of counts) {
      const item = el('li', {}, el('span', { className: `swatch o-${o.outcome}` }), `${OUTCOME_LABELS[o.outcome]} ${count(o.count)}`);
      item.dataset.outcome = o.outcome;
      item.tabIndex = 0;
      const on = () => highlight(o.outcome);
      const off = () => highlight(null);
      item.addEventListener('mouseenter', on);
      item.addEventListener('mouseleave', off);
      item.addEventListener('focus', on);
      item.addEventListener('blur', off);
      legend.append(item);
    }
    if (decided) legend.append(el('li', { className: 'muted' }, `${shareText(field.split.accepted?.count ?? 0, decided)} accepted`));
    parts.push(legend);
  }
  const said = summaryText({ field, standing, split });
  const marked = tab.marks && placed ? ` ${marksSummaryText(tab.marks.name, placed, field.values)}` : '';
  parts.push(el('p', { className: 'sr-only', id: describedBy }, said + marked));
  done();
}

/** Fade every outcome but `outcome` in the figures and the legend; `null` shows them all again. */
function highlight(outcome: Outcome | null) {
  for (const node of app.querySelectorAll<Element>('svg [class*="o-"], .legend li[data-outcome]')) {
    const own =
      node instanceof HTMLElement ? node.dataset.outcome : OUTCOMES.find((o) => node.classList.contains(`o-${o}`));
    node.classList.toggle('faded', outcome !== null && own !== undefined && own !== outcome);
  }
}

async function load(ctx: PP.Context) {
  message('Loading…');
  venueLists = new Map();
  try {
    tabs = await loadTabs(ctx);
    tabIndex = Math.min(firstTab(tabs), Math.max(0, tabs.length - 1));
    await show();
  } catch (e) {
    message(`Couldn't load the scores: ${(e as Error).message}`);
  }
}

pp.ready.then((ctx) => {
  settings = readSettings(ctx.settings);
  pp.settings.onChange((next) => {
    settings = readSettings(next);
    pickedField = null;
    void show();
  });
  pp.on('context.change', () => {
    pickedField = null;
    void load(pp.context!);
  });
  // Redraw at the frame's new width (a phone turned, a window resized).
  let lastWidth = app.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(app.clientWidth - lastWidth) < 4) return;
    lastWidth = app.clientWidth;
    draw();
  }).observe(app);
  void load(ctx);
});
