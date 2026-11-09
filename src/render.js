// Canvas rendering. No game logic, only drawing the state.
import { hexToPixel, hexCorners, pixelToHex, key, neighbors, DIRS } from './hex.js';
import { TERRAIN, UNIT_TYPES, PLAYERS, NEUTRAL_COLOR, RANKS } from './rules.js';
import { territoryMap } from './game.js';

export const HEX_SIZE = 32;
const PAD = 8;

export function canvasSize(state) {
  const w = Math.sqrt(3) * HEX_SIZE * (state.cols + 0.5) + PAD * 2;
  const h = 1.5 * HEX_SIZE * (state.rows - 1) + 2 * HEX_SIZE + PAD * 2;
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

function origin() {
  return { x: (Math.sqrt(3) / 2) * HEX_SIZE + PAD, y: HEX_SIZE + PAD };
}

export function tileCenter(q, r) {
  const o = origin();
  const p = hexToPixel(q, r, HEX_SIZE);
  return { x: p.x + o.x, y: p.y + o.y };
}

export function pickHex(x, y) {
  const o = origin();
  return pixelToHex(x - o.x, y - o.y, HEX_SIZE);
}

function hexPath(ctx, cx, cy, size) {
  const pts = hexCorners(cx, cy, size);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

// view = { selectedId, reachable: Map, targets: Set(unitId), hover: {q,r}, path: [{q,r}],
//          unitPos: Map(unitId -> {x,y}) for animations, floaters: [{x,y,text,color,age}],
//          visible/explored: Set of keys for fog of war (missing = everything visible), viewer: player at the screen }
export function render(ctx, state, view = {}) {
  const { w, h } = canvasSize(state);
  ctx.clearRect(0, 0, w, h);

  const seen = (q, r) => !view.visible || view.visible.has(key(q, r));
  const known = (q, r) => !view.explored || view.explored.has(key(q, r));
  const zocStops = [];

  for (const t of Object.values(state.tiles)) {
    const c = tileCenter(t.q, t.r);
    hexPath(ctx, c.x, c.y, HEX_SIZE - 1);
    if (known(t.q, t.r)) {
      ctx.fillStyle = TERRAIN[t.terrain].color;
      ctx.fill();
      drawTerrainDetail(ctx, t.terrain, c.x, c.y);
      if (t.road) drawRoad(ctx, state, t, c);
      if (t.resource) drawResource(ctx, t.resource, c.x + 13, c.y - 12);
      // terrain detail draws its own paths – the hex outline must be rebuilt
      hexPath(ctx, c.x, c.y, HEX_SIZE - 1);
      if (!seen(t.q, t.r)) {
        ctx.fillStyle = 'rgba(12,14,22,0.5)';
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#2a2f3a';
      ctx.fill();
    }
    const canReach = view.reachable && view.reachable.has(key(t.q, t.r));
    if (canReach) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // reachable tile in an enemy zone of control: the move ends here
    if (canReach && view.zoc && view.zoc.has(key(t.q, t.r))) zocStops.push(c);
  }

  drawBorders(ctx, state, known);
  drawRivers(ctx, state, known, seen);
  if (view.threats) drawThreats(ctx, view.threats);
  for (const c of zocStops) drawZocStop(ctx, c.x, c.y + HEX_SIZE * 0.45);

  if (view.hover && state.tiles[key(view.hover.q, view.hover.r)]) {
    const c = tileCenter(view.hover.q, view.hover.r);
    hexPath(ctx, c.x, c.y, HEX_SIZE - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const city of state.cities) if (known(city.q, city.r)) drawCity(ctx, city);

  if (view.path && view.path.length > 1) drawPath(ctx, view.path, view.pathTurns, view.pathFaint);

  // animated units are drawn last so they sit on top
  const moving = view.unitPos || new Map();
  const units = [...state.units].sort((a, b) => moving.has(a.id) - moving.has(b.id));
  for (const u of units) {
    const c = moving.get(u.id) || tileCenter(u.q, u.r);
    // enemy units in fog are not drawn (when animating, by the tile they are on right now)
    if (view.visible && u.owner !== view.viewer) {
      const at = moving.has(u.id) ? pickHex(c.x, c.y) : u;
      if (!seen(at.q, at.r)) continue;
    }
    drawUnit(ctx, u, c.x, c.y, u.id === view.selectedId, state.current === u.owner && state.winner === null);
    if (view.targets && view.targets.has(u.id)) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, HEX_SIZE * 0.72, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffdd33';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  for (const f of view.floaters || []) drawFloater(ctx, f);
}

// Floating text (damage, capture): rises and fades, age is 0..1.
function drawFloater(ctx, f) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - f.age);
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = f.y - 14 - f.age * 22;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(f.text, f.x, y);
  ctx.fillStyle = f.color;
  ctx.fillText(f.text, f.x, y);
  ctx.restore();
}

// Movement path: polyline through tile centers with an arrow at the end.
// turns = set for a multi-turn order: the line is dashed and the arrow shows the number of turns;
// faint = the selected unit's current order (drawn lighter).
function drawPath(ctx, path, turns = null, faint = false) {
  const pts = path.map((p) => tileCenter(p.q, p.r));
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
  // the line stops just short of the center so the arrow tip stays sharp
  const tip = { x: end.x - Math.cos(ang) * 4, y: end.y - Math.sin(ang) * 4 };
  const base = { x: tip.x - Math.cos(ang) * 12, y: tip.y - Math.sin(ang) * 12 };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (faint) ctx.globalAlpha = 0.6;
  if (turns) ctx.setLineDash([8, 6]);
  for (const [color, width] of [['rgba(0,0,0,0.45)', 7], ['#ffe27a', 4]]) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(base.x, base.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tip.x + Math.cos(ang) * 2, tip.y + Math.sin(ang) * 2);
  ctx.lineTo(base.x + Math.cos(ang + Math.PI / 2) * 8, base.y + Math.sin(ang + Math.PI / 2) * 8);
  ctx.lineTo(base.x + Math.cos(ang - Math.PI / 2) * 8, base.y + Math.sin(ang - Math.PI / 2) * 8);
  ctx.closePath();
  ctx.fillStyle = '#ffe27a';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  if (turns) {
    // number of turns in a badge next to the target
    const label = `${turns} turn${turns === 1 ? '' : 's'}`;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bx = end.x;
    const by = end.y - 20;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(20,22,30,0.85)';
    ctx.beginPath();
    ctx.roundRect(bx - w / 2, by - 9, w, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(label, bx, by + 1);
  } else {
    // dots on intermediate tiles
    ctx.fillStyle = '#ffe27a';
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Resource marker in the upper right of the tile: gold nuggets or a horseshoe.
function drawResource(ctx, kind, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.35, 1.35);
  ctx.translate(-x, -y);
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,22,30,0.8)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = kind === 'gold' ? '#f2c94c' : '#e8e2d0';
  ctx.stroke();
  if (kind === 'gold') {
    ctx.fillStyle = '#f2c94c';
    ctx.strokeStyle = '#7a5a10';
    ctx.lineWidth = 0.8;
    for (const [dx, dy, r] of [[-2.5, 1.5, 2.6], [2.5, 1.8, 2.3], [0, -2, 2.4]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy - r);
      ctx.lineTo(x + dx + r, y + dy + r * 0.7);
      ctx.lineTo(x + dx - r, y + dy + r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === 'horses') {
    // horseshoe: a thick U opening downwards
    ctx.strokeStyle = '#d9d4c7';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y + 0.5, 3.6, Math.PI * 0.95, Math.PI * 2.05);
    ctx.moveTo(x - 3.6, y + 0.8);
    ctx.lineTo(x - 3.2, y + 4);
    ctx.moveTo(x + 3.6, y + 0.8);
    ctx.lineTo(x + 3.2, y + 4);
    ctx.stroke();
  }
  ctx.restore();
}

// Roads: from each road tile, half a segment towards every neighboring road tile.
function drawRoad(ctx, state, t, c) {
  const ends = [];
  for (const n of neighbors(t.q, t.r)) {
    const nt = state.tiles[key(n.q, n.r)];
    if (!nt || !nt.road) continue;
    const nc = tileCenter(n.q, n.r);
    ends.push({ x: (c.x + nc.x) / 2, y: (c.y + nc.y) / 2 });
  }
  ctx.save();
  ctx.lineCap = 'round';
  for (const [color, width] of [['#6b4f2a', 6], ['#c9a66b', 3]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const e of ends) {
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
    }
    if (!ends.length) ctx.arc(c.x, c.y, width / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Rivers along hex edges. Each edge is drawn once (from the tile with the smaller key, or
// when the neighbor is off the map). Bridge = road on both sides of the edge.
// City borders: on each territory tile, the edges towards a different territory (or none) are drawn
// slightly inset in the colour of the city's owner, so neighbouring borders sit side by side.
// Threat overlay: red shade on tiles enemies could attack next turn, stronger with more attackers.
function drawThreats(ctx, threats) {
  ctx.save();
  for (const [k, n] of threats) {
    const [q, r] = k.split(',').map(Number);
    const c = tileCenter(q, r);
    hexPath(ctx, c.x, c.y, HEX_SIZE - 3);
    ctx.fillStyle = `rgba(225,40,40,${Math.min(0.5, 0.22 + 0.12 * (n - 1))})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,90,90,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// A small stop sign (octagon with a white bar) low in the tile: "the move ends here".
function drawZocStop(ctx, x, y) {
  const r = Math.max(5, HEX_SIZE * 0.2);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = '#c62f2f';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - r * 0.55, y - r * 0.15, r * 1.1, r * 0.3);
  ctx.restore();
}

function drawBorders(ctx, state, known) {
  const terr = territoryMap(state);
  const owner = new Map(state.cities.map((c) => [c.id, c.owner]));
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 3]); // dashed, so borders can't be mistaken for rivers (solid double lines)
  for (const [k, cityId] of terr) {
    const t = state.tiles[k];
    if (!known(t.q, t.r)) continue;
    const who = owner.get(cityId);
    const c = tileCenter(t.q, t.r);
    if (who !== null) {
      // a light tint of the owner's colour over the whole realm
      hexPath(ctx, c.x, c.y, HEX_SIZE - 1);
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = PLAYERS[who].color;
      ctx.fill();
    }
    const corners = hexCorners(c.x, c.y, HEX_SIZE - 3);
    ctx.strokeStyle = who === null ? NEUTRAL_COLOR : PLAYERS[who].color;
    ctx.globalAlpha = who === null ? 0.7 : 0.95;
    for (let d = 0; d < 6; d++) {
      const nId = terr.get(key(t.q + DIRS[d][0], t.r + DIRS[d][1]));
      if (nId !== undefined && owner.get(nId) === who) continue; // same owner – no border inside the realm
      // direction d points at angle −60·d°, the edge lies between corners (6−d)%6 and (7−d)%6
      const p1 = corners[(6 - d) % 6];
      const p2 = corners[(7 - d) % 6];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRivers(ctx, state, known, seen) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const t of Object.values(state.tiles)) {
    if (!t.rivers) continue;
    const c = tileCenter(t.q, t.r);
    const corners = hexCorners(c.x, c.y, HEX_SIZE);
    for (const d of t.rivers) {
      const n = { q: t.q + DIRS[d][0], r: t.r + DIRS[d][1] };
      const nk = key(n.q, n.r);
      const nt = state.tiles[nk];
      if (nt && nk < key(t.q, t.r)) continue;
      if (!known(t.q, t.r) && !(nt && known(n.q, n.r))) continue;
      const lit = seen(t.q, t.r) || (nt && seen(n.q, n.r));
      // direction d points at angle −60·d°, the edge lies between corners (6−d)%6 and (7−d)%6
      const p1 = corners[(6 - d) % 6];
      const p2 = corners[(7 - d) % 6];
      ctx.globalAlpha = lit ? 1 : 0.55;
      for (const [color, width] of [['#1f4f86', 6], ['#5fa8e8', 3.5]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      if (t.road && nt && nt.road) drawBridge(ctx, p1, p2);
    }
  }
  ctx.restore();
}

function drawBridge(ctx, p1, p2) {
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  ctx.fillStyle = '#8a6a3c';
  ctx.strokeStyle = '#4a3418';
  ctx.lineWidth = 1;
  ctx.fillRect(-5, -7, 10, 14);
  ctx.strokeRect(-5, -7, 10, 14);
  ctx.restore();
}

function drawTerrainDetail(ctx, terrain, x, y) {
  ctx.save();
  if (terrain === 'forest') {
    ctx.fillStyle = 'rgba(20,50,20,0.55)';
    for (const [dx, dy] of [[-9, 4], [0, -6], [9, 4]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy - 8);
      ctx.lineTo(x + dx - 6, y + dy + 4);
      ctx.lineTo(x + dx + 6, y + dy + 4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (terrain === 'hills') {
    ctx.strokeStyle = 'rgba(80,60,30,0.6)';
    ctx.lineWidth = 2;
    for (const dx of [-8, 8]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + 6, 8, Math.PI, 0);
      ctx.stroke();
    }
  } else if (terrain === 'mountain') {
    ctx.fillStyle = 'rgba(60,55,55,0.8)';
    ctx.beginPath();
    ctx.moveTo(x - 14, y + 10);
    ctx.lineTo(x - 3, y - 12);
    ctx.lineTo(x + 3, y - 2);
    ctx.lineTo(x + 7, y - 8);
    ctx.lineTo(x + 15, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x - 3, y - 12);
    ctx.lineTo(x, y - 7);
    ctx.closePath();
    ctx.fill();
  } else if (terrain === 'water') {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    for (const dy of [-5, 5]) {
      ctx.beginPath();
      ctx.moveTo(x - 10, y + dy);
      ctx.quadraticCurveTo(x - 5, y + dy - 4, x, y + dy);
      ctx.quadraticCurveTo(x + 5, y + dy + 4, x + 10, y + dy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCity(ctx, city) {
  const c = tileCenter(city.q, city.r);
  const color = city.owner === null ? NEUTRAL_COLOR : PLAYERS[city.owner].color;
  ctx.save();
  hexPath(ctx, c.x, c.y, HEX_SIZE - 4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  // houses
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  const houses = city.capital ? [[-10, -14], [0, -18], [10, -14]] : [[-6, -14], [6, -14]];
  for (const [dx, dy] of houses) {
    const x = c.x + dx;
    const y = c.y + dy;
    ctx.beginPath();
    ctx.rect(x - 4, y, 8, 6);
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x, y - 5);
    ctx.lineTo(x + 5, y);
    ctx.fill();
    ctx.stroke();
  }
  drawBuildings(ctx, city, c.x, c.y);
  ctx.restore();
}

// Small building markers: walls = stone rim, market = coin, barracks = flag, watchtower = tower,
// temple = sun, infirmary = red cross, academy = blue star.
function drawBuildings(ctx, city, x, y) {
  const has = (b) => city.buildings && city.buildings.includes(b);
  if (has('walls')) {
    hexPath(ctx, x, y, HEX_SIZE - 8);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#d9d4c7';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (has('market')) {
    ctx.beginPath();
    ctx.arc(x - 19, y + 9, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f2c94c';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
  if (has('barracks')) {
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 17, y + 14);
    ctx.lineTo(x + 17, y + 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 17, y + 2);
    ctx.lineTo(x + 25, y + 5);
    ctx.lineTo(x + 17, y + 8);
    ctx.closePath();
    ctx.fillStyle = '#e04848';
    ctx.fill();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  if (has('watchtower')) {
    // a narrow stone tower with battlements, left of the houses
    const tx = x - 23;
    const ty = y - 4;
    ctx.fillStyle = '#c9c2b2';
    ctx.beginPath();
    ctx.rect(tx - 2.5, ty - 6, 5, 11);
    ctx.rect(tx - 4, ty - 9, 8, 3);
    ctx.fill();
    ctx.stroke();
  }
  if (has('temple')) {
    // a small sun
    const tx = x + 23;
    const ty = y - 4;
    ctx.beginPath();
    ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd34d';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(a) * 5, ty + Math.sin(a) * 5);
      ctx.lineTo(tx + Math.cos(a) * 7, ty + Math.sin(a) * 7);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  }
  if (has('infirmary')) {
    // a red cross on white
    const tx = x - 17;
    const ty = y + 21;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 4.5, ty - 4.5, 9, 9);
    ctx.strokeRect(tx - 4.5, ty - 4.5, 9, 9);
    ctx.fillStyle = '#d83a3a';
    ctx.fillRect(tx - 1.2, ty - 3.5, 2.4, 7);
    ctx.fillRect(tx - 3.5, ty - 1.2, 7, 2.4);
  }
  if (has('academy')) {
    // a blue star (veterans are trained here)
    const tx = x + 17;
    const ty = y + 21;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 2.2 : 5;
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      ctx.lineTo(tx + Math.cos(a) * r, ty + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#7fb2ff';
    ctx.fill();
    ctx.stroke();
  }
}

function drawShield(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 5);
  ctx.lineTo(x + 5, y - 5);
  ctx.lineTo(x + 5, y);
  ctx.quadraticCurveTo(x + 4, y + 4, x, y + 6);
  ctx.quadraticCurveTo(x - 4, y + 4, x - 5, y);
  ctx.closePath();
  ctx.fillStyle = '#d9e4f2';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
}

function drawUnit(ctx, u, x, y, selected, active) {
  const t = UNIT_TYPES[u.type];
  const p = PLAYERS[u.owner];
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y + 3, 13, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.symbol, x, y + 4);
  // rank: gold stars above the unit
  let rank = 0;
  RANKS.forEach((r, i) => { if ((u.xp || 0) >= r.xp) rank = i; });
  if (rank > 0) {
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(RANKS[rank].symbol, x, y - 13);
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(RANKS[rank].symbol, x, y - 13);
  }
  // fortified: a small shield at the bottom right
  if (u.fortified) drawShield(ctx, x + 11, y + 10);
  // HP bar
  const frac = u.hp / t.hp;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 13, y + 18, 26, 4);
  ctx.fillStyle = frac > 0.5 ? '#5ad65a' : frac > 0.25 ? '#e5c33a' : '#e04848';
  ctx.fillRect(x - 13, y + 18, 26 * frac, 4);
  // exhausted unit of the active player
  if (active && u.movesLeft === 0 && u.hasAttacked) {
    ctx.beginPath();
    ctx.arc(x, y + 3, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
  }
  ctx.restore();
}
