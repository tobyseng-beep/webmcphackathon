// Turns Desmos/LaTeX-flavoured input into something math.js can parse.
// This is deliberately NOT a LaTeX parser -- it is a normalizer that rewrites
// the handful of constructs students and agents actually type.

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau',
  'upsilon', 'phi', 'chi', 'psi', 'omega', 'pi'];

// Desmos conventions: log is base 10, ln is natural.
const FUNC_ALIASES = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh',
  ln: 'log', log: 'log10',
};

function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// \frac{A}{B} -> ((A)/(B)), innermost-first so nesting works.
function expandFrac(s) {
  for (let guard = 0; guard < 100; guard++) {
    const i = s.lastIndexOf('\\frac{');
    if (i === -1) break;
    const openA = i + 5;
    const closeA = matchBrace(s, openA);
    if (closeA === -1) break;
    if (s[closeA + 1] !== '{') break;
    const closeB = matchBrace(s, closeA + 1);
    if (closeB === -1) break;
    const a = s.slice(openA + 1, closeA);
    const b = s.slice(closeA + 2, closeB);
    s = s.slice(0, i) + `((${a})/(${b}))` + s.slice(closeB + 1);
  }
  return s;
}

// \sqrt[n]{A} -> nthRoot(A,n) ; \sqrt{A} -> sqrt(A)
function expandSqrt(s) {
  for (let guard = 0; guard < 100; guard++) {
    const i = s.lastIndexOf('\\sqrt');
    if (i === -1) break;
    let j = i + 5;
    let index = null;
    if (s[j] === '[') {
      const close = s.indexOf(']', j);
      if (close === -1) break;
      index = s.slice(j + 1, close);
      j = close + 1;
    }
    if (s[j] !== '{') break;
    const close = matchBrace(s, j);
    if (close === -1) break;
    const body = s.slice(j + 1, close);
    const out = index === null ? `sqrt(${body})` : `nthRoot(${body},${index})`;
    s = s.slice(0, i) + out + s.slice(close + 1);
  }
  return s;
}

// ^{...} -> ^(...)
function expandSuperscript(s) {
  for (let guard = 0; guard < 100; guard++) {
    const i = s.indexOf('^{');
    if (i === -1) break;
    const close = matchBrace(s, i + 1);
    if (close === -1) break;
    s = s.slice(0, i) + '^(' + s.slice(i + 2, close) + ')' + s.slice(close + 1);
  }
  return s;
}

// a_{1} -> a_1  (math.js accepts underscores inside symbol names)
function expandSubscript(s) {
  for (let guard = 0; guard < 100; guard++) {
    const i = s.indexOf('_{');
    if (i === -1) break;
    const close = matchBrace(s, i + 1);
    if (close === -1) break;
    s = s.slice(0, i) + '_' + s.slice(i + 2, close).replace(/[^A-Za-z0-9]/g, '') + s.slice(close + 1);
  }
  return s;
}

// |expr| -> abs(expr), alternating open/close.
function expandAbs(s) {
  let out = '';
  let open = false;
  for (const ch of s) {
    if (ch === '|') { out += open ? ')' : 'abs('; open = !open; }
    else out += ch;
  }
  return open ? out + ')' : out;
}

export function normalize(input) {
  let s = String(input ?? '').trim();
  if (!s) return s;

  s = s.replace(/\\left|\\right/g, '');
  s = s.replace(/\\operatorname\{([A-Za-z]+)\}/g, '$1');
  s = expandFrac(s);
  s = expandSqrt(s);
  s = expandSuperscript(s);
  s = expandSubscript(s);

  s = s.replace(/\\cdot|\\times|\\ast/g, '*').replace(/\\div/g, '/');
  s = s.replace(/\\le(?![A-Za-z])/g, '<=').replace(/\\ge(?![A-Za-z])/g, '>=');
  s = s.replace(/\\,|\;|\\!|\\ /g, ' ');

  // Any surviving \name -> name (function or greek letter).
  s = s.replace(/\\([A-Za-z]+)/g, '$1');

  s = s.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'));
  s = expandAbs(s);

  // Function aliases, longest name first so arcsin beats sin.
  const names = Object.keys(FUNC_ALIASES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    s = s.replace(new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g'), FUNC_ALIASES[name]);
  }

  return s.trim();
}

export const GREEK_NAMES = GREEK;

// Split on a top-level '=' that is not part of ==, <=, >=, !=.
export function splitEquation(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '=' && depth === 0) {
      const prev = s[i - 1], next = s[i + 1];
      if (prev === '<' || prev === '>' || prev === '!' || prev === '=') continue;
      if (next === '=') { i++; continue; }
      return { lhs: s.slice(0, i).trim(), rhs: s.slice(i + 1).trim() };
    }
  }
  return null;
}
