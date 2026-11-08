# Vývojový deník

Nejnovější záznam nahoře. Formát: datum – co se udělalo – stav testů – otázky pro Vladimíra.

## 2026-11-08 – Zvukové efekty
- Nový `src/sound.js`: všechny zvuky se syntetizují (oscilátory + filtrovaný šum), žádné nahrávky ani externí soubory. Zvuky: krok, zásah, zničení, povýšení, dobytí/ztráta města, stavba, verbování, klik, znělka vítězství a porážky.
- `soundFor(event)` mapuje herní události na zvuky; animátor má nový callback `onShow`, takže zní jen to, co hráč skutečně vidí (ne tahy AI v mlze). Omezovač pustí stejný zvuk nejvýš jednou za 90 ms (přeskočená animace nespustí kakofonii).
- `AudioContext` vzniká až při prvním gestu (pravidla prohlížečů); modul jde importovat i v Node.
- Přepínač ♪ vedle názvu hry; volba se pamatuje v localStorage.
- Testy: +1 logický (mapování událostí, každá událost z reálné hry má existující zvuk, omezovač, přehrání bez AudioContextu nespadne). Smoke test přepne zvuk tam a zpět.
- Stav: `npm run check` zelený (34 logických testů + smoke).

## 2026-11-08 – Hlavní menu a velikost mapy
- `MAP_SIZES` v `rules.js`: Malá 10×8 (4 města), Střední 14×10 (6), Velká 20×14 (10). `createGame({ size })`.
- Při první návštěvě (bez uložené hry) se dialog nové hry otevře sám jako hlavní menu (bez varování o ztrátě hry). Volby velikosti se generují z `rules.js` a pamatují se.
- Přiblížená mapa na mobilu má přirozenou šířku podle velikosti mapy (CSS proměnná `--zoom-w`).
- Původní úkol „Hlavní menu, volba velikosti mapy a počtu AI“ jsem rozdělil: víc AI soupeřů je samostatný úkol v roadmapě. Kód všude počítá se dvěma hráči (střídání tahů, vítězství, barvy, mlha, frakce), takže to chce vlastní běh.
- Testy: +1 logický (všechny velikosti: rozměry, počet měst, propojenost, AI vs AI doběhne). Smoke test ověří, že se menu při první návštěvě otevře (desktop i telefon), a uloží `screenshot-menu.png` / `screenshot-menu-mobile.png`.
- Stav: `npm run check` zelený (33 logických testů + smoke).

## 2026-11-08 – Frakce
- `FACTIONS` v `rules.js` (generické položky, chybějící = bez bonusu):
  - **Království**: +1 zlato za každé město, hradby o 10 levnější.
  - **Horda**: jezdci o 4 levnější a s pohybem +1, za dobyté město kořist 5 zlatých.
  - **Lesní lid**: les stojí 1 pohyb a dává +25 % obrany navíc, lučištníci o 3 levnější.
- Pomocníci v `game.js`: `factionOf`, `unitMove`, `buildingCost`, `terrainDefense`; `cityIncome(city, state)` a `stepCost(..., unit)` berou frakci v úvahu. **Změna API:** `unitCost(state, city, type)` (dřív `unitCost(city, type)`).
- Hráč volí frakci v dialogu nové hry (volby se generují z `rules.js`), AI dostane podle seedu jinou. V panelu je vidět „Ty: … · AI: …“.
- AI verbuje víc jednotek, které má její frakce zlevněné, a na viditelné jezdce reaguje silněji (2 kopiníci na jezdce v cílovém poměru).
- Balanc (dočasný skript, AI proti AI, 40 seedů × všech 6 dvojic frakcí): Horda byla s jen levnějšími jezdci na 43 %, s kořistí 10 zl. na 64 %, s kořistí 5 zl. vyrovnaně. Výsledek po všech úpravách: Království 56 %, Horda 48 %, Lesní lid 46 % (šum při 160 hrách je zhruba ±4 %).
- Struktura stavu: `state.version` 8 (`factions`), staré hry hrají bez frakcí.
- Testy: +2 logické (bonusy každé frakce včetně lesa a kořisti, AI má jinou frakci, migrace, AI vs AI se všemi frakcemi).
- Stav: `npm run check` zelený (32 logických testů + smoke). Fáze 1 a 2 roadmapy jsou hotové.

## 2026-11-08 – Lepší AI
- `planStrike()`: AI zkusí útok z každého dosažitelného pole a vybere nejlepší kombinaci „dojdi a zaútoč“ (terén ovlivňuje protiúder).
- Soustředění: střelci a katapulty táhnou první, hodnocení útoku preferuje oslabené a dražší cíle, takže boj na blízko dorazí, co střelci nahlodali.
- Obrana měst: `assignGarrisons()` – když je viditelný nepřítel do 2 polí od vlastního města, zůstane v něm jednotka, nebo tam dojde nejbližší, která to stihne. Posádka z města normálně útočí.
- Ústup: jednotka pod 25 % životů s nepřítelem poblíž ustoupí do vlastního města nebo co nejdál od nepřátel a útočí jen na jistý zásah.
- Měření (dočasný skript, není v repu): nová AI proti předchozí na 100 seedech × obě strany = **118 z 200 výher (59 %)**. Vyzkoušené a zamítnuté varianty: pasivní posádka (jen bezpečné útoky) – výrazně horší (21/60); hlídání ohrožení do 3 polí – horší; soudržnost armády (penalizace vystavených polí) – bez efektu; ústup od 40 % životů – mírně horší. Proto jsou zvolené prahy 2 pole a 25 %.
- Testy: +3 logické (ohrožené prázdné město dostane posádku a po tahu ji má; těžce zraněná jednotka ustoupí a nezaútočí; jezdec dojede a dorazí oslabeného válečníka).
- Stav: `npm run check` zelený (30 logických testů + smoke).

## 2026-11-08 – Silnice
- Generátor mapy staví silnice: minimální kostra mezi všemi městy, každý úsek vede nejlevnější cestou terénem a slévá se s už hotovou silnicí (`buildRoads` v `map.js`). Mapa zůstává deterministická podle seedu.
- `stepCost()` v `game.js`: krok ze silnice na silnici stojí `ROAD_COST` = 0,5 bodu pohybu (jinak terén cílového pole). Trasa, dosah i AI to používají automaticky.
- Kreslení: hnědá cesta od středu pole k sousedům se silnicí, takže ji mlha ztmaví spolu s polem. Panel při najetí ukáže „silnice“. Body pohybu se zobrazují i s půlkami.
- Řeky jsem vynechal (úkol zněl „silnice nebo řeky“) a dal je do Nápadů.
- Struktura stavu: `state.version` 7 (`tile.road`); staré uložené mapy se načtou bez silnic.
- Smoke test: krok se stavbou trhu teď začíná v čerstvé hře – pasivní hráč ve smoke testu je díky rychlejší AI po silnicích dřív obsazený.
- Testy: +1 logický (silnice vedou přes všechna města a tvoří jednu síť, jen po průchodném terénu, krok po silnici je levnější, migrace). Test trasy počítá cenu přes `stepCost`.
- Stav: `npm run check` zelený (27 logických testů + smoke).

## 2026-11-08 – Kopiník a katapult
- Kopiník (12 zl., útok 3, obrana 4): `bonusVs: { horseman: 1 }` – proti jezdci dvojnásobná síla v útoku, obraně i protiúderu.
- Katapult (20 zl., útok 6, obrana 1, pohyb 1, dostřel 2, 7 životů): `siege: 0.5` – +50 % proti jednotkám ve městech a ignoruje hradby (ne základní bonus města).
- Boj: nové `vsMult()` a interní `attackPower()`; `defenseValue(state, unit, attacker)` bere útočníka v úvahu. Bez útočníka vrací totéž co dřív (tooltip, `cityInfo`).
- AI verbuje podle cílového poměru armády (`pickRecruit`): víc kopiníků, když vidí nepřátelské jezdce, katapulty od 8. kola.
- UI: popis schopnosti v panelu jednotky a v tooltipu tlačítka verbování.
- Testy: +3 logické (kopiník vs. jezdec v útoku i obraně a bez bonusu proti válečníkovi; katapult proti posádce s hradbami vs. lučištník; AI na jezdce odpovídá kopiníky a v simulacích verbuje oba nové typy).
- Stav: `npm run check` zelený (26 logických testů + smoke).

## 2026-11-08 – Zkušenosti a povýšení
- `RANKS` a `XP` v `rules.js`: Rekrut → Veterán (3 XP) → Elita (7 XP), každá hodnost +15 % útoku i obrany (i u protiúderu), povýšení vyléčí 3 životy.
- XP: útok +1, zničení cíle +1 navíc, přežitý útok +1 (obránce). `rankOf()`, `rankMult()` a interní `gainXp()` v `game.js`.
- Událost útoku nově nese výsledné životy a XP obou stran, takže přehrání (`applyEvent`) sedí přesně i s povýšením. Test přehrávání teď porovnává i XP.
- UI: zlaté hvězdičky nad jednotkou, v panelu skutečný útok/obrana s bonusem a řádek „Veterán ★ · XP 4/7“; při povýšení vyskočí „★ povýšení“.
- Struktura stavu: `state.version` 6 (`unit.xp`), migrace doplní 0.
- Testy: +2 logické (XP za útok/obranu/zničení; prahy hodností, bonus k útoku i obraně, povýšení s vyléčením a zápisem do kroniky).
- Stav: `npm run check` zelený (23 logických testů + smoke).

## 2026-11-08 – Budovy ve městech
- `BUILDINGS` v `rules.js`: Hradby (20 zl., posádka +50 % obrany), Trh (25 zl., +2 zlata za kolo), Kasárna (20 zl., verbování o 3 zlaté levnější). Účinky jsou v `BUILDING_EFFECTS`, ať se dají ladit na jednom místě.
- `build()`, `hasBuilding()`, `unitCost()`, `cityDefenseMult()` v `game.js`; příjem, obrana i cena verbování je berou v úvahu. Budovy při dobytí města zůstávají novému majiteli (dobývání se tak víc vyplácí).
- AI staví z přebytku zlata (rezerva 12 na jednotky): ohrožené město dostane hradby, jinak trh a kasárna, hlavní město napřed.
- UI: v panelu města sekce „Verbovat“ a „Stavět“ s cenou a popisem, postavené budovy jako štítky; na mapě kamenný lem (hradby), mince (trh) a praporek (kasárna).
- Drobnost: zprávy v kronice „naverbován X (město)“ místo nesklonného „v Nepřátelská pevnost“.
- Struktura stavu: `state.version` 5 (`city.buildings`), migrace doplní prázdné budovy.
- Testy: +2 logické (cena, zákaz dvojí stavby a stavby v cizím městě, trh zvýší příjem, hradby zvýší obranu a souhlasí s `cityInfo`, kasárna zlevní verbování; AI staví z přebytku; migrace). Smoke test postaví trh tlačítkem v panelu (`artifacts/screenshot-city-panel.png`).
- Stav: `npm run check` zelený (21 logických testů + smoke).

## 2026-11-08 – Ovládání dotykem
- Nový `src/input.js` s čistou funkcí `decideTap()`: co znamená klik/klepnutí (výběr, pohyb, útok, náhled). Myš jedná hned, dotyk (pointerType touch/pen) napřed ukáže trasu nebo odhad útoku v panelu a provede akci až po druhém klepnutí na stejné pole.
- Na úzkých displejích je tlačítko „Přiblížit mapu“: mapa má pak 820 px a posouvá se uvnitř rámečku (stránka se do šířky neposouvá, ověřuje smoke test). Políčko má pak na telefonu ~56 px místo ~27 px.
- Na dotyk se neukazuje plovoucí tooltip (překážel by prstu), náhled je v bočním panelu.
- Oprava staré chyby v kreslení: detail terénu (stromy, kopce, hory) přepsal cestu hexu, takže zvýraznění dosahu, ztmavení mlhou i obrys se u lesa/kopců/hor kreslily jen na poslední strom/kopec.
- Testy: +2 logické (náhled → potvrzení pohybu i útoku, zrušení klepnutím jinam, nepřítel v mlze nejde vybrat). Smoke test nově spouští telefon s dotykem (`hasTouch`), přiblíží mapu, vybere jednotku, ověří, že první klepnutí nepohne a druhé ano, a uloží `artifacts/screenshot-touch.png`.
- Stav: `npm run check` zelený (19 logických testů + smoke).

## 2026-11-08 – Výběr obtížnosti AI (běh pro v0.4.0)
- Tento běh je na Vladimírovu žádost delší než obvyklé max. 3 úkoly.
- `DIFFICULTY` v `rules.js`: snadná / normální / těžká. Mění zlato AI na startu a za kolo, opatrnost při útoku a to, jestli AI vidí přes mlhu.
- AI na snadné a normální teď respektuje mlhu války: míří jen na známá města a viditelné nepřátele, jinak prozkoumává (`aiKnowledge`, `goalsFor` v `ai.js`). Těžká AI vidí celou mapu jako dřív.
- Dialog „Nová hra“ (HTML `<dialog>`) s volbou obtížnosti a mlhy; poslední volba se pamatuje v localStorage. Obtížnost je vidět v bočním panelu.
- Struktura stavu: `state.version` 4 (`difficulty`), staré hry dostanou „normální“.
- Testy: +2 logické (zlato/příjem podle obtížnosti, normální AI na začátku nezná hráčovo město, simulace 6 her: těžká AI si vede lépe než snadná). Smoke test projde dialogem (těžká, bez mlhy) a uloží `artifacts/screenshot-dialog.png`.
- Pozor na balanc: „normální“ AI je teď slabší než dřív, protože už nepodvádí. Kdo chce původní sílu, má „těžkou“.
- Stav: `npm run check` zelený (17 logických testů + smoke).

## 2026-11-08 – Ukazatel verze (v0.3.0)
- Na přání Vladimíra: v záhlaví vedle názvu je verze hry (`v0.3.0`, po najetí myší i datum).
- Verze je v `src/version.js` a musí souhlasit s `package.json` – hlídá to nový test, smoke test kontroluje, že se v záhlaví opravdu zobrazí.
- Číslování zpětně: 0.1 základ, 0.2 trasa/Tab/info o městě, 0.3 animace a mlha války. `CLAUDE.md` nově říká zvýšit verzi v každém běhu.
- Stav: `npm run check` zelený (15 logických testů + smoke).

## 2026-11-08 – Mlha války
- `visibleTiles()`, `updateExplored()`, `exploredTiles()` v `game.js`. Dohled jednotek je v `rules.js` (`sight`: válečník a lučištník 2, jezdec 3), města 2, kopce +1 (`VISION`).
- Prozkoumaná pole se pamatují v `state.explored` (pole klíčů na hráče, JSON). `createGame({ fog })` umí mlhu vypnout, po konci hry se odkryje celá mapa.
- Kreslení: neprozkoumané pole je tmavé, prozkoumané a právě neviditelné ztmavené, cizí jednotky v mlze se nekreslí ani na ně nejde kliknout. Tah AI se animuje jen tam, kde na něj hráč vidí.
- Struktura stavu: `state.version` 3 (`fog`, `explored`), migrace z verze 1 i 2 v `migrateState()`.
- Testy: +1 logický (dohled kolem jednotek, nepřátelské hlavní město na začátku skryté, prozkoumané ⊇ viditelné a po pohybu neubývá, bez mlhy / po konci hry vidět vše); test migrace kontroluje dopočítání `explored`.
- Stav: `npm run check` zelený (14 logických testů + smoke).
- Známá omezení (vědomě nechaná na později, zapsaná v Nápadech): AI zatím vidí celou mapu; kronika vypisuje i akce AI v mlze; dosah pohybu nepočítá s pohybem na pole se skrytou nepřátelskou jednotkou (to pole prostě nejde označit, což trochu prozrazuje, že tam něco stojí).

## 2026-11-08 – Animace pohybu a útoku
- Akce v `game.js` zapisují události do `state.events` (pohyb s trasou, útok s poškozením, verbování, dobytí). `drainEvents()` je vybere, `applyEvent()` je umí přehrát na kopii stavu.
- Nový `src/anim.js`: přehrává události nad kopií stavu z doby před akcí – jednotky jdou po trase krok za krokem, útočník udělá výpad, nad cíli vyskočí čísla poškození, u dobytí „Dobyto!“. Animuje se tah AI i akce hráče.
- Klik do mapy nebo Esc animaci přeskočí; při `prefers-reduced-motion` se neanimuje vůbec.
- Struktura stavu: `state.version` zvýšena na 2 (pole `events`). `migrateState()` převede uložené hry verze 1, takže rozehrané hry se neztratí.
- Testy: +3 logické (přehrání událostí AI tahu dává přesně stejný stav jako skutečný tah na 4 seedech, událost pohybu nese trasu, migrace verze 1). Smoke test jede animace zrychleně, uloží snímek uprostřed tahu AI (`artifacts/screenshot-anim.png`) a ověří pohyb jednotky kliknutím.
- Stav: `npm run check` zelený (13 logických testů + smoke).

## 2026-11-08 – Příjem a obrana města při najetí
- `cityInfo()` a `cityIncome()` v `game.js`; bonus obrany města je konstanta `CITY_DEF_BONUS` (dřív natvrdo 1.25 v `defenseValue`).
- Tooltip u města (vlastník, příjem, obrana posádky, posádka) + stejné údaje v bočním panelu při najetí i při výběru města.
- Tooltip se drží uvnitř okna (`placeTip`).
- Testy: +1 logický (součet příjmů měst = `incomeOf`, procento obrany = `defenseValue`). Smoke test najede na vlastní město, ověří text tooltipu a uloží `artifacts/screenshot-city.png`.
- Stav: `npm run check` zelený (10 logických testů + smoke).
- Postřeh: neutrální města mají v kronice tvar „v Nepřátelská pevnost“ (chybí 6. pád) – drobnost na později.

## 2026-11-08 – Trasa pohybu a „další jednotka“ (Tab)
- `pathTo()` v `game.js`: nejlevnější trasa k cíli; `reachable()` teď sdílí stejné hledání (`searchMoves`), takže trasa a dosah nemůžou nesouhlasit.
- Při najetí na dosažitelné pole se kreslí žlutá čára se šipkou a tečkami na mezilehlých polích.
- `nextActiveUnit()` + klávesa Tab a tlačítko „Další jednotka“: cyklicky vybírá jednotky, které se ještě můžou hýbat nebo útočit.
- Testy: +2 logické (trasa po sousedních polích s cenou rovnou dosahu, cyklení Tab). Smoke test teď stiskne Tab a najede myší na nejvzdálenější pole, screenshot ukazuje šipku.
- Stav: `npm run check` zelený (9 logických testů + smoke).
- Postřeh na příště: na dotykovém zařízení najetí neexistuje – trasu bude dobré ukázat při potvrzení pohybu (úkol „Ovládání dotykem“).

## 2026-11-08 – Základ hry
- Hexová mapa 14×10 s generátorem terénu (deterministický podle seedu, startovní města vždy propojená).
- 3 typy jednotek, boj s protiúderem a bonusy terénu, 6 měst (2 hlavní + 4 neutrální), příjem zlata, verbování.
- AI: útočí, když se to vyplatí, jinak míří k městům a jednotkám, verbuje.
- UI: HUD, panel jednotky/města, kronika, tooltip s odhadem boje, ukládání do localStorage.
- Testy: 7 logických (včetně simulace AI vs AI), smoke test v headless Chrome + screenshoty.
- Stav: `npm run check` zelený.
