// Complete periodic-table data for the atomic-structure sandbox. `group` and
// `period` place main-table cells; the UI expands the lanthanide and actinide
// series into dedicated rows. `mass` sets a fresh atom's default neutron count.

export type Category =
  | 'alkali'
  | 'alkaline'
  | 'transition'
  | 'post-transition'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble'
  | 'lanthanide'
  | 'actinide';

export interface Element {
  z: number;
  symbol: string;
  name: string;
  mass: number; // standard atomic weight
  category: Category;
  group: number; // 1..18
  period: number; // 1..7
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
  { z: 37, symbol: 'Rb', name: 'Rubidium', mass: 85.468, category: 'alkali', group: 1, period: 5 },
  { z: 38, symbol: 'Sr', name: 'Strontium', mass: 87.62, category: 'alkaline', group: 2, period: 5 },
  { z: 39, symbol: 'Y', name: 'Yttrium', mass: 88.906, category: 'transition', group: 3, period: 5 },
  { z: 40, symbol: 'Zr', name: 'Zirconium', mass: 91.224, category: 'transition', group: 4, period: 5 },
  { z: 41, symbol: 'Nb', name: 'Niobium', mass: 92.906, category: 'transition', group: 5, period: 5 },
  { z: 42, symbol: 'Mo', name: 'Molybdenum', mass: 95.95, category: 'transition', group: 6, period: 5 },
  { z: 43, symbol: 'Tc', name: 'Technetium', mass: 98, category: 'transition', group: 7, period: 5 },
  { z: 44, symbol: 'Ru', name: 'Ruthenium', mass: 101.07, category: 'transition', group: 8, period: 5 },
  { z: 45, symbol: 'Rh', name: 'Rhodium', mass: 102.906, category: 'transition', group: 9, period: 5 },
  { z: 46, symbol: 'Pd', name: 'Palladium', mass: 106.42, category: 'transition', group: 10, period: 5 },
  { z: 47, symbol: 'Ag', name: 'Silver', mass: 107.868, category: 'transition', group: 11, period: 5 },
  { z: 48, symbol: 'Cd', name: 'Cadmium', mass: 112.414, category: 'transition', group: 12, period: 5 },
  { z: 49, symbol: 'In', name: 'Indium', mass: 114.818, category: 'post-transition', group: 13, period: 5 },
  { z: 50, symbol: 'Sn', name: 'Tin', mass: 118.71, category: 'post-transition', group: 14, period: 5 },
  { z: 51, symbol: 'Sb', name: 'Antimony', mass: 121.76, category: 'metalloid', group: 15, period: 5 },
  { z: 52, symbol: 'Te', name: 'Tellurium', mass: 127.6, category: 'metalloid', group: 16, period: 5 },
  { z: 53, symbol: 'I', name: 'Iodine', mass: 126.904, category: 'halogen', group: 17, period: 5 },
  { z: 54, symbol: 'Xe', name: 'Xenon', mass: 131.293, category: 'noble', group: 18, period: 5 },
  { z: 55, symbol: 'Cs', name: 'Caesium', mass: 132.905, category: 'alkali', group: 1, period: 6 },
  { z: 56, symbol: 'Ba', name: 'Barium', mass: 137.327, category: 'alkaline', group: 2, period: 6 },
  { z: 57, symbol: 'La', name: 'Lanthanum', mass: 138.905, category: 'lanthanide', group: 3, period: 6 },
  { z: 58, symbol: 'Ce', name: 'Cerium', mass: 140.116, category: 'lanthanide', group: 3, period: 6 },
  { z: 59, symbol: 'Pr', name: 'Praseodymium', mass: 140.908, category: 'lanthanide', group: 3, period: 6 },
  { z: 60, symbol: 'Nd', name: 'Neodymium', mass: 144.242, category: 'lanthanide', group: 3, period: 6 },
  { z: 61, symbol: 'Pm', name: 'Promethium', mass: 145, category: 'lanthanide', group: 3, period: 6 },
  { z: 62, symbol: 'Sm', name: 'Samarium', mass: 150.36, category: 'lanthanide', group: 3, period: 6 },
  { z: 63, symbol: 'Eu', name: 'Europium', mass: 151.964, category: 'lanthanide', group: 3, period: 6 },
  { z: 64, symbol: 'Gd', name: 'Gadolinium', mass: 157.25, category: 'lanthanide', group: 3, period: 6 },
  { z: 65, symbol: 'Tb', name: 'Terbium', mass: 158.925, category: 'lanthanide', group: 3, period: 6 },
  { z: 66, symbol: 'Dy', name: 'Dysprosium', mass: 162.5, category: 'lanthanide', group: 3, period: 6 },
  { z: 67, symbol: 'Ho', name: 'Holmium', mass: 164.93, category: 'lanthanide', group: 3, period: 6 },
  { z: 68, symbol: 'Er', name: 'Erbium', mass: 167.259, category: 'lanthanide', group: 3, period: 6 },
  { z: 69, symbol: 'Tm', name: 'Thulium', mass: 168.934, category: 'lanthanide', group: 3, period: 6 },
  { z: 70, symbol: 'Yb', name: 'Ytterbium', mass: 173.045, category: 'lanthanide', group: 3, period: 6 },
  { z: 71, symbol: 'Lu', name: 'Lutetium', mass: 174.967, category: 'lanthanide', group: 3, period: 6 },
  { z: 72, symbol: 'Hf', name: 'Hafnium', mass: 178.49, category: 'transition', group: 4, period: 6 },
  { z: 73, symbol: 'Ta', name: 'Tantalum', mass: 180.948, category: 'transition', group: 5, period: 6 },
  { z: 74, symbol: 'W', name: 'Tungsten', mass: 183.84, category: 'transition', group: 6, period: 6 },
  { z: 75, symbol: 'Re', name: 'Rhenium', mass: 186.207, category: 'transition', group: 7, period: 6 },
  { z: 76, symbol: 'Os', name: 'Osmium', mass: 190.23, category: 'transition', group: 8, period: 6 },
  { z: 77, symbol: 'Ir', name: 'Iridium', mass: 192.217, category: 'transition', group: 9, period: 6 },
  { z: 78, symbol: 'Pt', name: 'Platinum', mass: 195.084, category: 'transition', group: 10, period: 6 },
  { z: 79, symbol: 'Au', name: 'Gold', mass: 196.967, category: 'transition', group: 11, period: 6 },
  { z: 80, symbol: 'Hg', name: 'Mercury', mass: 200.592, category: 'transition', group: 12, period: 6 },
  { z: 81, symbol: 'Tl', name: 'Thallium', mass: 204.38, category: 'post-transition', group: 13, period: 6 },
  { z: 82, symbol: 'Pb', name: 'Lead', mass: 207.2, category: 'post-transition', group: 14, period: 6 },
  { z: 83, symbol: 'Bi', name: 'Bismuth', mass: 208.98, category: 'post-transition', group: 15, period: 6 },
  { z: 84, symbol: 'Po', name: 'Polonium', mass: 209, category: 'post-transition', group: 16, period: 6 },
  { z: 85, symbol: 'At', name: 'Astatine', mass: 210, category: 'halogen', group: 17, period: 6 },
  { z: 86, symbol: 'Rn', name: 'Radon', mass: 222, category: 'noble', group: 18, period: 6 },
  { z: 87, symbol: 'Fr', name: 'Francium', mass: 223, category: 'alkali', group: 1, period: 7 },
  { z: 88, symbol: 'Ra', name: 'Radium', mass: 226, category: 'alkaline', group: 2, period: 7 },
  { z: 89, symbol: 'Ac', name: 'Actinium', mass: 227, category: 'actinide', group: 3, period: 7 },
  { z: 90, symbol: 'Th', name: 'Thorium', mass: 232.038, category: 'actinide', group: 3, period: 7 },
  { z: 91, symbol: 'Pa', name: 'Protactinium', mass: 231.036, category: 'actinide', group: 3, period: 7 },
  { z: 92, symbol: 'U', name: 'Uranium', mass: 238.029, category: 'actinide', group: 3, period: 7 },
  { z: 93, symbol: 'Np', name: 'Neptunium', mass: 237, category: 'actinide', group: 3, period: 7 },
  { z: 94, symbol: 'Pu', name: 'Plutonium', mass: 244, category: 'actinide', group: 3, period: 7 },
  { z: 95, symbol: 'Am', name: 'Americium', mass: 243, category: 'actinide', group: 3, period: 7 },
  { z: 96, symbol: 'Cm', name: 'Curium', mass: 247, category: 'actinide', group: 3, period: 7 },
  { z: 97, symbol: 'Bk', name: 'Berkelium', mass: 247, category: 'actinide', group: 3, period: 7 },
  { z: 98, symbol: 'Cf', name: 'Californium', mass: 251, category: 'actinide', group: 3, period: 7 },
  { z: 99, symbol: 'Es', name: 'Einsteinium', mass: 252, category: 'actinide', group: 3, period: 7 },
  { z: 100, symbol: 'Fm', name: 'Fermium', mass: 257, category: 'actinide', group: 3, period: 7 },
  { z: 101, symbol: 'Md', name: 'Mendelevium', mass: 258, category: 'actinide', group: 3, period: 7 },
  { z: 102, symbol: 'No', name: 'Nobelium', mass: 259, category: 'actinide', group: 3, period: 7 },
  { z: 103, symbol: 'Lr', name: 'Lawrencium', mass: 266, category: 'actinide', group: 3, period: 7 },
  { z: 104, symbol: 'Rf', name: 'Rutherfordium', mass: 267, category: 'transition', group: 4, period: 7 },
  { z: 105, symbol: 'Db', name: 'Dubnium', mass: 268, category: 'transition', group: 5, period: 7 },
  { z: 106, symbol: 'Sg', name: 'Seaborgium', mass: 269, category: 'transition', group: 6, period: 7 },
  { z: 107, symbol: 'Bh', name: 'Bohrium', mass: 270, category: 'transition', group: 7, period: 7 },
  { z: 108, symbol: 'Hs', name: 'Hassium', mass: 269, category: 'transition', group: 8, period: 7 },
  { z: 109, symbol: 'Mt', name: 'Meitnerium', mass: 278, category: 'transition', group: 9, period: 7 },
  { z: 110, symbol: 'Ds', name: 'Darmstadtium', mass: 281, category: 'transition', group: 10, period: 7 },
  { z: 111, symbol: 'Rg', name: 'Roentgenium', mass: 282, category: 'transition', group: 11, period: 7 },
  { z: 112, symbol: 'Cn', name: 'Copernicium', mass: 285, category: 'transition', group: 12, period: 7 },
  { z: 113, symbol: 'Nh', name: 'Nihonium', mass: 286, category: 'post-transition', group: 13, period: 7 },
  { z: 114, symbol: 'Fl', name: 'Flerovium', mass: 289, category: 'post-transition', group: 14, period: 7 },
  { z: 115, symbol: 'Mc', name: 'Moscovium', mass: 290, category: 'post-transition', group: 15, period: 7 },
  { z: 116, symbol: 'Lv', name: 'Livermorium', mass: 293, category: 'post-transition', group: 16, period: 7 },
  { z: 117, symbol: 'Ts', name: 'Tennessine', mass: 294, category: 'halogen', group: 17, period: 7 },
  { z: 118, symbol: 'Og', name: 'Oganesson', mass: 294, category: 'noble', group: 18, period: 7 },
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
  lanthanide: '#fb7185',
  actinide: '#e879f9',
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
