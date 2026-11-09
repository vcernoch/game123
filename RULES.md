# Guardrails for autonomous work

These always apply, even when you otherwise have a free hand.

## Git
- Commit and push only to the `dev` branch. Never push to `main` – Vladimír merges it.
- No `push --force`, no rewriting history, no deleting branches.
- Small commits with a clear message in English (what and why).

## Quality
- `npm run check` (logic tests + browser smoke test) must pass before committing.
- Don't delete or weaken existing tests to "fix" them. If a test doesn't fit a new rule, adjust it and explain why in LOG.md.
- If something can't be finished, commit only the working part or nothing, and note in LOG.md where you got stuck.

## Scope and decisions
- Free hand: game mechanics, balance, AI, graphics (drawn in canvas/SVG), UI, sounds generated in code.
- Wait for a decision (write the question in LOG.md and in the final report, and work on something else meanwhile) for:
  - fundamental changes to the genre or the victory rules,
  - adding a dependency on an external service, server or account,
  - anything involving money, ads or collecting player data.
- No third-party copyrighted images, fonts or music. Draw everything in code.

## Final report
- In English, briefly: what was added in this run, test status, any question.
