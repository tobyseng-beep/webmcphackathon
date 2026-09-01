// Periodic-table data for the atomic-structure sandbox. Periods 1-4 (H..Kr,
// Z = 1..36), which covers essentially every element a Chem 1 course builds
// atoms and compounds from. `group`/`period` place the cell in the periodic
// table; `mass` sets the default neutron count of a fresh neutral atom.

export type Category =
  | 'alkali'
  | 'alkaline'
  | 'transition'
  | 'post-transition'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble';

export interface Element {
  z: number;
  symbol: string;
  name: string;
  mass: number; // standard atomic weight
  category: Category;
  group: number; // 1..18
  period: number; // 1..4
}

export const ELEMENTS: Element[] = [
  { z: 1, symbol: 'H', name: 'Hydrogen', mass: 1.008, category: 'nonmetal', group: 1, period: 1 },
  { z: 2, symbol: 'He', name: 'Helium', mass: 4.003, category: 'noble', group: 18, period: 1 },
  { z: 3, symbol: 'Li', name: 'Lithium', mass: 6.94, category: 'alkali', group: 1, period: 2 },
  { z: 4, symbol: 'Be', name: 'Beryllium', mass: 9.012, category: 'alkaline', group: 2, period: 2 },
  { z: 5, symbol: 'B', name: 'Boron', mass: 10.81, category: 'metalloid', group: 13, period: 2 },
  { z: 6, symbol: 'C', name: 'Carbon', mass: 12.011, category: 'nonmetal', group: 14, period: 2 },
  { z: 7, symbol: 'N', name: 'Nitrogen', mass: 14.007, category: 'nonmetal', group: 15, period: 2 },
  { z: 8, symbol: 'O', name: 'Oxygen', mass: 15.999, category: 'nonmetal', group: 16, period: 2 },
  { z: 9, symbol: 'F', name: 'Fluorine', mass: 18.998, category: 'halogen', group: 17, period: 2 },
  { z: 10, symbol: 'Ne', name: 'Neon', mass: 20.18, category: 'noble', group: 18, period: 2 },
  { z: 11, symbol: 'Na', name: 'Sodium', mass: 22.99, category: 'alkali', group: 1, period: 3 },
  { z: 12, symbol: 'Mg', name: 'Magnesium', mass: 24.305, category: 'alkaline', group: 2, period: 3 },
  { z: 13, symbol: 'Al', name: 'Aluminium', mass: 26.982, category: 'post-transition', group: 13, period: 3 },
  { z: 14, symbol: 'Si', name: 'Silicon', mass: 28.085, category: 'metalloid', group: 14, period: 3 },
  { z: 15, symbol: 'P', name: 'Phosphorus', mass: 30.974, category: 'nonmetal', group: 15, period: 3 },
  { z: 16, symbol: 'S', name: 'Sulfur', mass: 32.06, category: 'nonmetal', group: 16, period: 3 },
  { z: 17, symbol: 'Cl', name: 'Chlorine', mass: 35.45, category: 'halogen', group: 17, period: 3 },
  { z: 18, symbol: 'Ar', name: 'Argon', mass: 39.948, category: 'noble', group: 18, period: 3 },
  { z: 19, symbol: 'K', name: 'Potassium', mass: 39.098, category: 'alkali', group: 1, period: 4 },
  { z: 20, symbol: 'Ca', name: 'Calcium', mass: 40.078, category: 'alkaline', group: 2, period: 4 },
  { z: 21, symbol: 'Sc', name: 'Scandium', mass: 44.956, category: 'transition', group: 3, period: 4 },
  { z: 22, symbol: 'Ti', name: 'Titanium', mass: 47.867, category: 'transition', group: 4, period: 4 },
  { z: 23, symbol: 'V', name: 'Vanadium', mass: 50.942, category: 'transition', group: 5, period: 4 },
  { z: 24, symbol: 'Cr', name: 'Chromium', mass: 51.996, category: 'transition', group: 6, period: 4 },
  { z: 25, symbol: 'Mn', name: 'Manganese', mass: 54.938, category: 'transition', group: 7, period: 4 },
  { z: 26, symbol: 'Fe', name: 'Iron', mass: 55.845, category: 'transition', group: 8, period: 4 },
  { z: 27, symbol: 'Co', name: 'Cobalt', mass: 58.933, category: 'transition', group: 9, period: 4 },
  { z: 28, symbol: 'Ni', name: 'Nickel', mass: 58.693, category: 'transition', group: 10, period: 4 },
  { z: 29, symbol: 'Cu', name: 'Copper', mass: 63.546, category: 'transition', group: 11, period: 4 },
  { z: 30, symbol: 'Zn', name: 'Zinc', mass: 65.38, category: 'transition', group: 12, period: 4 },
  { z: 31, symbol: 'Ga', name: 'Gallium', mass: 69.723, category: 'post-transition', group: 13, period: 4 },
  { z: 32, symbol: 'Ge', name: 'Germanium', mass: 72.63, category: 'metalloid', group: 14, period: 4 },
  { z: 33, symbol: 'As', name: 'Arsenic', mass: 74.922, category: 'metalloid', group: 15, period: 4 },
  { z: 34, symbol: 'Se', name: 'Selenium', mass: 78.971, category: 'nonmetal', group: 16, period: 4 },
  { z: 35, symbol: 'Br', name: 'Bromine', mass: 79.904, category: 'halogen', group: 17, period: 4 },
  { z: 36, symbol: 'Kr', name: 'Krypton', mass: 83.798, category: 'noble', group: 18, period: 4 },
];

export const CATEGORY_COLOR: Record<Category, string> = {
  alkali: '#f97316',
  alkaline: '#f59e0b',
  transition: '#a78bfa',
  'post-transition': '#38bdf8',
  metalloid: '#2dd4bf',
  nonmetal: '#4ade80',
  halogen: '#facc15',
  noble: '#f472b6',
};

const BY_Z = new Map(ELEMENTS.map((e) => [e.z, e]));
const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol.toLowerCase(), e]));

export function elementByZ(z: number): Element | undefined { return BY_Z.get(z); }
export function elementBySymbol(sym: string): Element | undefined {
  return BY_SYMBOL.get(String(sym).trim().toLowerCase());
}
export function defaultNeutrons(z: number): number {
  const el = BY_Z.get(z);
  if (!el) return z;
  return Math.max(0, Math.round(el.mass) - z);
}
export const MAX_Z = ELEMENTS.length;
