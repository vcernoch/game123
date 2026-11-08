import { key, neighbors, offsetToAxial, distance } from './hex.js';
import { createRng } from './rng.js';
import { TERRAIN, CITY_NAMES } from './rules.js';

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

  return { tiles, cities, starts };
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
