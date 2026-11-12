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

## Ideas (unordered)
- Diplomacy with multiple AIs
