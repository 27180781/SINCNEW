// ============================================================
//  גרף טבעת (Donut) ב-SVG — ללא ספריות חיצוניות, בצבעי היסודות
//  משתמש בטכניקת stroke-dasharray כדי לתמוך גם ב-100% ביסוד יחיד.
// ============================================================
import { safeColor } from './api.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
}

/**
 * entries: [{ label, value, color, emoji }]  (value = אחוז)
 * opts: { size, thickness, centerMain, centerSub }
 * מחזיר אלמנט <svg>.
 */
export function donut(entries, opts = {}) {
  const size = opts.size || 260;
  const cx = size / 2, cy = size / 2;
  const thickness = opts.thickness || Math.round(size * 0.17);
  const midR = size / 2 - thickness / 2 - 4;
  const C = 2 * Math.PI * midR;
  const total = entries.reduce((s, e) => s + Math.max(0, Number(e.value) || 0), 0);

  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: 'auto', role: 'img', 'aria-label': 'פילוח יסודות' });
  svg.style.maxWidth = size + 'px';

  const g = svgEl('g', { transform: `rotate(-90 ${cx} ${cy})` });
  // טבעת רקע
  g.appendChild(svgEl('circle', { cx, cy, r: midR, fill: 'none', stroke: '#eef0f6', 'stroke-width': thickness }));

  let offset = 0;
  for (const e of entries) {
    const val = Math.max(0, Number(e.value) || 0);
    const frac = total > 0 ? val / total : 0;
    if (frac <= 0) continue;
    const len = frac * C;
    g.appendChild(svgEl('circle', {
      cx, cy, r: midR, fill: 'none',
      stroke: safeColor(e.color), 'stroke-width': thickness,
      'stroke-dasharray': `${len} ${C - len}`,
      'stroke-dashoffset': -offset,
      'stroke-linecap': 'butt',
    }));
    offset += len;
  }
  svg.appendChild(g);

  // טקסט מרכזי
  if (opts.centerMain != null) {
    const t1 = svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': Math.round(size * 0.12), 'font-weight': '800', fill: '#1e2233' });
    t1.textContent = String(opts.centerMain);
    svg.appendChild(t1);
  }
  if (opts.centerSub != null) {
    const t2 = svgEl('text', { x: cx, y: cy + Math.round(size * 0.11), 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': Math.round(size * 0.065), fill: '#6b7280' });
    t2.textContent = String(opts.centerSub);
    svg.appendChild(t2);
  }
  return svg;
}
