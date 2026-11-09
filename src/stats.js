// Graf síly armád v čase jako SVG řetězec (čistá funkce bez DOM, testovatelná).
import { PLAYERS } from './rules.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// history: [{ turn, power: [p0, p1], ... }]; metric: 'power' | 'cities' | 'gold'
export function chartSvg(history, { metric = 'power', width = 256, height = 150, title = 'Síla armád' } = {}) {
  const pad = { l: 30, r: 8, t: 22, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const pts = history.filter((e) => Array.isArray(e[metric]));
  const maxV = Math.max(1, ...pts.flatMap((e) => e[metric]));
  const t0 = pts.length ? pts[0].turn : 1;
  const t1 = pts.length ? pts[pts.length - 1].turn : 1;
  const x = (turn) => pad.l + (t1 === t0 ? w / 2 : ((turn - t0) / (t1 - t0)) * w);
  const y = (v) => pad.t + h - (v / maxV) * h;
  const lines = PLAYERS.map((p, i) => {
    const coords = pts.map((e) => `${x(e.turn).toFixed(1)},${y(e[metric][i]).toFixed(1)}`).join(' ');
    return `<polyline points="${coords}" fill="none" stroke="${p.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
  });
  const legend = PLAYERS.map((p, i) =>
    `<rect x="${pad.l + i * 56}" y="5" width="10" height="10" fill="${p.color}"/>`
    + `<text x="${pad.l + i * 56 + 14}" y="14">${esc(p.name)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <line x1="${pad.l}" y1="${pad.t + h}" x2="${pad.l + w}" y2="${pad.t + h}" class="axis"/>
  <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + h}" class="axis"/>
  <text x="${pad.l - 4}" y="${pad.t + 4}" text-anchor="end">${maxV}</text>
  <text x="${pad.l - 4}" y="${pad.t + h}" text-anchor="end">0</text>
  <text x="${pad.l}" y="${height - 6}">kolo ${t0}</text>
  <text x="${pad.l + w}" y="${height - 6}" text-anchor="end">kolo ${t1}</text>
  ${legend}
  ${lines.join('\n  ')}
</svg>`;
}

// Souhrn pro konec hry: řádky tabulky [popisek, hodnota hráče 0, hodnota hráče 1].
export function summaryRows(state) {
  const st = state.stats || { kills: [0, 0], losses: [0, 0], captures: [0, 0] };
  const peak = (i) => Math.max(0, ...(state.history || []).map((e) => e.power[i]));
  return [
    ['Zničené jednotky', st.kills[0], st.kills[1]],
    ['Ztracené jednotky', st.losses[0], st.losses[1]],
    ['Dobytá města', st.captures[0], st.captures[1]],
    ['Největší síla armády', peak(0), peak(1)],
  ];
}
