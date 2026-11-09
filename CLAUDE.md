# Hex Realm – instructions for Claude

A turn-based strategy game in the browser (plain HTML + JS modules, canvas, no build).
Played against an AI on a hex map. Code, comments and in-game texts are in English.

## Structure
- `index.html`, `style.css` – page and UI
- `src/hex.js` – hex geometry (axial coordinates, pointy-top)
- `src/rng.js` – deterministic RNG (seed)
- `src/rules.js` – game data and balance (terrain, units, economy)
- `src/map.js` – map generator
- `src/game.js` – pure game logic without DOM, state is JSON
- `src/ai.js` – AI opponent
- `src/render.js` – drawing on the canvas
- `src/input.js` – what a click/tap on a tile means (pure function, touch with confirmation)
- `src/sound.js` – sound effects synthesized via WebAudio (no recordings)
- `src/stats.js` – strength chart and statistics summary as an SVG string (pure function)
- `src/anim.js` – plays back game events (`state.events`) as animations
- `src/version.js` – game version shown in the header (must match `package.json`)
- `src/main.js` – controls, HUD, saving to localStorage, `window.__game` hook for tests
- `tests/logic.test.js` – logic tests (`npm test`)
- `tests/smoke.mjs` – headless Chrome test + screenshots into `artifacts/` (`npm run smoke`)
- `tools/serve.mjs` – local server (`npm run serve`)

## Autonomous development run
When a scheduled task starts you, proceed as follows:

1. Read `RULES.md`, `ROADMAP.md` and the last ~5 entries in `LOG.md`.
2. Work on the `dev` branch (create it from `main` if it doesn't exist; otherwise pull it and continue on it).
3. `npm ci` and `npm run check` – verify the starting state is green. If not, fix it first.
4. Pick **one** task: the first unchecked one in the current phase of `ROADMAP.md`. If the phase is done, you may come up
   with your own improvement – write it into the roadmap before you start working on it.
5. Implement it. Keep logic in `src/game.js` / `src/rules.js` (no DOM) and add a test for it.
6. `npm run check` must pass. Look at `artifacts/screenshot.png` and `artifacts/screenshot-mobile.png`
   (with the Read tool) to check the UI looks good.
7. Bump the version in `package.json` and `src/version.js` (new features = second number, fixes = third; once per run)
   and mention it in the `LOG.md` entry. Check off the task in `ROADMAP.md`, add an entry to `LOG.md`, commit and push to `dev`.
8. If time and context remain, you may take another task (max 3 per run). Quality over quantity.
9. At the end, send the user a short message (in English, 2–4 sentences): what was added, and if you need anything
   from him (a decision, a merge into `main`), state it clearly at the start.

## Conventions
- ES modules, no frameworks or build step. External libraries only for a good reason and noted in LOG.md.
- Small, readable functions; comments in English where things aren't obvious.
- Commit messages in English.
- Game state must stay serializable to JSON. When the structure changes, bump `state.version` in `createGame`.
- The game must work on mobile (390 px width, no horizontal scroll) – the smoke test checks this.
