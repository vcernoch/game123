// Game data: terrain, units, factions. Balance is tuned here.

export const TERRAIN = {
  plains:   { name: 'Plains', cost: 1, defBonus: 0,    passable: true,  color: '#a8c66c' },
  forest:   { name: 'Forest', cost: 2, defBonus: 0.25, passable: true,  color: '#4f7f3a' },
  hills:    { name: 'Hills',  cost: 2, defBonus: 0.5,  passable: true,  color: '#b39b62' },
  mountain: { name: 'Mountains', cost: Infinity, defBonus: 0, passable: false, color: '#7d7a78' },
  water:    { name: 'Water',  cost: Infinity, defBonus: 0, passable: false, color: '#4a86c5' },
};

export const UNIT_TYPES = {
  warrior:  { name: 'Warrior',   symbol: 'W', hp: 10, atk: 4, def: 3, move: 2, range: 1, cost: 10, sight: 2 },
  archer:   { name: 'Archer',    symbol: 'A', hp: 8,  atk: 3, def: 2, move: 2, range: 2, cost: 12, sight: 2 },
  horseman: { name: 'Horseman',  symbol: 'H', hp: 10, atk: 5, def: 2, move: 4, range: 1, cost: 15, sight: 3 },
  // bonusVs: extra strength multiplier against the given type (attack and defense)
  spearman: { name: 'Spearman',  symbol: 'S', hp: 10, atk: 3, def: 4, move: 2, range: 1, cost: 12, sight: 2,
    bonusVs: { horseman: 1 }, desc: 'double strength against horsemen' },
  // siege: bonus against units in cities, ignores walls
  catapult: { name: 'Catapult',  symbol: 'C', hp: 7,  atk: 6, def: 1, move: 1, range: 2, cost: 20, sight: 2,
    siege: 0.5, desc: '+50 % against city garrisons, ignores walls' },
  // noCapture: cannot enter foreign (enemy or neutral) cities, so it can't capture them
  scout:    { name: 'Scout',     symbol: 'Sc', hp: 6, atk: 1, def: 1, move: 3, range: 1, cost: 8,  sight: 4,
    noCapture: true, desc: 'sees 4 tiles far, cannot capture cities' },
};

// Unit upgrades: a unit standing in an own city that hasn't acted this turn can be retrained
// into a stronger type. It keeps its experience and its share of HP; upgrading ends its turn.
// Price = recruit price of the new type in that city − base price of the old type + fee (at least `min`).
export const UPGRADES = {
  warrior: ['spearman', 'horseman'],
  archer: ['catapult'],
  scout: ['horseman'],
};
export const UPGRADE = { fee: 2, min: 3 };

// Disbanding: the current player can dismiss an own unit at any time during their turn. A unit
// dismissed in an own city returns `refundShare` of its type's base price (rounded down) as gold.
export const DISBAND = { refundShare: 0.4 };

export const PLAYERS = [
  { name: 'You', color: '#2f6fd6', light: '#9cc0ff', isAI: false },
  { name: 'AI',  color: '#d23c3c', light: '#ffa3a3', isAI: true },
];

// City buildings. Each can be built once per city; they remain when the city is captured.
export const BUILDINGS = {
  walls:    { name: 'Walls',   cost: 20, symbol: '▣', desc: 'garrison +50 % defense' },
  market:   { name: 'Market',  cost: 25, symbol: '¤', desc: '+2 gold per turn' },
  barracks: { name: 'Barracks', cost: 20, symbol: '⚑', desc: 'recruiting 3 gold cheaper' },
  watchtower: { name: 'Watchtower', cost: 15, symbol: '♜', desc: 'the city sees 2 tiles farther' },
  infirmary: { name: 'Infirmary', cost: 20, symbol: '✚', desc: 'units here heal +3 more, plague is contained' },
  temple:   { name: 'Temple',  cost: 25, symbol: '☼', desc: '+1 gold per turn, the city never revolts' },
  academy:  { name: 'Academy', cost: 35, symbol: '✪', desc: 'units recruited here start as Veterans' },
};
export const BUILDING_EFFECTS = {
  wallsDefense: 0.5, marketIncome: 2, barracksDiscount: 3,
  watchtowerSight: 2, infirmaryHeal: 3, templeIncome: 1, academyXp: 3,
};

// Experience: XP for attacking (+ for a kill) and for surviving an attack. Rank raises attack and defense.
export const RANKS = [
  { name: 'Recruit', xp: 0, symbol: '' },
  { name: 'Veteran', xp: 3, symbol: '★' },
  { name: 'Elite',   xp: 7, symbol: '★★' },
];
export const XP = { attack: 1, kill: 1, defend: 1, rankBonus: 0.15, promotionHeal: 3 };

// Factions: each side has one. A missing entry = no bonus.
// cityIncome: extra gold per city; unitDiscount / buildingDiscount: discount by type;
// moveBonus: extra movement by unit type; forestCost / forestDefense: movement and defense in forest;
// captureGold: loot for capturing a city.
export const FACTIONS = {
  kingdom: { name: 'Kingdom', desc: '+1 gold per city, walls 10 cheaper',
    cityIncome: 1, buildingDiscount: { walls: 10 } },
  horde:   { name: 'Horde', desc: 'horsemen 4 cheaper with +1 move, 5 gold loot per captured city',
    unitDiscount: { horseman: 4 }, moveBonus: { horseman: 1 }, captureGold: 5 },
  forest:  { name: 'Forest Folk', desc: 'forest costs only 1 move and gives +25 % extra defense, archers 3 cheaper',
    unitDiscount: { archer: 3 }, forestCost: 1, forestDefense: 0.25 },
};
export const NO_FACTION = { name: '—', desc: '' };

// Difficulty affects only the AI player.
// seesAll: AI ignores the fog of war; incomeBonus: extra gold per turn; startGold: extra gold at the start;
// caution: how much the AI hesitates to attack (higher = more cautious, plays worse).
export const DIFFICULTY = {
  easy:   { name: 'Easy',      seesAll: false, incomeBonus: -2, startGold: -10, caution: 1.6 },
  normal: { name: 'Normal',    seesAll: false, incomeBonus: 0,  startGold: 0,   caution: 1 },
  hard:   { name: 'Hard',      seesAll: true,  incomeBonus: 3,  startGold: 10,  caution: 0.8 },
};

// Roads: a step from a road tile to another road tile costs only this many movement points.
export const ROAD_COST = 0.5;

// Fortify: a unit that hasn't moved or attacked this turn digs in. It gets extra defense until
// it moves or attacks again (the bonus also applies to its counterattack defense).
export const FORTIFY = { defBonus: 0.25 };

// Rivers flow along hex edges. Crossing a river costs extra movement (a bridge = road on both sides
// is free) and a unit attacked in melee across a river gets a defense bonus.
// perTiles: one river per this many map tiles (small 1, medium 2, large 4); length in edges.
export const RIVER = { crossCost: 1, defBonus: 0.25, minLength: 3, maxLength: 14, perTiles: 70 };

// Flanking: an attack gets +perUnit attack for every other unit of the attacker standing next to the
// defender (up to `max` such units). It doesn't help the defender's counterattack.
export const FLANK = { perUnit: 0.1, max: 3 };

// High ground: a unit standing on one of `terrain` that attacks a defender standing lower (not on such a
// terrain) gets +atkBonus attack. Like flanking it adds to the attack only, not to the counterattack.
export const HIGH_GROUND = { atkBonus: 0.2, terrain: ['hills'] };

// Cavalry charge: a unit of one of `types` that has spent at least `minMoves` movement points this turn
// gets +atkBonus attack – unless the defender stands on one of `blockedBy` (no charging into woods).
// Like flanking it adds to the attack only, not to the counterattack.
export const CHARGE = { types: ['horseman'], minMoves: 2, atkBonus: 0.25, blockedBy: ['forest'] };

// Random events at the start of a player's turn (from turn fromTurn, with probability chance).
// They hit a random city of the player; weight = relative frequency.
// harvest: extra gold; plague: units in and around the city lose HP (they don't die);
// revolt: a city without its own garrison yields no income this turn (the capital never revolts).
export const HAPPENINGS = {
  chance: 0.15,
  fromTurn: 3,
  kinds: {
    harvest: { name: 'Bountiful Harvest', weight: 3, gold: 8, good: true },
    plague:  { name: 'Plague',       weight: 2, damage: 3 },
    revolt:  { name: 'Revolt',       weight: 2 },
  },
};

// Map sizes for the new game dialog.
export const MAP_SIZES = {
  small:  { name: 'Small',  cols: 10, rows: 8,  neutralCities: 2, desc: 'quick game' },
  medium: { name: 'Medium', cols: 14, rows: 10, neutralCities: 4, desc: 'classic' },
  large:  { name: 'Large',  cols: 20, rows: 14, neutralCities: 8, desc: 'long game with more cities' },
};

// City territory: tiles up to `radius` from a city (the nearest city wins, ties go to the lower id).
// Water is never territory. A unit resting in its own territory (not in a city) heals `healIdle`.
export const TERRITORY = { radius: 2, healIdle: 2 };

// Map resources on tiles near cities. They only count inside a city's territory, for that city.
// gold: extra income; horses: cheaper horsemen recruited in that city.
export const RESOURCES = {
  gold:   { name: 'Gold mine', income: 2, desc: '+2 gold per turn for the city whose territory it is in' },
  horses: { name: 'Horses', discount: { horseman: 4 }, desc: 'horsemen recruited in the city 4 gold cheaper' },
};

// Ancient ruins: scattered over the map in pairs (one nearer each capital, about equally far, so neither
// side is favoured). The first unit of any kind to end its move on a ruin explores it and gets one reward.
// perPair: one pair per this many map tiles (small 1, medium 2, large 4 pairs).
// treasure: gold; training: experience for the unit; map: reveals the land around (with fog only);
// recruits: a free unit next to the explorer (treasure instead when there is no free tile).
export const RUINS = {
  perPair: 70,
  minCapitalDist: 3,
  minCityDist: 2,
  minRuinDist: 3,
  kinds: {
    treasure: { name: 'Treasure', weight: 3, gold: 15 },
    training: { name: 'Forgotten drill yard', weight: 2, xp: 3 },
    map:      { name: 'Old map', weight: 2, radius: 4 },
    recruits: { name: 'Wandering warriors', weight: 2, unit: 'warrior' },
  },
  desc: 'the first unit to stop here finds gold, experience, an old map or new recruits',
};

// Fog of war: city sight range and the hills bonus.
export const VISION = { city: 2, hillsBonus: 1 };

// Last-seen markers: an enemy unit that disappears into the fog leaves a faded marker where it was
// last seen; the marker is forgotten after `maxAge` turns or when the tile is seen again.
export const SIGHTINGS = { maxAge: 3 };

export const NEUTRAL_COLOR = '#e8e2d0';

export const ECONOMY = {
  startGold: 20,
  capitalIncome: 5,
  cityIncome: 3,
  healInCity: 3,
  healIdle: 1,
};

export const CITY_NAMES = [
  'Brookby', 'Lindenhall', 'Stonecliff', 'Willowmere', 'Hillfort', 'Aldergrove',
  'Ashford', 'Riverton', 'Poplar Vale', 'Millbrook', 'Gardenside', 'Mapleton',
];
