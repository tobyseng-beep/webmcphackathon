// Landing menu: scatters the background equations and exposes the site's
// navigation to an agent, so the front door is not a WebMCP dead zone --
// "open the 3D grapher" should work before the student has clicked anything.

import type { WebMcpTool } from './types';

interface ScatteredEquation {
  text: string;
  x: string;
  y: string;
  rotate: number;
  opacity: number;
  size: string;
}

const EQUATIONS: ScatteredEquation[] = [
  { text: 'E = mc²', x: '6%', y: '12%', rotate: -8, opacity: 0.18, size: '1.1rem' },
  { text: '∇²φ = ρ/ε₀', x: '80%', y: '8%', rotate: 5, opacity: 0.15, size: '0.95rem' },
  { text: 'F = ma', x: '88%', y: '55%', rotate: -4, opacity: 0.2, size: '1.2rem' },
  { text: 'e^(iπ) + 1 = 0', x: '3%', y: '70%', rotate: 7, opacity: 0.16, size: '1rem' },
  { text: '∮ B · dA = 0', x: '72%', y: '82%', rotate: -6, opacity: 0.14, size: '0.9rem' },
  { text: 'y = sin(x)', x: '55%', y: '6%', rotate: 3, opacity: 0.17, size: '1rem' },
  { text: 'V = IR', x: '14%', y: '88%', rotate: -5, opacity: 0.19, size: '1.1rem' },
  { text: 'i = C dV/dt', x: '40%', y: '91%', rotate: 4, opacity: 0.14, size: '0.88rem' },
  { text: '∂²u/∂t² = c²∇²u', x: '2%', y: '42%', rotate: -3, opacity: 0.13, size: '0.85rem' },
  { text: '∫ f(x) dx', x: '86%', y: '30%', rotate: 6, opacity: 0.15, size: '1rem' },
  { text: 'λ = h / mv', x: '62%', y: '88%', rotate: -7, opacity: 0.16, size: '0.9rem' },
  { text: '∑ Fᵢ = 0', x: '18%', y: '18%', rotate: 9, opacity: 0.13, size: '0.95rem' },
];

for (const eq of EQUATIONS) {
  const span = document.createElement('span');
  span.className = 'equation';
  span.textContent = eq.text;
  span.style.left = eq.x;
  span.style.top = eq.y;
  span.style.opacity = String(eq.opacity);
  span.style.fontSize = eq.size;
  span.style.transform = `rotate(${eq.rotate}deg)`;
  document.body.append(span);
}

interface CatalogEntry {
  href: string | null;
  title: string;
  ready: boolean;
  about: string;
}

const CATALOG: Record<string, CatalogEntry> = {
  '2d': {
    href: 'graph.html?mode=2d',
    title: '2D grapher',
    ready: true,
    about: 'Plot y=f(x), x=g(y), polar and implicit equations, with draggable parameters. Supports the full graphing toolset once open.',
  },
  '3d': {
    href: 'graph.html?mode=3d',
    title: '3D surface plotter',
    ready: true,
    about: 'Plot z=f(x,y) surfaces with an orbitable camera. Supports the full graphing toolset once open.',
  },
  circuits: {
    href: 'circuit.html',
    title: 'Circuit simulator',
    ready: true,
    about: 'Build beginner DC circuits from batteries, resistors, LEDs, lamps and switches. Place parts, wire them pin to pin, flip switches, and read the live current and voltage. Supports the full circuit toolset once open.',
  },
  physics: {
    href: null,
    title: 'Physics sandbox',
    ready: false,
    about: 'Not built yet. For kinematics and oscillation today, open the 2D grapher and load the projectile, damped_oscillator or wave_beats lesson.',
  },
  chemistry: {
    href: null,
    title: 'Chemistry sandbox',
    ready: false,
    about: 'Not built yet.',
  },
};

// The unavailable tiles say so rather than failing silently on click.
for (const button of document.querySelectorAll<HTMLElement>('.tool.soon')) {
  button.addEventListener('click', () => {
    const entry = CATALOG[button.dataset.tool ?? ''];
    const foot = document.getElementById('foot');
    if (entry && foot) foot.textContent = `${entry.title} — ${entry.about}`;
  });
}

const TOOLS: WebMcpTool[] = [
  {
    name: 'list_learning_tools',
    description:
      'List the learning tools this site offers, which of them are built yet, and the page each one lives on. Call this before open_tool if you are not sure which tool fits what the student is asking about.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      ok: true,
      tools: Object.entries(CATALOG).map(([id, tool]) => ({
        id, title: tool.title, available: tool.ready, about: tool.about,
      })),
    }),
  },
  {
    name: 'open_tool',
    description:
      'Navigate the browser to one of this site\'s learning tools. Use "2d" for curves in the plane (y=f(x), polar, implicit equations) and "3d" for surfaces z=f(x,y). The page that opens registers the full graphing toolset -- plotting, sliders, animation, feature-finding and annotation -- so call this first, then work there. "circuits" and "physics" are not built yet: this returns ok:false naming the 2D lesson that covers the topic today, so suggest that instead of telling the student it is impossible.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          enum: Object.keys(CATALOG),
          description: 'Which tool to open.',
        },
      },
      required: ['tool'],
    },
    execute: async (args) => {
      const tool = String(args.tool ?? '');
      const entry = CATALOG[tool];
      if (!entry) {
        return { ok: false, error: `Unknown tool "${tool}". Available: ${Object.keys(CATALOG).join(', ')}.` };
      }
      if (!entry.ready || !entry.href) {
        return { ok: false, error: `${entry.title} is not built yet. ${entry.about}` };
      }
      window.location.href = entry.href;
      return { ok: true, opened: tool, title: entry.title, url: entry.href };
    },
  },
];

const host = document.modelContext ?? navigator.modelContext ?? null;
if (host) {
  try {
    if (typeof host.registerTool === 'function') {
      for (const tool of TOOLS) host.registerTool(tool);
    } else if (typeof host.provideContext === 'function') {
      host.provideContext({ tools: TOOLS });
    }
  } catch (err) {
    console.error('[webmcp] menu registration failed:', err);
  }
}
