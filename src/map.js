import { key, neighbors, offsetToAxial, distance, DIRS } from './hex.js';
import { createRng } from './rng.js';
import { TERRAIN, CITY_NAMES, RIVER, TERRITORY, RUINS } from './rules.js';

// Generates a map: a cols × rows rectangle in "odd-r" offset.
// Returns { tiles, cities, starts } – without units.
export function generateMap(seed, cols, rows, neutralCities = 4) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = tryGenerate(seed + attempt * 7919, cols, rows, neutralCities);
    if (result) return result;
  }
  throw new Error('Failed to generate a connected map');
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

  // Flatten the surroundings of the starts to plains so play can begin right away.
  for (const s of starts) {
    tiles[key(s.q, s.r)].terrain = 'plains';
    for (const n of neighbors(s.q, s.r)) {
      const t = tiles[key(n.q, n.r)];
      if (t && !TERRAIN[t.terrain].passable) t.terrain = 'plains';
    }
  }

  if (!pathExists(tiles, starts[0], starts[1])) return null;

  const cities = [
    { id: 1, q: starts[0].q, r: starts[0].r, owner: 0, capital: true, name: 'Your Capital' },
    { id: 2, q: starts[1].q, r: starts[1].r, owner: 1, capital: true, name: 'Enemy Fortress' },
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
  // rivers have their own RNG so they don't change the terrain and city layout for given seeds
  buildRivers(tiles, height, cols, rows, createRng(seed * 31 + 17));
  placeResources(tiles, cities, createRng(seed * 53 + 5));
  placeRuins(tiles, cities, cols * rows, createRng(seed * 71 + 29));
  return { tiles, cities, starts };
}

// Resources (own RNG, so terrain, cities, roads and rivers stay the same for given seeds).
// For fairness both capitals get one gold mine and one horse pasture 2 tiles away; each neutral city
// gets one random resource with a 2 in 3 chance. Gold prefers hills, horses prefer plains.
function placeResources(tiles, cities, rng) {
  const taken = (t) => t.resource || cities.some((c) => c.q === t.q && c.r === t.r);
  const spots = (city, kind) => {
    const all = Object.values(tiles).filter((t) => {
      const d = distance(t, city);
      return d >= 1 && d <= TERRITORY.radius && TERRAIN[t.terrain].passable && !taken(t)
        && cities.every((c) => c === city || distance(t, c) > d); // clearly inside this city's territory
    });
    const liked = all.filter((t) => t.terrain === (kind === 'gold' ? 'hills' : 'plains'));
    return liked.length ? liked : all;
  };
  const put = (city, kind, preferDist = null) => {
    let options = spots(city, kind);
    if (preferDist !== null && options.some((t) => distance(t, city) === preferDist)) {
      options = options.filter((t) => distance(t, city) === preferDist);
    }
    if (options.length) rng.pick(options).resource = kind;
  };
  for (const city of cities) {
    if (city.capital) {
      put(city, 'gold', 2);
      put(city, 'horses', 2);
    } else if (rng.next() < 2 / 3) {
      put(city, rng.next() < 0.5 ? 'gold' : 'horses');
    }
  }
}

// Ancient ruins (own RNG, so everything else stays the same for given seeds). Placed in pairs: one tile
// nearer the player's capital and one nearer the AI's, at about the same distance from "its" capital,
// so neither side gets the better ones. Ruins avoid cities, resources and each other.
function placeRuins(tiles, cities, area, rng) {
  const [home, away] = cities;
  const ok = (t) => TERRAIN[t.terrain].passable && !t.resource
    && distance(t, home) >= RUINS.minCapitalDist && distance(t, away) >= RUINS.minCapitalDist
    && cities.every((c) => distance(t, c) >= RUINS.minCityDist)
    && Object.values(tiles).every((o) => !o.ruin || distance(o, t) >= RUINS.minRuinDist)
    && pathExists(tiles, home, t);
  const pairs = Math.max(1, Math.round(area / RUINS.perPair));
  for (let i = 0; i < pairs; i++) {
    const near = Object.values(tiles).filter((t) => distance(t, home) < distance(t, away) && ok(t));
    let placed = false;
    for (let tries = 0; tries < 20 && near.length && !placed; tries++) {
      const a = rng.pick(near);
      const want = distance(a, home);
      const twins = Object.values(tiles).filter((t) => distance(t, away) < distance(t, home)
        && Math.abs(distance(t, away) - want) <= 1 && distance(t, a) >= RUINS.minRuinDist && ok(t));
      if (!twins.length) continue;
      a.ruin = true;
      rng.pick(twins).ruin = true;
      placed = true;
    }
  }
}

// Roads: a minimum spanning tree between cities, each segment follows the cheapest path through terrain.
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

// ---------- rivers ----------
// A river is a chain of edges between neighboring tiles. Edge (A, B) has two end vertices; at each
// it meets a third tile C (a common neighbor of A and B). From a vertex the river can continue along edge
// (A, C) or (B, C). Rivers flow from hills/mountains "downhill" along the height field until they reach
// water, the map edge, another river, or exceed the maximum length.

// Direction from a to b (index into DIRS), or -1 if they aren't neighbors.
export function dirTo(a, b) {
  return DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

// The two common neighbors of neighboring tiles a, b.
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
    if (!t) return -1; // beyond the map edge is "sea"
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
    // the vertex the river flows toward: the lower of the two common neighbors
    let [c1, c2] = commonNeighbors(a, b);
    let c = h(c1) <= h(c2) ? c1 : c2;
    const edges = [];
    const used = new Set();
    const edgeKey = (x, y) => [key(x.q, x.r), key(y.q, y.r)].sort().join('|');
    while (edges.length < RIVER.maxLength) {
      edges.push([a, b]);
      used.add(edgeKey(a, b));
      if (ends(c)) break; // vertex on the coast / edge – the river ends
      // continue along (a, c) with the next vertex other than b, or (b, c) with the next vertex other than a
      const opts = [[a, c, b], [b, c, a]].map(([x, y, back]) => {
        const next = commonNeighbors(x, y).find((p) => p.q !== back.q || p.r !== back.r);
        return { x, y, next, score: h(x) + h(y) + h(next) + rng.next() * 0.08 };
      }).filter((o) => !used.has(edgeKey(o.x, o.y)));
      if (!opts.length) break;
      opts.sort((p, q) => p.score - q.score);
      const o = opts[0];
      if (hasRiverEdge(tiles, o.x, o.y)) break; // flows into another river
      [a, b, c] = [o.x, o.y, o.next];
    }
    if (edges.length < RIVER.minLength) continue;
    for (const [x, y] of edges) addRiverEdge(tiles, x, y);
    made++;
  }
}

// Dijkstra over passable terrain; already built roads are cheaper (roads merge).
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
