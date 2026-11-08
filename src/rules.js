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
