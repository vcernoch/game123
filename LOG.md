# Vývojový deník

Nejnovější záznam nahoře. Formát: datum – co se udělalo – stav testů – otázky pro Vladimíra.

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
