// Herní data: terén, jednotky, frakce. Balanc se ladí tady.

export const TERRAIN = {
  plains:   { name: 'Pláně',  cost: 1, defBonus: 0,    passable: true,  color: '#a8c66c' },
  forest:   { name: 'Les',    cost: 2, defBonus: 0.25, passable: true,  color: '#4f7f3a' },
  hills:    { name: 'Kopce',  cost: 2, defBonus: 0.5,  passable: true,  color: '#b39b62' },
  mountain: { name: 'Hory',   cost: Infinity, defBonus: 0, passable: false, color: '#7d7a78' },
  water:    { name: 'Voda',   cost: Infinity, defBonus: 0, passable: false, color: '#4a86c5' },
};

export const UNIT_TYPES = {
  warrior:  { name: 'Válečník',  symbol: 'V', hp: 10, atk: 4, def: 3, move: 2, range: 1, cost: 10, sight: 2 },
  archer:   { name: 'Lučištník', symbol: 'L', hp: 8,  atk: 3, def: 2, move: 2, range: 2, cost: 12, sight: 2 },
  horseman: { name: 'Jezdec',    symbol: 'J', hp: 10, atk: 5, def: 2, move: 4, range: 1, cost: 15, sight: 3 },
  // bonusVs: násobek síly navíc proti danému typu (útok i obrana)
  spearman: { name: 'Kopiník',   symbol: 'K', hp: 10, atk: 3, def: 4, move: 2, range: 1, cost: 12, sight: 2,
    bonusVs: { horseman: 1 }, desc: 'dvojnásobná síla proti jezdcům' },
  // siege: bonus proti jednotkám ve městech a ignoruje hradby
  catapult: { name: 'Katapult',  symbol: 'O', hp: 7,  atk: 6, def: 1, move: 1, range: 2, cost: 20, sight: 2,
    siege: 0.5, desc: '+50 % proti posádkám měst, ignoruje hradby' },
};

export const PLAYERS = [
  { name: 'Ty',  color: '#2f6fd6', light: '#9cc0ff', isAI: false },
  { name: 'AI',  color: '#d23c3c', light: '#ffa3a3', isAI: true },
];

// Budovy ve městech. Každou lze ve městě postavit jednou; při dobytí města zůstávají.
export const BUILDINGS = {
  walls:    { name: 'Hradby',  cost: 20, symbol: '▣', desc: 'posádka +50 % obrany' },
  market:   { name: 'Trh',     cost: 25, symbol: '¤', desc: '+2 zlata za kolo' },
  barracks: { name: 'Kasárna', cost: 20, symbol: '⚑', desc: 'verbování o 3 zlaté levnější' },
};
export const BUILDING_EFFECTS = { wallsDefense: 0.5, marketIncome: 2, barracksDiscount: 3 };

// Zkušenosti: XP za útok (+ za zničení) a za přežitý útok. Hodnost zvyšuje útok i obranu.
export const RANKS = [
  { name: 'Rekrut',  xp: 0, symbol: '' },
  { name: 'Veterán', xp: 3, symbol: '★' },
  { name: 'Elita',   xp: 7, symbol: '★★' },
];
export const XP = { attack: 1, kill: 1, defend: 1, rankBonus: 0.15, promotionHeal: 3 };

// Frakce: každá strana má jednu. Chybějící položka = bez bonusu.
// cityIncome: zlato navíc za každé město; unitDiscount / buildingDiscount: sleva podle typu;
// moveBonus: pohyb navíc podle typu jednotky; forestCost / forestDefense: pohyb a obrana v lese;
// captureGold: kořist za dobytí města.
export const FACTIONS = {
  kingdom: { name: 'Království', desc: '+1 zlato za každé město, hradby o 10 levnější',
    cityIncome: 1, buildingDiscount: { walls: 10 } },
  horde:   { name: 'Horda', desc: 'jezdci o 4 levnější a s pohybem +1, za dobyté město kořist 5 zlatých',
    unitDiscount: { horseman: 4 }, moveBonus: { horseman: 1 }, captureGold: 5 },
  forest:  { name: 'Lesní lid', desc: 'les stojí jen 1 pohyb a dává +25 % obrany navíc, lučištníci o 3 levnější',
    unitDiscount: { archer: 3 }, forestCost: 1, forestDefense: 0.25 },
};
export const NO_FACTION = { name: '—', desc: '' };

// Obtížnost ovlivňuje jen AI hráče.
// seesAll: AI ignoruje mlhu války; incomeBonus: zlato navíc za kolo; startGold: zlato navíc na začátku;
// caution: jak moc AI váhá s útokem (vyšší = opatrnější, hraje hůř).
export const DIFFICULTY = {
  easy:   { name: 'Snadná',    seesAll: false, incomeBonus: -2, startGold: -10, caution: 1.6 },
  normal: { name: 'Normální',  seesAll: false, incomeBonus: 0,  startGold: 0,   caution: 1 },
  hard:   { name: 'Těžká',     seesAll: true,  incomeBonus: 3,  startGold: 10,  caution: 0.8 },
};

// Silnice: krok z pole se silnicí na další pole se silnicí stojí jen tolik bodů pohybu.
export const ROAD_COST = 0.5;

// Velikosti mapy pro dialog nové hry.
export const MAP_SIZES = {
  small:  { name: 'Malá',    cols: 10, rows: 8,  neutralCities: 2, desc: 'rychlá hra' },
  medium: { name: 'Střední', cols: 14, rows: 10, neutralCities: 4, desc: 'klasika' },
  large:  { name: 'Velká',   cols: 20, rows: 14, neutralCities: 8, desc: 'dlouhá hra s víc městy' },
};

// Mlha války: dohled měst a bonus z kopců.
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
  'Brodek', 'Lipnice', 'Kamenec', 'Vrbno', 'Hradiště', 'Olšany',
  'Ždár', 'Bystřice', 'Topolná', 'Mlýnec', 'Zahrádky', 'Javorník',
];
