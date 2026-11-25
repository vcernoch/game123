# Roadmap – Hex Realm

Check off `[x]` when done. Add new ideas to the end of the relevant phase or to "Ideas".

## Phase 0 – foundation ✅
- [x] Hex map with terrain (Plains, Forest, Hills, Mountains, Water)
- [x] Units: Warrior, Archer, Horseman; movement, attack, counterattack
- [x] Cities, gold income, recruiting, conquest
- [x] Simple AI, victory/defeat
- [x] Saving to localStorage, logic tests, browser smoke test

## Phase 1 – playability ✅
- [x] Arrow/path showing the route when hovering over the target tile
- [x] Movement and attack animations (short, so the AI turn is readable)
- [x] Fog of war: you only see the surroundings of your units and cities
- [x] "Next unit with moves" button (Tab)
- [x] Show city income and defense on mouse hover
- [x] AI difficulty selection (Easy / Normal / Hard)
- [x] Touch controls on mobile (larger hit area, attack confirmation)

## Phase 2 – depth ✅
- [x] Buildings in cities (Walls, Market, Barracks)
- [x] Unit experience and promotion
- [x] New units: siege engine, Spearman (bonus against Horsemen)
- [x] Roads or rivers affecting movement (roads; rivers not yet – see Ideas)
- [x] Better AI: defending own cities, concentrating forces, retreating when wounded
- [x] More factions with different bonuses

## Phase 3 – content and polish
- [x] Main menu, map size selection
- [ ] More AI opponents (the code currently assumes two players – a bigger rework, incl. victory and diplomacy)
- [x] Sound effects generated via WebAudio
- [x] End-of-game statistics (strength chart over time)
- [ ] Campaign or scenarios with objectives (waiting for Vladimír – different objectives = change to victory rules, see LOG.md)
- [x] Rivers on hex edges: crossing costs extra movement, bridges on roads, defender bonus (own improvement)
- [x] Random events at the start of a turn: harvest, plague, revolt; can be turned off (own improvement from Ideas)
- [x] The chronicle hides AI actions the player didn't see in the fog of war (own improvement from Ideas)
- [x] Undo move (Z): a move that revealed nothing new can be taken back (own improvement)
- [x] Whole project in English: game UI, code comments, tests and docs (Vladimír's request)

## Phase 4 – tactics and comfort (own improvements) ✅
- [x] Fortify (F): a unit that hasn't acted digs in for +25 % defense until it moves or attacks; AI garrisons fortify too
- [x] End-turn reminder: the button shows how many units can still act, a second press confirms
- [x] City borders: tiles around each city drawn as territory in the owner's colour; resting in own territory heals more
- [x] Multi-turn move orders: a far target becomes the unit's destination and it keeps walking at the start of each turn
- [x] More buildings: watchtower, infirmary, temple, academy (Vladimír's request)

## Phase 5 – map and information (own improvements) ✅
- [x] Map resources: gold mines and horse pastures in city territory (more income, cheaper horsemen)
- [x] Unit tooltip: hovering any visible unit shows its stats, HP, rank and state
- [x] Keyboard shortcuts: number keys recruit in the selected city, `?` shows a shortcut overlay

## Phase 6 – tactics and saves (own improvements) ✅
- [x] Zone of control: a unit that steps next to a visible enemy must stop (stop sign on the tile); leaving is free
- [x] Save to file and load from file (export / import the game as JSON, validated and migrated)
- [x] Threat overlay (T): highlight tiles that visible enemy units could attack next turn

## Phase 7 – smarter AI and new content (own improvements) ✅
- [x] AI weighs danger: archers and catapults keep out of enemy reach, melee units avoid pile-ons, strikes are made from safer tiles
- [x] Scout: a cheap, fast unit that sees far but cannot capture cities; the AI recruits one to explore in the fog
- [x] Map seed: the new game dialog shows and accepts a map number, "Same map again" restarts the current map

## Phase 8 – army development (own improvements) ✅
- [x] Unit upgrades: a unit in an own city that hasn't acted can be retrained (warrior → spearman/horseman, archer → catapult, scout → horseman), keeping rank and HP share; the AI uses it against horsemen and for idle scouts
- [x] Disband: a unit you no longer need can be dismissed (panel button or D, pressed twice); in an own city it returns 40 % of its base price

## Phase 9 – battlefield tactics (own improvements)
- [x] Flanking: +10 % attack for each other own unit next to the defender (max +30 %), shown in the attack preview with ⚔ badges on the flankers
- [x] AI uses flanks: melee units first line up around their targets and strike only when everyone is in place, so each strike gets the others' flank bonus
- [x] High ground: a unit on hills attacking a unit below it gets +20 % attack (shown in the attack preview and the tile panel)
- [x] Cavalry charge: a horseman that has spent 2+ move points this turn gets +25 % attack, but not against a unit in forest; the AI counts the approach

## Phase 10 – clarity and feedback (own improvements)
- [x] Enemy turn report: at the start of your turn a bar sums up what the enemy did to you (units lost/wounded, cities lost, attackers that fell) and red ✕ marks show where you lost something
- [x] Last-seen markers: an enemy unit that disappears into the fog leaves a faded "?" marker where it was last seen (or the tile it walked off into), with a tooltip saying how long ago; forgotten after 3 turns or when the tile is seen again
- [x] Army panel: a collapsible list of all own units (ready first, then marching, fortified, done) with HP, rank and where they stand; clicking a row selects the unit and scrolls the zoomed map to it

## Phase 11 – exploration (own improvements)
- [x] Ancient ruins: pairs of ruins placed fairly on the map; the first unit to stop on one finds treasure, experience, an old map or recruits; a ruin looted in the fog still shows until seen; the AI detours for known ruins
- [x] Auto-explore (🧭 / X): a unit walks into the fog on its own each turn towards where it would see the most unexplored land (and known ruins), never enters foreign cities, stops when an enemy shows up or nothing is left

## Phase 12 – economy war (own improvements)
- [x] Pillage (🔥 / P): a unit standing on an enemy resource plunders it for gold; the resource gives its owner nothing for their next 4 turns; the AI raids nearby player resources too
- [x] Repair (🔧 / R): an own unit standing on a pillaged resource in own territory rebuilds it for 3 gold (ends its turn), the resource works again at once; the AI walks back to repair its own

## Phase 13 – logistics (own improvements)
- [x] Rally points (🚩 / G): an own city can have a flag on a known tile; every unit recruited there gets a move order to it (or the nearest free tile next to it) and sets off at the start of the next turn; a captured city loses its flag
- [x] Swap places (⇄ / S): two neighbouring own units with a move left trade tiles in one step, so a fresh unit can relieve a wounded one at the front; undoable like a move; the AI swaps a wounded unit pressed by an enemy with a healthy melee neighbour
- [x] Road building (🛤 / B): a unit that hasn't attacked builds a road on a roadless tile of own territory for 4 gold (ends its turn); roads serve both sides; the AI extends its network next to roads and cities with spare gold

## Phase 14 – command comfort (own improvements)
- [x] Sentry (👁 / W): a unit keeps watch where it stands (a wounded one rests until fully healed); Tab, the end-turn reminder and the army "ready" count skip it until an enemy comes within 2 tiles at the start of your turn; the banner says who woke up and why
- [x] Wall volley: at the end of its owner's turn a city with walls shoots the weakest adjacent enemy for 2 HP (never below 1, no counter); animated stone, chronicle, turn report, threat overlay and AI danger map count it
- [x] Animation speed (▶ / A): header button and key cycle normal → fast → off, remembered between visits; a saved choice wins over the system "reduce motion" setting (which still makes "off" the default)

## Phase 15 – war stories (own improvements)
- [x] Heroes: a unit reaching Veteran earns a name for life, every unit counts its kills (panel, tooltip, army list, chronicle); a hall of fame in the statistics remembers each side's best units, fallen ones too (the enemy's are revealed at the end)
- [x] Inspiration: a named hero gives own units next to it +10 % defense (also on counterattacks, heroes don't stack); shown in the tooltip, attack preview, hero panel and with gold badges when the hero is selected
- [x] War timeline: the statistics list the game's turning points (first blood, captured cities and capitals, each side's first hero, fallen heroes with 2+ kills, strength leads, victory) with markers under the strength chart; only what you witnessed until the game ends

## Phase 16 – guidance (own improvements)
- [x] Advisor (💡 panel): up to three hints for the turn, most urgent first – an unguarded city with a visible enemy within 3 tiles, a sure kill, a badly wounded unit within enemy reach, a city or ruin reachable now, a pillaged resource to repair, gold to recruit or build with; only what the player can see; a click selects the unit or city; collapsing is remembered
- [x] Recruit suggestion: the city panel marks a unit type that fits the situation (★) with a reason – spearmen against nearby horsemen, a catapult for a close enemy city, archers behind a melee line, a scout while the map is mostly unknown, a horseman for a neutral city; the advisor's recruit hint names it

## Phase 17 – living cities (own improvements)
- [x] City growth: a held city grows to size 2 after 5 of its owner's turns and to size 3 after 7 more (+1 gold per size above 1, dots on the tile); an enemy next to the city halts growth, a captured city loses a size; neutral cities don't grow; the AI values grown cities a bit more
- [x] Trade routes: an own city linked to an own capital by an unbroken road chain (own cities are links, neutral/enemy cities aren't) earns +1 gold; an enemy unit on the road cuts it; built roads can link a city; the city panel shows the route, the advisor points at a visible blocker, AI melee units blockade nearby enemy roads
- [x] Unrest: a city taken from the enemy (not a neutral one) pays no gold and doesn't grow until it calms – 4 of its new owner's turns, 2 with an own garrison inside; a flame on the roof, the city panel and tooltip count down, the advisor sends a unit in, the AI keeps its conquerors in place

## Phase 18 – city management (own improvements)
- [x] City focus (C): each own city is Balanced, Commerce (+1 gold, no growth), Granary (grows twice as fast, −1 gold) or Fortress (garrison +20 % defense, −1 gold; catapults ignore it); a badge on the tile, panel buttons, advisor flags a wasted focus, the AI fortifies threatened cities, grows small ones and trades in grown ones
- [x] Levy (⚑ / L): an own city of size 2+ that isn't restless calls up a free Warrior on its tile and loses a size (growth starts anew); follows the rally point; the advisor's unguarded-city hint suggests it when there's no gold to recruit, the AI levies in an empty threatened city with an empty treasury
- [x] Recruit orders (⏳): a city that can't recruit now (no gold, or occupied) takes an order instead – the dashed order buttons or number keys; it is bought by itself at the start of the next own turn with gold and a free tile (after income and random events), an hourglass marks the city, the banner reports it; recruiting there fulfils it, capture removes it

## Phase 19 – manoeuvre (own improvements)
- [x] Forced march (🥾 / M): a unit that hasn't moved or attacked gets +1 move this turn for 2 HP (needs more than 2 HP), but can't attack and doesn't heal at the end of the turn; a boot on the unit, the button tooltip counts the extra tiles; the AI marches a healthy unit into an unguarded threatened city it couldn't reach otherwise, the advisor's unguarded-city hint names the unit a march gets there
- [x] Hit and run (🏇): horsemen and scouts that survive an attack keep their remaining moves minus 1 to pull back, but can't attack again or enter a foreign city that turn; the attack preview says how far, the AI pulls its riders back to safer tiles
- [x] Pursuit (➜): a warrior or spearman that destroys an adjacent defender outside a city may advance into the freed tile for free that turn, even with no moves left (optional); the attack preview says so, the AI advances when the tile is no more exposed or when a healthy unit closes in on an enemy city

## Phase 20 – hindsight and veterans (own improvements)
- [x] Replay enemy turn (↺ / V): the start-of-turn bar offers to watch the enemy's last turn again – only what you saw of it, even with animations off – on a copy of the state, then the map returns to now; available until you end your turn
- [x] Chronicle places: each chronicle entry keeps the tile it happened on; a click on a line you saw (⌖) scrolls the map there and pulses a ring on the tile – fog lines never carry a place
- [x] Perks: each promotion (Veteran, Elite) lets the unit learn a perk of the owner's choice – ⚔ Drill +10 % attack, 🌲 Pathfinder (forest and hills cost 1), ✚ Medic (+1 healing for it and neighbours), 🔭 Lookout (+1 sight); free, for life; the advisor reminds, the AI picks by unit type

## Phase 21 – the turning year (own improvements)
- [x] Seasons (new game option, on by default): every 3 rounds the season turns – 🌱 spring thaw (crossing a river +1 more), ☀ summer, 🍂 autumn harvest (+1 gold for cities of size 2+), ❄ winter (rivers freeze: free to cross, no river defense; units outside own territory don't heal and lose 1 HP, never below 1); header badge, banner news, snow and ice on the map, frost warning in the unit panel; the AI brings weak units home in winter
- [x] Winter advisor (❄): from the last round of autumn the advisor names the most wounded unit (≤ 60 % HP) outside your territory that can still move and tells you to bring it home before the frost
- [x] Winter camp (⛺): a unit fortified outside your territory in winter doesn't lose HP to the frost (it still doesn't heal); the fortify button, unit panel, tile panel and advisor offer it, the AI digs in units that stay put in the cold

## Phase 22 – working the land (own improvements)
- [x] Woodcutting (🪓 / H): a unit that hasn't attacked and has a move left fells a forest of its own territory (not a city, resource or ruin) for +6 gold and ends its turn; the tile becomes plains for good (stumps on the map) – cheaper to cross, but no forest cover and no shelter from charges; the AI fells timber when its treasury runs dry and no enemy is near
- [x] Planting (🌱 / N): a unit that hasn't attacked and has a move left plants saplings on plains of its own territory (not a city, resource or ruin) for 3 gold and ends its turn; 4 rounds later they are a forest – a felled forest grows back, bare plains become new woods; sprouts on the map, the tile panel counts down; the AI replants its felled forests (or plains next to its woods) with gold to spare

## Ideas (unordered)
- Diplomacy with multiple AIs
