// Army strength over time chart as an SVG string (pure function without DOM, testable).
import { PLAYERS, UNIT_TYPES, RANKS } from './rules.js';
import { hallOfFame } from './game.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// history: [{ turn, power: [p0, p1], ... }]; metric: 'power' | 'cities' | 'gold'
export function chartSvg(history, { metric = 'power', width = 256, height = 150, title = 'Army strength' } = {}) {
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
  <text x="${pad.l}" y="${height - 6}">turn ${t0}</text>
  <text x="${pad.l + w}" y="${height - 6}" text-anchor="end">turn ${t1}</text>
  ${legend}
  ${lines.join('\n  ')}
</svg>`;
}

// End-of-game summary: table rows [label, player 0 value, player 1 value].
export function summaryRows(state) {
  const st = state.stats || { kills: [0, 0], losses: [0, 0], captures: [0, 0] };
  const peak = (i) => Math.max(0, ...(state.history || []).map((e) => e.power[i]));
  return [
    ['Units destroyed', st.kills[0], st.kills[1]],
    ['Units lost', st.losses[0], st.losses[1]],
    ['Cities captured', st.captures[0], st.captures[1]],
    ['Peak army strength', peak(0), peak(1)],
  ];
}

// Hall of fame: each side's best units (named heroes and anyone with kills) as an HTML string.
export function hallOfFameHtml(state) {
  const fate = (h) => (h.fate === 'alive' ? '' : h.fate === 'fell' ? ` · fell in turn ${h.turn}` : ` · disbanded in turn ${h.turn}`);
  const sides = PLAYERS.map((p, i) => {
    // the enemy's heroes stay secret until the game is over (they would give away its army)
    if (PLAYERS[i].isAI && state.winner === null) {
      return `<div class="hall-side"><h5 style="color:${p.color}">${esc(p.name)}</h5><p class="hint">Revealed when the game ends.</p></div>`;
    }
    const rows = hallOfFame(state, i).map((h) => {
      const type = UNIT_TYPES[h.type].name;
      const who = h.name ? `<b>${esc(h.name)}</b> <small>${type}</small>` : `<b>${type}</b>`;
      const rank = RANKS[h.rank].symbol ? ` ${RANKS[h.rank].symbol}` : '';
      return `<li class="${h.fate === 'alive' ? '' : 'gone'}">${who}${rank}<small> · ${h.kills} kill${h.kills === 1 ? '' : 's'}${fate(h)}</small></li>`;
    });
    return `<div class="hall-side"><h5 style="color:${p.color}">${esc(p.name)}</h5>`
      + (rows.length ? `<ol>${rows.join('')}</ol>` : '<p class="hint">No heroes yet.</p>') + '</div>';
  });
  return `<div class="hall">${sides.join('')}</div>`;
}
