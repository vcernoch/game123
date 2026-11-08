# Vývojový deník

Nejnovější záznam nahoře. Formát: datum – co se udělalo – stav testů – otázky pro Vladimíra.

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
