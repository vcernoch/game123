# Vývojový deník

Nejnovější záznam nahoře. Formát: datum – co se udělalo – stav testů – otázky pro Vladimíra.

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
