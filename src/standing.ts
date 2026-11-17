/// <reference path="./pp.d.ts" />
/**
 * What the figures show, decided from the plugin's settings and the site's data: which field, whether to split by
 * outcome, the paper's own mean, its bin and its standing, and the text a screen reader hears. Pure, no DOM.
 */
import { countBelow, percentAhead, standingBand } from './distribution';

export type Outcome = PP.Outcome;
/** Bottom to top in a stacked bar: what was decided first, then what wasn't. */
export const OUTCOMES: readonly Outcome[] = ['accepted', 'rejected', 'withdrawn', 'pending'];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  pending: 'No decision',
};

export type View = 'both' | 'histogram' | 'curve';
export type Split = 'auto' | 'on' | 'off';

export interface Settings {
  view: View;
  field: string;
  splitByDecision: Split;
}

/** The plugin's settings as the host gives them, read leniently: anything unexpected is the default. */
export function readSettings(raw: Record<string, unknown> | null | undefined): Settings {
  const view = raw?.view;
  const split = raw?.splitByDecision;
  const field = raw?.field;
  return {
    view: view === 'histogram' || view === 'curve' ? view : 'both',
    field: typeof field === 'string' ? field.trim() : '',
    splitByDecision: split === 'on' || split === 'off' ? split : 'auto',
  };
}

/** Whether to split by outcome: `auto` once the venue's decisions are out. */
export function splitOn(setting: Split, decisionsOut: boolean): boolean {
  return setting === 'on' || (setting === 'auto' && decisionsOut);
}

/** The field to show among a venue's (in its forms' order): the one the setting names if the venue has it, else the first. */
export function chooseField<T extends { field: string }>(fields: readonly T[], setting: string): T | null {
  return fields.find((f) => f.field === setting) ?? fields[0] ?? null;
}

/** A score as a review gives it: `6`, or text such as `"6: marginally above"` by its leading number. As the site reads it. */
const LEADING_NUMBER = /^\s*(-?\d+(?:\.\d+)?)\s*(?::|$)/;

export function scoreOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const match = LEADING_NUMBER.exec(value);
    return match ? Number(match[1]) : null;
  }
  return null;
}

/**
 * A submission's mean for a field over its reviews, as the site's statistics take it (each review that gives the
 * field a score counts once), with how many reviews gave one. `null` when none did.
 */
export function paperMean(
  submission: Pick<PP.Submission, 'notes'>,
  field: string,
): { mean: number; reviews: number } | null {
  const scores = submission.notes
    .filter((note) => note.kind === 'review')
    .map((note) => scoreOf(note.content[field]))
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return { mean: scores.reduce((a, b) => a + b, 0) / scores.length, reviews: scores.length };
}

/** The bin `x` falls in: `[lo + i·width, lo + (i+1)·width)`, the last closed at `hi`; outside goes to the nearest end. */
export function binIndex(bins: Pick<PP.Bins, 'lo' | 'width' | 'counts'>, x: number): number {
  const n = bins.counts.length;
  if (n === 0) return -1;
  if (!(bins.width > 0)) return 0;
  return Math.min(n - 1, Math.max(0, Math.floor((x - bins.lo) / bins.width + 1e-9)));
}

/** A number as a score: up to two decimals, no trailing zeros ("5.75", "6", "3.33"). */
export function scoreText(x: number): string {
  return String(Math.round(x * 100) / 100);
}

export const count = (n: number) => n.toLocaleString('en');

/** A share as a percentage for people: "<1%" for a sliver rather than "0%". */
export function shareText(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  const p = (100 * part) / whole;
  return part > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/** A bin's range: "5.5–6". */
export function binRange(bins: Pick<PP.Bins, 'lo' | 'width'>, i: number): string {
  return `${scoreText(bins.lo + i * bins.width)}–${scoreText(bins.lo + (i + 1) * bins.width)}`;
}

export interface Standing {
  mean: number;
  reviews: number;
  /** Submissions with a mean strictly below. */
  below: number;
  size: number;
  /** `percentAhead`, `null` in a field of one. */
  ahead: number | null;
  /** "Top 12%", or `null` in a field of one. */
  band: string | null;
}

/** Where a mean stands among sorted `values`. */
export function standingOf(values: readonly number[], mean: { mean: number; reviews: number }): Standing {
  const below = countBelow(values, mean.mean);
  // A paper whose mean isn't among the values yet (statistics a few seconds behind) still counts itself.
  const size = Math.max(values.length, below + 1);
  const ahead = percentAhead(below, size);
  return { ...mean, below, size, ahead, band: ahead === null ? null : standingBand(ahead) };
}

/** The line beside the paper's marker: "This paper, Top 12%". */
export function markerLabel(standing: Standing): string {
  return standing.band ? `This paper, ${standing.band}` : 'This paper';
}

/** Counts per outcome, in `OUTCOMES` order, leaving out empty ones. */
export function outcomeCounts(field: Pick<PP.ScoreField, 'split'>): { outcome: Outcome; count: number }[] {
  return OUTCOMES.map((outcome) => ({ outcome, count: field.split[outcome]?.count ?? 0 })).filter((o) => o.count > 0);
}

/**
 * What a screen reader hears for the figure, and what the panel prints under it: the field, the venue, how many
 * submissions, the median, the paper's place, and the accept rate when split.
 */
export function summaryText(options: {
  field: Pick<PP.ScoreField, 'label' | 'values' | 'split' | 'venue'>;
  standing: Standing | null;
  split: boolean;
}): string {
  const { field, standing, split } = options;
  const n = field.values.length;
  const sorted = field.values;
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : NaN;
  const parts = [
    `${field.label} at ${field.venue.name}: ${count(n)} submission${n === 1 ? '' : 's'}, median ${scoreText(median)}.`,
  ];
  if (standing) {
    parts.push(
      `This paper's mean is ${scoreText(standing.mean)} over ${standing.reviews} review${standing.reviews === 1 ? '' : 's'}, above ${count(standing.below)} of ${count(standing.size)} submissions${standing.band ? ` (${standing.band})` : ''}.`,
    );
  }
  if (split) {
    const decided = (field.split.accepted?.count ?? 0) + (field.split.rejected?.count ?? 0);
    const counts = outcomeCounts(field)
      .map((o) => `${count(o.count)} ${OUTCOME_LABELS[o.outcome].toLowerCase()}`)
      .join(', ');
    parts.push(
      `${counts}${decided ? `; ${shareText(field.split.accepted?.count ?? 0, decided)} of decided submissions accepted` : ''}.`,
    );
  }
  return parts.join(' ');
}

/** One tab of the panel: a venue, its fields, the scope page whose statistics hold it, and (on a paper) the submission. */
export interface VenueTab {
  venue: { id: string; name: string };
  /** The page `scope.scores` is asked about. */
  scope: string;
  fields: PP.ScoreSummary[];
  submission: PP.Submission | null;
}

/** A scope's statistics as tabs: one per venue, in the list's order (most submissions first). */
export function scopeTabs(list: PP.ScoreList): VenueTab[] {
  const tabs = new Map<string, VenueTab>();
  for (const summary of list.scores) {
    let tab = tabs.get(summary.venue.id);
    if (!tab) {
      tab = { venue: summary.venue, scope: list.page.identifier, fields: [], submission: null };
      tabs.set(summary.venue.id, tab);
    }
    tab.fields.push(summary);
  }
  return [...tabs.values()];
}

/** When a submission was under review: its first note, or when the site fetched it. */
export function submittedAt(submission: Pick<PP.Submission, 'notes' | 'fetchedAt'>): string {
  if (submission.notes.length === 0) return submission.fetchedAt;
  return submission.notes.reduce((min, n) => (n.createdAt < min ? n.createdAt : min), submission.notes[0].createdAt);
}

/**
 * A paper's tabs: one per submission whose venue has statistics on one of the paper's venue pages (rejected at one
 * venue, accepted at the next: two tabs), oldest first, so they read in the order the paper went round. `lists` are `scope.scores` of
 * the paper's venue pages; a venue found on several (an edition and its series) is taken from the first.
 */
export function paperTabs(submissions: readonly PP.Submission[], lists: readonly PP.ScoreList[]): VenueTab[] {
  const byVenue = new Map<string, VenueTab>();
  for (const list of lists) {
    for (const tab of scopeTabs(list)) if (!byVenue.has(tab.venue.id)) byVenue.set(tab.venue.id, tab);
  }
  const out: VenueTab[] = [];
  const seen = new Set<string>();
  const ordered = [...submissions].sort((a, b) => submittedAt(a).localeCompare(submittedAt(b)));
  for (const submission of ordered) {
    const tab = byVenue.get(submission.venue.id);
    if (!tab || seen.has(tab.venue.id)) continue;
    seen.add(tab.venue.id);
    out.push({ ...tab, submission });
  }
  return out;
}

/** The tab to open first: on a paper its accepted submission, else its latest; on a scope the first (the largest venue). */
export function firstTab(tabs: readonly VenueTab[]): number {
  if (!tabs.some((t) => t.submission)) return 0;
  const accepted = tabs.findIndex((t) => t.submission?.status === 'accepted');
  return accepted !== -1 ? accepted : tabs.length - 1;
}
