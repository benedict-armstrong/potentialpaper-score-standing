/// <reference path="./pp.d.ts" />
/**
 * Drawing the figures as SVG in the frame, ported from acceptodds' `VenueStanding` (the histogram) and
 * `StandingChart` (the curve). Colours are the page's tokens (`--pp-*`, set by the SDK), so both themes follow the
 * site. Each figure is focusable: hover or the arrow keys read it off, in a tooltip that a screen reader also hears.
 */
import { niceTicks, yAt } from './distribution';
import { curveModel, curveReadout, histogramModel, type Layer } from './figures';
import { binRange, count, OUTCOME_LABELS, scoreText, shareText, type Standing } from './standing';

const PAD = { top: 26, right: 10, bottom: 24, left: 10 };
const GAP = 1;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Keep a label inside the figure when its line is near an edge. */
const anchorAt = (x: number, width: number) => (x < width * 0.2 ? 'start' : x > width * 0.8 ? 'end' : 'middle');

/** The paper's label, above the plot, with a halo so lines behind it don't cross it. */
function markerText(x: number, width: number, label: string): string {
  return `<text class="marker-label" x="${x.toFixed(1)}" y="${PAD.top - 10}" text-anchor="${anchorAt(x, width)}">${esc(label)}</text>`;
}

interface FigureOptions {
  field: PP.ScoreField;
  split: boolean;
  standing: Standing | null;
  /** "This paper, Top 12%". */
  label: string | null;
  width: number;
  /** The id of the summary the figure is described by. */
  describedBy: string;
}

/** Position a tooltip beside `x` within the figure. */
function placeTip(tip: HTMLElement, x: number, width: number, html: string) {
  tip.innerHTML = html;
  tip.hidden = false;
  if (x > width / 2) {
    tip.style.left = '';
    tip.style.right = `${Math.max(0, width - x + 8)}px`;
  } else {
    tip.style.right = '';
    tip.style.left = `${x + 8}px`;
  }
}

function shell(svg: string, label: string, describedBy: string): { root: HTMLElement; svg: SVGSVGElement; tip: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'figure';
  root.innerHTML = svg;
  const el = root.querySelector('svg')!;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-describedby', describedBy);
  el.setAttribute('tabindex', '0');
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  root.append(tip);
  return { root, svg: el, tip };
}

/**
 * (a) The histogram: the venue's bins, stacked by outcome when split; the paper's bin marked and the part of the
 * field below it shaded. Hovering a bar (or the arrow keys) shows its range, its count and its share.
 */
export function histogram(o: FigureOptions): HTMLElement {
  const { field, width } = o;
  const m = histogramModel(field, o.split, o.standing?.mean ?? null);
  const height = 150;
  const n = m.totals.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, n);
  const base = PAD.top + plotH;
  const x0 = (i: number) => PAD.left + i * slot;
  const h = (c: number) => (c === 0 ? 0 : Math.max(2, (c / m.peak) * plotH));
  const parts: string[] = [];

  if (m.mine !== null) {
    // The share below: a band behind the bars up to the paper's bin.
    parts.push(`<rect class="below" x="${PAD.left}" y="${PAD.top}" width="${(x0(m.mine) - PAD.left).toFixed(1)}" height="${plotH}"/>`);
  }
  for (let i = 0; i < n; i += 1) {
    const x = x0(i) + GAP / 2;
    const w = Math.max(1, slot - GAP).toFixed(1);
    if (m.layers.length) {
      for (const layer of m.layers) {
        const y0 = base - h(m.totals[i]) * (layer.to[i] / Math.max(1, m.totals[i]));
        const y1 = base - h(m.totals[i]) * (layer.from[i] / Math.max(1, m.totals[i]));
        if (y1 - y0 > 0) {
          parts.push(`<rect class="o-${layer.outcome}" x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${w}" height="${(y1 - y0).toFixed(1)}"/>`);
        }
      }
      if (i === m.mine && m.totals[i] > 0) {
        parts.push(`<rect class="mine-outline" x="${x.toFixed(1)}" y="${(base - h(m.totals[i])).toFixed(1)}" width="${w}" height="${h(m.totals[i]).toFixed(1)}"/>`);
      }
    } else {
      const cls = m.mine === null ? 'bar' : i === m.mine ? 'bar mine' : i < m.mine ? 'bar under' : 'bar';
      parts.push(`<rect class="${cls}" x="${x.toFixed(1)}" y="${(base - h(m.totals[i])).toFixed(1)}" width="${w}" height="${h(m.totals[i]).toFixed(1)}"/>`);
    }
  }
  if (m.mine !== null) {
    const mx = x0(m.mine) + slot / 2;
    parts.push(`<line class="mine-tick" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${base + 1}" y2="${base + 6}"/>`);
    if (o.label) parts.push(markerText(mx, width, o.label));
  }
  parts.push(`<line class="axis" x1="${PAD.left}" x2="${width - PAD.right}" y1="${base}" y2="${base}"/>`);
  for (const t of niceTicks(m.bins.lo, m.bins.hi, Math.max(2, Math.floor(plotW / 70)))) {
    const x = PAD.left + ((t - m.bins.lo) / Math.max(1e-9, m.bins.hi - m.bins.lo)) * plotW;
    parts.push(`<text class="tick" x="${x.toFixed(1)}" y="${base + 16}" text-anchor="middle">${scoreText(t)}</text>`);
  }
  const hover = `<rect class="hover" x="0" y="${PAD.top}" width="0" height="${plotH}" visibility="hidden"/>`;
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}${hover}</svg>`;
  const { root, svg: el, tip } = shell(
    svg,
    `Histogram of ${field.label.toLowerCase()} means at ${field.venue.name}${o.label ? `; ${o.label}` : ''}`,
    o.describedBy,
  );
  const hoverRect = el.querySelector<SVGRectElement>('.hover')!;
  let at: number | null = null;
  const show = (i: number | null) => {
    at = i;
    if (i === null) {
      tip.hidden = true;
      hoverRect.setAttribute('visibility', 'hidden');
      return;
    }
    hoverRect.setAttribute('x', x0(i).toFixed(1));
    hoverRect.setAttribute('width', slot.toFixed(1));
    hoverRect.setAttribute('visibility', 'visible');
    const c = m.totals[i];
    let html = `<span class="mono">${binRange(m.bins, i)}</span> <span class="muted">${count(c)} submission${c === 1 ? '' : 's'}, ${shareText(c, m.total)}</span>`;
    if (m.layers.length && c > 0) {
      const of = (layer: Layer) => layer.to[i] - layer.from[i];
      const acc = m.layers.find((l) => l.outcome === 'accepted');
      const rej = m.layers.find((l) => l.outcome === 'rejected');
      const decided = (acc ? of(acc) : 0) + (rej ? of(rej) : 0);
      html += `<div>${m.layers
        .filter((l) => of(l) > 0)
        .map((l) => `${count(of(l))} ${OUTCOME_LABELS[l.outcome].toLowerCase()}`)
        .join(', ')}${decided ? `; ${shareText(acc ? of(acc) : 0, decided)} accepted` : ''}</div>`;
    }
    placeTip(tip, x0(i) + (i < n / 2 ? slot : 0), width, html);
  };
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - PAD.left) / slot);
    show(i >= 0 && i < n ? i : null);
  });
  el.addEventListener('pointerleave', () => show(null));
  el.addEventListener('blur', () => show(null));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const from = at ?? m.mine ?? Math.floor(n / 2);
    show(Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1))));
  });
  return root;
}

const path = (xs: number[], ys: number[]) => xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join('');

/**
 * (b) The curve: a kernel density of the means, the area below the paper shaded and a line at the paper labelled
 * with its band. Split, the area is divided by outcome in proportion at each score, so the accepted share at a score
 * is the accept rate there. Hover (or the arrow keys) reads off how many submissions are below.
 */
export function curve(o: FigureOptions): HTMLElement {
  const { field, width } = o;
  const mean = o.standing?.mean ?? null;
  const m = curveModel(field, o.split, mean);
  const height = 160;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const [lo, hi] = m.domain;
  const sx = (x: number) => PAD.left + ((x - lo) / (hi - lo)) * plotW;
  const sy = (y: number) => PAD.top + plotH - y * plotH;
  const base = PAD.top + plotH;
  const pxs = m.xs.map(sx);
  const line = path(pxs, m.ys.map(sy));
  const area = `${line}L${sx(hi).toFixed(1)},${base}L${sx(lo).toFixed(1)},${base}Z`;
  const parts: string[] = [];
  const clip = `below-${Math.random().toString(36).slice(2, 8)}`;

  if (m.layers.length) {
    for (const layer of m.layers) {
      const top = path(pxs, layer.to.map(sy));
      const bottom = pxs
        .map((x, i) => [x, sy(layer.from[i])] as const)
        .reverse()
        .map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`)
        .join('');
      parts.push(`<path class="o-${layer.outcome} layer" d="${top}${bottom}Z"/>`);
    }
  } else {
    parts.push(`<path class="area" d="${area}"/>`);
  }
  const youX = mean === null ? null : sx(mean);
  if (youX !== null) {
    parts.push(
      `<clipPath id="${clip}"><rect x="0" y="0" width="${Math.max(0, youX).toFixed(1)}" height="${height}"/></clipPath>`,
      `<path class="below" d="${area}" clip-path="url(#${clip})"/>`,
    );
  }
  parts.push(`<path class="line" d="${line}"/>`);
  parts.push(`<line class="axis" x1="${PAD.left}" x2="${width - PAD.right}" y1="${base}" y2="${base}"/>`);
  for (const t of niceTicks(lo, hi, Math.max(2, Math.floor(plotW / 70)))) {
    parts.push(`<text class="tick" x="${sx(t).toFixed(1)}" y="${base + 16}" text-anchor="middle">${scoreText(t)}</text>`);
  }
  if (youX !== null && mean !== null) {
    const youY = sy(yAt(m, mean));
    parts.push(
      `<line class="you" x1="${youX.toFixed(1)}" x2="${youX.toFixed(1)}" y1="${base}" y2="${Math.min(youY, PAD.top - 4).toFixed(1)}"/>`,
      `<circle class="you-dot" cx="${youX.toFixed(1)}" cy="${youY.toFixed(1)}" r="4"/>`,
    );
    if (o.label) parts.push(markerText(youX, width, o.label));
  }
  parts.push(`<line class="hover" x1="0" x2="0" y1="${PAD.top}" y2="${base}" visibility="hidden"/>`);
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  const { root, svg: el, tip } = shell(
    svg,
    `Curve of ${field.label.toLowerCase()} means at ${field.venue.name}${o.label ? `; ${o.label}` : ''}`,
    o.describedBy,
  );
  const hoverLine = el.querySelector<SVGLineElement>('.hover')!;
  const values = field.values;
  let at: number | null = null;
  const show = (x: number | null) => {
    at = x;
    if (x === null) {
      tip.hidden = true;
      hoverLine.setAttribute('visibility', 'hidden');
      return;
    }
    const px = sx(x);
    hoverLine.setAttribute('x1', px.toFixed(1));
    hoverLine.setAttribute('x2', px.toFixed(1));
    hoverLine.setAttribute('visibility', 'visible');
    const r = curveReadout(m, values, x);
    const rate = r.acceptRate === null ? '' : `<div>${Math.round(100 * r.acceptRate)}% accepted at this score</div>`;
    placeTip(
      tip,
      px,
      width,
      `<span class="mono">${scoreText(x)}</span> <span class="muted">${count(r.below)} paper${r.below === 1 ? '' : 's'} below (${shareText(r.below, values.length)})</span>${rate}`,
    );
  };
  const invert = (px: number) => lo + ((px - PAD.left) / plotW) * (hi - lo);
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = invert(e.clientX - r.left);
    show(x >= lo && x <= hi ? x : null);
  });
  el.addEventListener('pointerleave', () => show(null));
  el.addEventListener('blur', () => show(null));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (hi - lo) / 40;
    const from = at ?? mean ?? (lo + hi) / 2;
    show(Math.min(hi, Math.max(lo, from + (e.key === 'ArrowLeft' ? -step : step))));
  });
  return root;
}
