import { key, neighbors, offsetToAxial, distance, DIRS } from './hex.js';
import { createRng } from './rng.js';
import { TERRAIN, CITY_NAMES, RIVER } from './rules.js';

// Vygeneruje mapu: obdélník cols × rows v "odd-r" offsetu.
// Vrací { tiles, cities, starts } – bez jednotek.
export function generateMap(seed, cols, rows, neutralCities = 4) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = tryGenerate(seed + attempt * 7919, cols, rows, neutralCities);
    if (result) return result;
  }
  throw new Error('Nepodařilo se vygenerovat propojenou mapu');
}

function smoothField(field, cols, rows, passes) {
  let f = field;
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let row = 0; row < rows; row++) {
      next[row] = [];
      for (let col = 0; col < cols; col++) {
        let sum = f[row][col] * 2;
        let n = 2;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const rr = row + dr;
            const cc = col + dc;
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
              sum += f[rr][cc];
              n++;
            }
          }
        }
        next[row][col] = sum / n;
      }
    }
    f = next;
  }
  return f;
}

function randomField(rng, cols, rows) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng.next()));
}

function tryGenerate(seed, cols, rows, neutralCount) {
  const rng = createRng(seed);
  const height = smoothField(randomField(rng, cols, rows), cols, rows, 2);
  const veg = smoothField(randomField(rng, cols, rows), cols, rows, 2);

  const tiles = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { q, r } = offsetToAxial(col, row);
      const h = height[row][col];
      const v = veg[row][col];
      let terrain = 'plains';
      if (h < 0.36) terrain = 'water';
      else if (h > 0.66) terrain = 'mountain';
      else if (h > 0.58) terrain = 'hills';
      else if (v > 0.56) terrain = 'forest';
      tiles[key(q, r)] = { q, r, col, row, terrain };
    }
  }

  const midRow = Math.floor(rows / 2);
  const starts = [offsetToAxial(1, midRow), offsetToAxial(cols - 2, midRow)];

  // Okolí startů srovnat na pláně, ať se dá hned hrát.
  for (const s of starts) {
    tiles[key(s.q, s.r)].terrain = 'plains';
    for (const n of neighbors(s.q, s.r)) {
      const t = tiles[key(n.q, n.r)];
      if (t && !TERRAIN[t.terrain].passable) t.terrain = 'plains';
    }
  }

  if (!pathExists(tiles, starts[0], starts[1])) return null;

  const cities = [
    { id: 1, q: starts[0].q, r: starts[0].r, owner: 0, capital: true, name: 'Tvoje hlavní město' },
    { id: 2, q: starts[1].q, r: starts[1].r, owner: 1, capital: true, name: 'Nepřátelská pevnost' },
  ];

  const candidates = Object.values(tiles).filter(
    (t) => TERRAIN[t.terrain].passable && t.terrain !== 'hills' && pathExists(tiles, starts[0], t),
  );
  const names = [...CITY_NAMES];
  let guard = 0;
  while (cities.length < 2 + neutralCount && guard++ < 500) {
    const t = rng.pick(candidates);
    if (cities.every((c) => distance(c, t) >= 3)) {
      const name = names.splice(rng.int(0, names.length - 1), 1)[0];
      cities.push({ id: cities.length + 1, q: t.q, r: t.r, owner: null, capital: false, name });
    }
  }
  if (cities.length < 2 + neutralCount) return null;

  buildRoads(tiles, cities);
  // řeky mají vlastní RNG, aby nezměnily rozložení terénu a měst pro dané seedy
  buildRivers(tiles, height, cols, rows, createRng(seed * 31 + 17));
  return { tiles, cities, starts };
}

// Silnice: minimální kostra mezi městy, každý úsek vede nejlevnější cestou terénem.
function buildRoads(tiles, cities) {
  const connected = [cities[0]];
  const rest = cities.slice(1);
  while (rest.length) {
    let best = null;
    for (const a of connected) {
      for (const b of rest) {
        const p = cheapestPath(tiles, a, b);
        if (p && (!best || p.cost < best.cost)) best = { ...p, b };
      }
    }
    if (!best) break;
    for (const k of best.path) tiles[k].road = true;
    connected.push(best.b);
    rest.splice(rest.indexOf(best.b), 1);
  }
}

// ---------- řeky ----------
// Řeka je řetěz hran mezi sousedními poli. Hrana (A, B) má dva koncové vrcholy; v každém se
// potká se třetím polem C (společný soused A i B). Z vrcholu může řeka pokračovat po hraně
// (A, C), nebo (B, C). Řeka teče z kopců/hor „z kopce“ podle výškového pole, dokud nedojde
// do vody, na okraj mapy, do jiné řeky, nebo nepřekročí maximální délku.

// Směr z a do b (index do DIRS), nebo -1, když nejsou sousedé.
export function dirTo(a, b) {
  return DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

// Dva společní sousedé sousedních polí a, b.
function commonNeighbors(a, b) {
  const d = dirTo(a, b);
  return [DIRS[(d + 5) % 6], DIRS[(d + 1) % 6]].map(([dq, dr]) => ({ q: a.q + dq, r: a.r + dr }));
}

export function hasRiverEdge(tiles, a, b) {
  const t = tiles[key(a.q, a.r)];
  return !!(t && t.rivers && t.rivers.includes(dirTo(a, b)));
}

function addRiverEdge(tiles, a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const t = tiles[key(x.q, x.r)];
    if (!t) continue;
    if (!t.rivers) t.rivers = [];
    t.rivers.push(dirTo(x, y));
  }
}

function buildRivers(tiles, height, cols, rows, rng) {
  const h = (p) => {
    const t = tiles[key(p.q, p.r)];
    if (!t) return -1; // za okrajem mapy je „moře“
    return t.terrain === 'water' ? -0.5 : height[t.row][t.col];
  };
  const ends = (p) => { const t = tiles[key(p.q, p.r)]; return !t || t.terrain === 'water'; };
  const sources = Object.values(tiles).filter((t) => t.terrain === 'hills' || t.terrain === 'mountain');
  const wanted = Math.max(1, Math.round((cols * rows) / RIVER.perTiles));
  let made = 0;
  for (let attempt = 0; attempt < 40 && made < wanted && sources.length; attempt++) {
    const src = rng.pick(sources);
    const d = rng.int(0, 5);
    let a = { q: src.q, r: src.r };
    let b = { q: src.q + DIRS[d][0], r: src.r + DIRS[d][1] };
    if (ends(b) || hasRiverEdge(tiles, a, b)) continue;
    // vrchol, ke kterému řeka teče: nižší ze dvou společných sousedů
    let [c1, c2] = commonNeighbors(a, b);
    let c = h(c1) <= h(c2) ? c1 : c2;
    const edges = [];
    const used = new Set();
    const edgeKey = (x, y) => [key(x.q, x.r), key(y.q, y.r)].sort().join('|');
    while (edges.length < RIVER.maxLength) {
      edges.push([a, b]);
      used.add(edgeKey(a, b));
      if (ends(c)) break; // vrchol na pobřeží / okraji – řeka ústí
      // pokračování (a, c) s dalším vrcholem mimo b, nebo (b, c) s dalším vrcholem mimo a
      const opts = [[a, c, b], [b, c, a]].map(([x, y, back]) => {
        const next = commonNeighbors(x, y).find((p) => p.q !== back.q || p.r !== back.r);
        return { x, y, next, score: h(x) + h(y) + h(next) + rng.next() * 0.08 };
      }).filter((o) => !used.has(edgeKey(o.x, o.y)));
      if (!opts.length) break;
      opts.sort((p, q) => p.score - q.score);
      const o = opts[0];
      if (hasRiverEdge(tiles, o.x, o.y)) break; // vlévá se do jiné řeky
      [a, b, c] = [o.x, o.y, o.next];
    }
    if (edges.length < RIVER.minLength) continue;
    for (const [x, y] of edges) addRiverEdge(tiles, x, y);
    made++;
  }
}

// Dijkstra po průchodném terénu; po už postavené silnici je to levnější (silnice se slévají).
function cheapestPath(tiles, from, to) {
  const start = key(from.q, from.r);
  const goal = key(to.q, to.r);
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const open = [start];
  while (open.length) {
    open.sort((a, b) => dist.get(a) - dist.get(b) || (a < b ? -1 : 1));
    const cur = open.shift();
    if (cur === goal) break;
    const t = tiles[cur];
    for (const n of neighbors(t.q, t.r)) {
      const k = key(n.q, n.r);
      const nt = tiles[k];
      if (!nt || !TERRAIN[nt.terrain].passable) continue;
      const d = dist.get(cur) + (nt.road ? 0.5 : TERRAIN[nt.terrain].cost);
      if (dist.has(k) && dist.get(k) <= d) continue;
      dist.set(k, d);
      prev.set(k, cur);
      open.push(k);
    }
  }
  if (!dist.has(goal)) return null;
  const path = [];
  for (let k = goal; k !== undefined; k = prev.get(k)) path.push(k);
  return { path, cost: dist.get(goal) };
}

export function pathExists(tiles, from, to) {
  const start = key(from.q, from.r);
  const goal = key(to.q, to.r);
  const seen = new Set([start]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (key(cur.q, cur.r) === goal) return true;
    for (const n of neighbors(cur.q, cur.r)) {
      const k = key(n.q, n.r);
      const t = tiles[k];
      if (!t || seen.has(k) || !TERRAIN[t.terrain].passable) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return false;
}
