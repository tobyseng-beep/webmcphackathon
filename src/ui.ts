// DOM rendering. Rows are keyed and updated in place rather than rebuilt, so a
// slider being animated by the agent stays smooth and a text box you are typing
// in does not lose focus mid-word.

import * as graph from './store';
import { mustQuery } from './dom';
import type { Expression, MutationReason, Slider } from './types';

const exprList = mustQuery<HTMLDivElement>('#expr-list');
const sliderList = mustQuery<HTMLDivElement>('#slider-list');
const emptyHint = mustQuery<HTMLDivElement>('#empty-hint');

interface ExprRow {
  row: HTMLDivElement;
  swatch: HTMLButtonElement;
  input: HTMLInputElement;
  del: HTMLButtonElement;
  error: HTMLDivElement;
}
interface SliderRow {
  row: HTMLDivElement;
  value: HTMLInputElement;
  range: HTMLInputElement;
  lo: HTMLSpanElement;
  hi: HTMLSpanElement;
}
const exprRows = new Map<string, ExprRow>();
const sliderRows = new Map<string, SliderRow>();

let debounce: ReturnType<typeof setTimeout> | undefined;

// Palette offered in the colour picker (the store's defaults plus a few more).
const PICKER_COLORS = [
  '#2d70b3', '#c74440', '#388c46', '#6042a6', '#fa7e19', '#000000',
  '#0ea5e9', '#e11d8f', '#14b8a6', '#eab308', '#7c3aed', '#64748b',
];

let colorPopover: HTMLDivElement | null = null;

function closeColorPopover(): void {
  colorPopover?.remove();
  colorPopover = null;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
}

function onDocPointerDown(e: PointerEvent): void {
  if (colorPopover && !colorPopover.contains(e.target as Node)) closeColorPopover();
}

function openColorPopover(exprId: string, anchor: HTMLElement): void {
  closeColorPopover();
  const expr = graph.byId(exprId);
  if (!expr) return;

  const pop = document.createElement('div');
  pop.className = 'color-popover';

  const swatches = document.createElement('div');
  swatches.className = 'color-swatches';
  for (const col of PICKER_COLORS) {
    const chip = document.createElement('button');
    chip.className = 'color-chip';
    chip.style.background = col;
    chip.title = col;
    if (col.toLowerCase() === expr.color.toLowerCase()) chip.classList.add('selected');
    chip.addEventListener('click', () => { graph.setColor(exprId, col); graph.commitHistory(); closeColorPopover(); });
    swatches.append(chip);
  }
  pop.append(swatches);

  const customRow = document.createElement('label');
  customRow.className = 'color-custom';
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = /^#[0-9a-f]{6}$/i.test(expr.color) ? expr.color : '#2d70b3';
  custom.addEventListener('input', () => graph.setColor(exprId, custom.value));
  custom.addEventListener('change', () => graph.commitHistory());
  customRow.append(custom, document.createTextNode('Custom'));
  pop.append(customRow);

  const vis = document.createElement('button');
  vis.className = 'color-vis';
  vis.textContent = expr.visible ? 'Hide curve' : 'Show curve';
  vis.addEventListener('click', () => { graph.setVisible(exprId, !graph.byId(exprId)?.visible); closeColorPopover(); });
  pop.append(vis);

  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;

  colorPopover = pop;
  setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown, true), 0);
}

function makeExprRow(expr: Expression): ExprRow {
  const row = document.createElement('div');
  row.className = 'expr-row';

  const swatch = document.createElement('button');
  swatch.className = 'swatch';
  swatch.title = 'Show or hide this curve';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'expr-input';
  input.spellcheck = false;
  input.placeholder = 'y = a·x² + b';

  const del = document.createElement('button');
  del.className = 'ghost';
  del.textContent = '×';
  del.title = 'Delete';

  const error = document.createElement('div');
  error.className = 'expr-error';

  swatch.title = 'Colour and visibility';
  swatch.addEventListener('click', () => openColorPopover(expr.id, swatch));
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => graph.upsert(expr.id, { latex: input.value }), 180);
  });
  input.addEventListener('change', () => graph.commitHistory());
  del.addEventListener('click', () => graph.remove(expr.id));

  row.append(swatch, input, del, error);
  return { row, swatch, input, del, error };
}

function renderExpressions() {
  const expressions = graph.getState().expressions;
  const seen = new Set();

  expressions.forEach((expr, index) => {
    seen.add(expr.id);
    let parts = exprRows.get(expr.id);
    if (!parts) {
      parts = makeExprRow(expr);
      exprRows.set(expr.id, parts);
    }
    if (exprList.children[index] !== parts.row) {
      exprList.insertBefore(parts.row, exprList.children[index] ?? null);
    }
    if (document.activeElement !== parts.input) parts.input.value = expr.latex;
    parts.swatch.style.background = expr.color;
    parts.swatch.classList.toggle('hidden-expr', !expr.visible);
    parts.row.classList.toggle('has-error', Boolean(expr.error));
    parts.error.textContent = expr.error ?? '';
  });

  for (const [id, parts] of exprRows) {
    if (seen.has(id)) continue;
    parts.row.remove();
    exprRows.delete(id);
  }

  emptyHint.hidden = expressions.length > 0;
}

function makeSliderRow(slider: Slider): SliderRow {
  const row = document.createElement('div');
  row.className = 'slider-row';

  const top = document.createElement('div');
  top.className = 'slider-top';
  const name = document.createElement('span');
  name.className = 'slider-name';
  name.textContent = slider.name;
  const value = document.createElement('input');
  value.type = 'number';
  value.className = 'slider-value';
  value.step = '0.01';
  value.setAttribute('aria-label', `${slider.name} value`);
  top.append(name, value);

  const range = document.createElement('input');
  range.type = 'range';

  const bounds = document.createElement('div');
  bounds.className = 'slider-bounds';
  const lo = document.createElement('span');
  const hi = document.createElement('span');
  bounds.append(lo, hi);

  range.addEventListener('input', () => graph.setSlider(slider.name, Number(range.value)));
  range.addEventListener('change', () => graph.commitHistory());
  const commitValue = () => {
    if (!Number.isFinite(value.valueAsNumber)) {
      value.value = graph.getState().sliders.find((item) => item.name === slider.name)?.value.toFixed(2) ?? '';
      return;
    }
    const rounded = Math.round((value.valueAsNumber + Number.EPSILON) * 100) / 100;
    const result = graph.setSlider(slider.name, rounded);
    if (result.ok) value.value = result.value.toFixed(2);
    graph.commitHistory();
  };
  value.addEventListener('blur', commitValue);
  value.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      value.blur();
    }
  });

  row.append(top, range, bounds);
  return { row, value, range, lo, hi };
}

function renderSliders() {
  const sliders = graph.getState().sliders;
  const empty = sliderList.querySelector<HTMLElement>('.empty');
  if (empty) empty.hidden = sliders.length > 0;

  const seen = new Set();
  sliders.forEach((slider) => {
    seen.add(slider.name);
    let parts = sliderRows.get(slider.name);
    if (!parts) {
      parts = makeSliderRow(slider);
      sliderRows.set(slider.name, parts);
      sliderList.append(parts.row);
    }
    parts.range.min = String(slider.min);
    parts.range.max = String(slider.max);
    parts.range.step = String(slider.step);
    parts.range.value = String(slider.value);
    parts.value.min = String(slider.min);
    parts.value.max = String(slider.max);
    if (document.activeElement !== parts.value) parts.value.value = slider.value.toFixed(2);
    parts.lo.textContent = String(slider.min);
    parts.hi.textContent = String(slider.max);
  });

  for (const [name, parts] of sliderRows) {
    if (seen.has(name)) continue;
    parts.row.remove();
    sliderRows.delete(name);
  }
}

export function renderAll(reason?: MutationReason): void {
  if (reason === 'expressions' || reason === undefined) renderExpressions();
  renderSliders();
}

export function focusLastExpression(): void {
  const expressions = graph.getState().expressions;
  const last = expressions[expressions.length - 1];
  if (last) exprRows.get(last.id)?.input.focus();
}
