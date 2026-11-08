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

// Obtížnost ovlivňuje jen AI hráče.
// seesAll: AI ignoruje mlhu války; incomeBonus: zlato navíc za kolo; startGold: zlato navíc na začátku;
// caution: jak moc AI váhá s útokem (vyšší = opatrnější, hraje hůř).
export const DIFFICULTY = {
  easy:   { name: 'Snadná',    seesAll: false, incomeBonus: -2, startGold: -10, caution: 1.6 },
  normal: { name: 'Normální',  seesAll: false, incomeBonus: 0,  startGold: 0,   caution: 1 },
  hard:   { name: 'Těžká',     seesAll: true,  incomeBonus: 3,  startGold: 10,  caution: 0.8 },
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
