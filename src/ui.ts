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

  swatch.addEventListener('click', () => {
    const current = graph.byId(expr.id);
    if (current) graph.upsert(expr.id, { visible: !current.visible });
  });
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => graph.upsert(expr.id, { latex: input.value }), 180);
  });
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
  const commitValue = () => {
    if (!Number.isFinite(value.valueAsNumber)) {
      value.value = graph.getState().sliders.find((item) => item.name === slider.name)?.value.toFixed(2) ?? '';
      return;
    }
    const rounded = Math.round((value.valueAsNumber + Number.EPSILON) * 100) / 100;
    const result = graph.setSlider(slider.name, rounded);
    if (result.ok) value.value = result.value.toFixed(2);
  };
  value.addEventListener('change', commitValue);
  value.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') value.blur();
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
