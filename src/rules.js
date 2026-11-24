// Game data: terrain, units, factions. Balance is tuned here.

export const TERRAIN = {
  plains:   { name: 'Plains', cost: 1, defBonus: 0,    passable: true,  color: '#a8c66c' },
  forest:   { name: 'Forest', cost: 2, defBonus: 0.25, passable: true,  color: '#4f7f3a' },
  hills:    { name: 'Hills',  cost: 2, defBonus: 0.5,  passable: true,  color: '#b39b62' },
  mountain: { name: 'Mountains', cost: Infinity, defBonus: 0, passable: false, color: '#7d7a78' },
  water:    { name: 'Water',  cost: Infinity, defBonus: 0, passable: false, color: '#4a86c5' },
};

export const UNIT_TYPES = {
  warrior:  { name: 'Warrior',   symbol: 'W', hp: 10, atk: 4, def: 3, move: 2, range: 1, cost: 10, sight: 2,
    desc: 'pursuit: can advance into the tile of a unit it destroyed' },
  archer:   { name: 'Archer',    symbol: 'A', hp: 8,  atk: 3, def: 2, move: 2, range: 2, cost: 12, sight: 2 },
  horseman: { name: 'Horseman',  symbol: 'H', hp: 10, atk: 5, def: 2, move: 4, range: 1, cost: 15, sight: 3,
    desc: 'hit and run: can pull back after attacking' },
  // bonusVs: extra strength multiplier against the given type (attack and defense)
  spearman: { name: 'Spearman',  symbol: 'S', hp: 10, atk: 3, def: 4, move: 2, range: 1, cost: 12, sight: 2,
    bonusVs: { horseman: 1 }, desc: 'double strength against horsemen, pursuit' },
  // siege: bonus against units in cities, ignores walls
  catapult: { name: 'Catapult',  symbol: 'C', hp: 7,  atk: 6, def: 1, move: 1, range: 2, cost: 20, sight: 2,
    siege: 0.5, desc: '+50 % against city garrisons, ignores walls' },
  // noCapture: cannot enter foreign (enemy or neutral) cities, so it can't capture them
  scout:    { name: 'Scout',     symbol: 'Sc', hp: 6, atk: 1, def: 1, move: 3, range: 1, cost: 8,  sight: 4,
    noCapture: true, desc: 'sees 4 tiles far, cannot capture cities, hit and run' },
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
  walls:    { name: 'Walls',   cost: 20, symbol: '▣', desc: 'garrison +50 % defense, shoots a besieger for 2 HP each turn' },
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

// Perks: each promotion (Veteran, Elite) lets the unit learn one perk of its owner's choice; a perk is
// learned once and kept for life. `aiOrder` = what the AI picks first for a unit type (falls back to `kinds` order).
export const PERKS = {
  kinds: {
    drill:      { name: 'Drill',      icon: '⚔', desc: '+10 % attack', atk: 0.1 },
    pathfinder: { name: 'Pathfinder', icon: '🌲', desc: 'forest and hills cost only 1 move', roughCost: 1 },
    medic:      { name: 'Medic',      icon: '✚', desc: 'it and own units next to it heal +1 HP when they heal', heal: 1 },
    lookout:    { name: 'Lookout',    icon: '🔭', desc: 'sees 1 tile farther', sight: 1 },
  },
  aiOrder: {
    warrior: ['drill', 'medic'], spearman: ['drill', 'medic'], horseman: ['drill', 'pathfinder'],
    archer: ['drill', 'lookout'], catapult: ['drill', 'pathfinder'], scout: ['lookout', 'pathfinder'],
  },
};

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
// Forced march: a unit that hasn't moved or attacked this turn pushes on for `bonus` extra move points,
// pays `hpCost` HP (never below 1 – it needs more than hpCost HP) and can't attack this turn; it doesn't heal
// at the end of the turn. The AI marches a unit to an unguarded threatened city it couldn't reach otherwise,
// only with at least `aiHpShare` of its HP.
export const FORCED_MARCH = { bonus: 1, hpCost: 2, aiHpShare: 0.6 };

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

// Hit and run: a unit of one of `types` that survives its attack keeps its remaining move points minus `moveCost`,
// so it can pull back after striking. It can't attack again this turn and can't enter a foreign city after the
// attack (no killing a garrison and riding in on the same turn). The AI withdraws its skirmishers out of reach.
export const SKIRMISH = { types: ['horseman', 'scout'], moveCost: 1 };

// Pursuit: a foot soldier of one of `types` that destroys an adjacent defender may advance into the freed
// tile this turn for free, even with no move points left – but never into a city (a garrison killed still
// has to be followed up next turn). Optional: the unit can just stay. The AI advances when the freed tile
// is no more exposed than where it stands, or when it closes in on an enemy city and the unit is healthy.
export const PURSUIT = { types: ['warrior', 'spearman'], aiHpShare: 0.6 };

// Random events at the start of a player's turn (from turn fromTurn, with probability chance).
// Seasons (a game option, like random events): the year turns every `length` rounds, starting in spring.
// spring: thaw – crossing a river costs `riverExtra` more (bridges stay free);
// summer: campaign season – no effect;
// autumn: harvest – every owned city of size 2+ that isn't restless pays `harvest` more gold;
// winter: rivers freeze – crossing is free and gives no defense; a unit ending its owner's turn outside
//   its own territory doesn't heal and loses `frost` HP (never below `frostMinHp`) – unless it is fortified
//   (`camp`: a winter camp keeps the cold out, but still no healing). The AI makes camp with units that stay put.
// The AI's wounded units head home a little earlier in winter (`aiFrostHp` share of HP); the advisor warns about
// units out in the cold with at most `adviseHp` of their HP, already in the last round before winter.
export const SEASONS = {
  length: 3,
  order: ['spring', 'summer', 'autumn', 'winter'],
  kinds: {
    spring: { name: 'Spring', icon: '🌱', riverExtra: 1, text: 'thaw – swollen rivers cost +1 more move to cross (bridges stay free)' },
    summer: { name: 'Summer', icon: '☀', text: 'campaign season – no penalties' },
    autumn: { name: 'Autumn', icon: '🍂', harvest: 1, text: 'harvest – cities of size 2+ pay +1 gold' },
    winter: { name: 'Winter', icon: '❄', frozen: true, frost: 1, text: 'rivers freeze (free to cross, no river defense); units outside your territory don\'t heal and lose 1 HP each turn unless fortified (winter camp)' },
  },
  frostMinHp: 1,
  camp: true, // a fortified unit doesn't lose HP to frost
  aiFrostHp: 0.6,
  adviseHp: 0.6, // the advisor warns about units out in the cold with at most this share of HP
};

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

// Pillage: a unit (not a scout) that hasn't attacked and still has moves left, standing on a resource tile in
// enemy territory, can plunder it: its side gains `gold`, the unit's turn ends and the resource gives its owner
// nothing (no income, no discount) during its owner's next `turns` turns, then it recovers by itself.
export const PILLAGE = { gold: 6, turns: 4 };

// Repair: a unit of any kind that hasn't attacked and still has moves left, standing on a pillaged resource in its
// own territory, can rebuild it for `gold`: the resource works again right away and the unit's turn ends.
export const REPAIR = { gold: 3 };

// Road building: a unit of any kind that hasn't attacked and still has moves left, standing on a tile of its
// own territory without a road (not a city), can lay a road there for `gold`; the unit's turn ends.
// The AI extends its road network only with gold above `aiReserve` and at most once per turn.
export const ROADWORK = { gold: 4, aiReserve: 16 };

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

// Auto-explore: a unit walks on its own each turn towards the known tile from which it would see the
// most unexplored land (score = new tiles / (1 + cost in turns)). A ruin the player believes in counts
// as `ruinBonus` extra tiles. The order stops when an enemy comes within `enemyRadius` or nothing is left.
export const EXPLORE = { ruinBonus: 6, enemyRadius: 2, legsPerTurn: 3 };

// Wall volley: at the end of its owner's turn a city with walls shoots the weakest enemy unit within
// `range` for `damage` HP (no counterattack). It never takes a unit below `minHp` – walls harass
// besiegers, they don't finish them off.
export const VOLLEY = { damage: 2, range: 1, minHp: 1 };

// Animation speed (a viewer preference, not part of the game state): mult scales animation durations,
// 0 = no animations. The header button / key A cycle through them in this order.
export const ANIM_SPEEDS = [
  { id: 'normal', mult: 1, icon: '▶', label: 'normal' },
  { id: 'fast', mult: 0.4, icon: '⏩', label: 'fast' },
  { id: 'off', mult: 0, icon: '⏸', label: 'off' },
];

// Sentry: a unit on watch is skipped by Tab and the end-turn reminder until, at the start of its owner's
// turn, a visible enemy is within `radius` (it wakes up) – or, when it was put on watch wounded, until it
// is fully healed ("rest until healed").
export const SENTRY = { radius: 2 };

// Heroes: a unit that reaches rank `minRank` (Veteran) gets a name of its own and keeps it for life
// (also when retrained). Kills are counted per unit; named units that fall or are disbanded are kept
// in `state.fallen`, so the end-of-game hall of fame remembers them. `hallSize` heroes per side are shown.
export const HEROES = {
  minRank: 1,
  hallSize: 3,
  names: [
    'Aldric', 'Brenna', 'Corwin', 'Dagny', 'Edric', 'Freya', 'Gareth', 'Hilda', 'Ivo', 'Jorunn',
    'Kestrel', 'Leofric', 'Maren', 'Nolan', 'Osric', 'Petra', 'Quill', 'Rowan', 'Sigrun', 'Tamsin',
    'Ulric', 'Vesna', 'Wulfric', 'Yara', 'Bram', 'Cordelia', 'Dunstan', 'Elowen', 'Fenwick', 'Gwen',
  ],
};

// Inspiration: a named hero steadies the own units standing next to it – they get +defBonus defense
// (also when counterattacking). The hero itself doesn't profit and several heroes don't stack.
export const INSPIRE = { defBonus: 0.1, range: 1 };

// War timeline: the turning points of a game, kept in state.milestones and shown in the statistics
// (list + markers on the strength chart). `lead` entries aren't stored – they are derived from history
// when one side's army becomes at least `leadRatio` times stronger than the other's.
export const MILESTONES = {
  limit: 60,
  keep: ['firstBlood', 'hero', 'capital', 'victory'], // never dropped when the list is full
  fallKills: 2, // a fallen hero is a milestone only with at least this many kills
  leadRatio: 1.5,
  leadMin: 10, // ignore "leads" while both armies are tiny
  kinds: {
    firstBlood: { icon: '🩸', name: 'First blood' },
    capture: { icon: '🏰', name: 'City captured' },
    capital: { icon: '👑', name: 'Capital captured' },
    hero: { icon: '⭐', name: 'First hero' },
    heroFell: { icon: '✝', name: 'Famous hero fell' },
    lead: { icon: '⚖', name: 'Lead in strength' },
    victory: { icon: '🏆', name: 'Victory' },
  },
};

// Advisor: a few hints for the player's turn, most urgent first (see adviseTurn in game.js).
// Only what the player can see is used. `dangerRange` = how close a visible enemy must be to an
// unguarded own city, `woundedShare` = HP share counted as badly wounded, `buildOrder` = which
// building to suggest first when there is gold to spare and no free city to recruit in;
// `buildReserve` = gold that should stay after building.
export const ADVISOR = {
  limit: 3,
  dangerRange: 3,
  woundedShare: 0.4,
  buildReserve: 10,
  buildOrder: ['market', 'walls', 'barracks', 'temple', 'infirmary', 'watchtower', 'academy'],
  kinds: {
    undefended: { icon: '🛡', order: 0 },
    finish:     { icon: '⚔', order: 1 },
    wounded:    { icon: '✚', order: 2 },
    frost:      { icon: '❄', order: 2.5 },
    capture:    { icon: '🏰', order: 3 },
    ruin:       { icon: '🏛', order: 4 },
    repair:     { icon: '🔧', order: 5 },
    unrest:     { icon: '✊', order: 5.2 },
    trade:      { icon: '🛤', order: 5.5 },
    perk:       { icon: '★', order: 5.8 },
    focus:      { icon: '⚖', order: 8 },
    recruit:    { icon: '⚑', order: 6 },
    build:      { icon: '🔨', order: 7 },
  },
  // recruit suggestion: which unit type fits the situation around a city
  // range: visible enemies this close to the city count; siegeRange: a known enemy city this close
  // asks for a catapult; unknownShare: with this much of the map unexplored and no scout, a scout helps
  recruit: { range: 6, siegeRange: 5, unknownShare: 0.4 },
};

export const NEUTRAL_COLOR = '#e8e2d0';

// City growth: a city held by a player grows a size every few of its owner's turns (neutral cities don't).
// `turns[i]` = owner's turns needed to grow from size i+1 to i+2; each size above 1 adds `income` gold.
// An enemy unit standing next to the city at the start of its owner's turn halts growth that turn
// (a siege), and a captured city drops `captureLoss` sizes and starts growing anew.
export const GROWTH = {
  maxSize: 3,
  turns: [5, 7],
  income: 1,
  captureLoss: 1,
  aiGoalBonus: 0.1, // the AI values a grown foreign city a bit more per size above 1
};

// Trade routes: an own city linked to an own capital by an unbroken chain of road tiles (own cities count
// as links; neutral and enemy cities and tiles with an enemy unit break the chain) earns `income` extra gold.
// The capital itself is the hub and earns nothing extra. Built roads join the network.
export const TRADE = {
  income: 1,
};

// Unrest: a city taken from another player (not a neutral one) resists its new owner for a while –
// no income and no growth. Each of the owner's turns calms it by 1, by `garrisonCalm` with an own unit inside.
export const UNREST = {
  turns: 4,
  garrisonCalm: 2,
};

// City focus: every own city works towards one goal, chosen by its owner at any time on their turn.
// `gold` is added to the city's income (a city never pays less than 0; a restless one pays nothing anyway),
// `growth` = growth progress per owner's turn (0 = growth halted), `defBonus` = extra garrison defense
// (siege engines ignore it, as they ignore walls). Income and growth are worked out at the start of the
// owner's turn, so the focus left at the end of a turn is the one that counts. A captured city goes back
// to `balanced`. The AI fortifies a city with a visible enemy within `aiThreat` tiles.
export const FOCUS = {
  kinds: {
    balanced: { name: 'Balanced', icon: '⚖', gold: 0, growth: 1, defBonus: 0, desc: 'no bonus, no cost' },
    commerce: { name: 'Commerce', icon: '💰', gold: 1, growth: 0, defBonus: 0, desc: '+1 gold, but the city stops growing' },
    granary: { name: 'Granary', icon: '🌾', gold: -1, growth: 2, defBonus: 0, desc: 'grows twice as fast, −1 gold' },
    fortress: { name: 'Fortress', icon: '🏯', gold: -1, growth: 1, defBonus: 0.2, desc: 'garrison defense +20 %, −1 gold' },
  },
  aiThreat: 3,
};

// Levy: an own city of at least `minSize` calls up a free unit of `type` on its tile at the price of
// `sizeCost` sizes (its growth progress starts anew). Not while the city is restless. The levied unit is a
// raw recruit (no academy experience) but follows the city's rally point. The AI levies only in a city with
// a visible enemy within `aiThreat` tiles when it can't afford any recruit there.
export const LEVY = { type: 'warrior', minSize: 2, sizeCost: 1, aiThreat: 3 };

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
