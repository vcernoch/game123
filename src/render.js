// Vykreslení na canvas. Žádná herní logika, jen kreslení stavu.
import { hexToPixel, hexCorners, pixelToHex, key } from './hex.js';
import { TERRAIN, UNIT_TYPES, PLAYERS, NEUTRAL_COLOR } from './rules.js';

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
//          unitPos: Map(unitId -> {x,y}) pro animace, floaters: [{x,y,text,color,age}] }
export function render(ctx, state, view = {}) {
  const { w, h } = canvasSize(state);
  ctx.clearRect(0, 0, w, h);

  for (const t of Object.values(state.tiles)) {
    const c = tileCenter(t.q, t.r);
    hexPath(ctx, c.x, c.y, HEX_SIZE - 1);
    ctx.fillStyle = TERRAIN[t.terrain].color;
    ctx.fill();
    drawTerrainDetail(ctx, t.terrain, c.x, c.y);
    if (view.reachable && view.reachable.has(key(t.q, t.r))) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (view.hover && state.tiles[key(view.hover.q, view.hover.r)]) {
    const c = tileCenter(view.hover.q, view.hover.r);
    hexPath(ctx, c.x, c.y, HEX_SIZE - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const city of state.cities) drawCity(ctx, city);

  if (view.path && view.path.length > 1) drawPath(ctx, view.path);

  // animované jednotky kreslíme až nakonec, aby byly nad ostatními
  const moving = view.unitPos || new Map();
  const units = [...state.units].sort((a, b) => moving.has(a.id) - moving.has(b.id));
  for (const u of units) {
    const c = moving.get(u.id) || tileCenter(u.q, u.r);
    drawUnit(ctx, u, c.x, c.y, u.id === view.selectedId, state.current === u.owner);
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

// Plovoucí text (poškození, dobytí): stoupá a mizí, age je 0..1.
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

// Trasa pohybu: lomená čára přes středy polí se šipkou v cíli.
function drawPath(ctx, path) {
  const pts = path.map((p) => tileCenter(p.q, p.r));
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
  // čára končí kousek před středem, aby hrot šipky byl ostrý
  const tip = { x: end.x - Math.cos(ang) * 4, y: end.y - Math.sin(ang) * 4 };
  const base = { x: tip.x - Math.cos(ang) * 12, y: tip.y - Math.sin(ang) * 12 };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [color, width] of [['rgba(0,0,0,0.45)', 7], ['#ffe27a', 4]]) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(base.x, base.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
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
  // tečky na mezilehlých polích
  ctx.fillStyle = '#ffe27a';
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
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
  // domečky
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
  ctx.restore();
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
  // HP lišta
  const frac = u.hp / t.hp;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 13, y + 18, 26, 4);
  ctx.fillStyle = frac > 0.5 ? '#5ad65a' : frac > 0.25 ? '#e5c33a' : '#e04848';
  ctx.fillRect(x - 13, y + 18, 26 * frac, 4);
  // vyčerpaná jednotka aktivního hráče
  if (active && u.movesLeft === 0 && u.hasAttacked) {
    ctx.beginPath();
    ctx.arc(x, y + 3, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
  }
  ctx.restore();
}
