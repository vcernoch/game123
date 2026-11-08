# Vývojový deník

Nejnovější záznam nahoře. Formát: datum – co se udělalo – stav testů – otázky pro Vladimíra.

## 2026-11-08 – Základ hry
- Hexová mapa 14×10 s generátorem terénu (deterministický podle seedu, startovní města vždy propojená).
- 3 typy jednotek, boj s protiúderem a bonusy terénu, 6 měst (2 hlavní + 4 neutrální), příjem zlata, verbování.
- AI: útočí, když se to vyplatí, jinak míří k městům a jednotkám, verbuje.
- UI: HUD, panel jednotky/města, kronika, tooltip s odhadem boje, ukládání do localStorage.
- Testy: 7 logických (včetně simulace AI vs AI), smoke test v headless Chrome + screenshoty.
- Stav: `npm run check` zelený.
