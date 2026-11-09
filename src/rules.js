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
};

export const PLAYERS = [
  { name: 'You', color: '#2f6fd6', light: '#9cc0ff', isAI: false },
  { name: 'AI',  color: '#d23c3c', light: '#ffa3a3', isAI: true },
];

// City buildings. Each can be built once per city; they remain when the city is captured.
export const BUILDINGS = {
  walls:    { name: 'Walls',   cost: 20, symbol: '▣', desc: 'garrison +50 % defense' },
  market:   { name: 'Market',  cost: 25, symbol: '¤', desc: '+2 gold per turn' },
  barracks: { name: 'Barracks', cost: 20, symbol: '⚑', desc: 'recruiting 3 gold cheaper' },
};
export const BUILDING_EFFECTS = { wallsDefense: 0.5, marketIncome: 2, barracksDiscount: 3 };

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

// Fog of war: city sight range and the hills bonus.
export const VISION = { city: 2, hillsBonus: 1 };

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
