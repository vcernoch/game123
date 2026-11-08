# Hexová říše – pokyny pro Claude

Tahová strategie v prohlížeči (čisté HTML + JS moduly, canvas, žádný build).
Hraje se proti AI na hexové mapě. Kód a texty ve hře jsou česky.

## Struktura
- `index.html`, `style.css` – stránka a UI
- `src/hex.js` – hexová geometrie (axiální souřadnice, pointy-top)
- `src/rng.js` – deterministické RNG (seed)
- `src/rules.js` – herní data a balanc (terén, jednotky, ekonomika)
- `src/map.js` – generátor mapy
- `src/game.js` – čistá herní logika bez DOM, stav je JSON
- `src/ai.js` – AI protivník
- `src/render.js` – kreslení na canvas
- `src/input.js` – co znamená klik/klepnutí na pole (čistá funkce, dotyk s potvrzením)
- `src/anim.js` – přehrávání herních událostí (`state.events`) jako animací
- `src/version.js` – verze hry zobrazená v záhlaví (musí sedět s `package.json`)
- `src/main.js` – ovládání, HUD, ukládání do localStorage, háček `window.__game` pro testy
- `tests/logic.test.js` – testy logiky (`npm test`)
- `tests/smoke.mjs` – headless Chrome test + screenshoty do `artifacts/` (`npm run smoke`)
- `tools/serve.mjs` – lokální server (`npm run serve`)

## Autonomní vývojový běh
Když tě spustí naplánovaná úloha, postupuj takto:

1. Přečti `RULES.md`, `ROADMAP.md` a posledních ~5 záznamů v `LOG.md`.
2. Pracuj ve větvi `dev` (založ ji z `main`, pokud neexistuje; jinak ji stáhni a pokračuj na ní).
3. `npm ci` a `npm run check` – ověř, že výchozí stav je zelený. Pokud ne, nejdřív oprav.
4. Vyber **jeden** úkol: první nezaškrtnutý v aktuální fázi `ROADMAP.md`. Pokud je fáze hotová, můžeš vymyslet
   vlastní vylepšení – zapiš ho do roadmapy dřív, než na něm začneš pracovat.
5. Implementuj ho. Logiku drž v `src/game.js` / `src/rules.js` (bez DOM) a přidej k ní test.
6. `npm run check` musí projít. Prohlédni si `artifacts/screenshot.png` a `artifacts/screenshot-mobile.png`
   (nástrojem Read), jestli UI vypadá dobře.
7. Zvyš verzi v `package.json` a `src/version.js` (nové funkce = druhé číslo, opravy = třetí; jednou za běh)
   a uveď ji v záznamu v `LOG.md`. Odškrtni úkol v `ROADMAP.md`, přidej záznam do `LOG.md`, commitni a pushni do `dev`.
8. Pokud zbývá čas a kontext, můžeš vzít další úkol (max 3 za běh). Kvalita před kvantitou.
9. Na konci pošli uživateli krátkou zprávu (česky, 2–4 věty): co přibylo, a pokud něco potřebuješ
   od něj (rozhodnutí, sloučení do `main`), napiš to jasně na začátek.

## Konvence
- ES moduly, žádné frameworky ani build krok. Externí knihovny jen s dobrým důvodem a zapsáním do LOG.md.
- Malé, čitelné funkce; komentáře česky tam, kde to není zřejmé.
- Stav hry musí zůstat serializovatelný do JSON. Při změně struktury zvyš `state.version` v `createGame`.
- Hra musí fungovat na mobilu (šířka 390 px, bez vodorovného scrollu) – kontroluje to smoke test.
