# Mantinely pro autonomní práci

Tohle platí vždy, i když máš jinak volnou ruku.

## Git
- Commituj a pushuj jen do větve `dev`. Do `main` nikdy nepushuj – slučuje ho Vladimír.
- Žádný `push --force`, žádné přepisování historie, nemazat větve.
- Malé commity s výstižnou zprávou česky (co a proč).

## Kvalita
- `npm run check` (logické testy + smoke test v prohlížeči) musí před commitem projít.
- Nemaž ani neoslabuj existující testy, abys je „opravil“. Když test nesedí s novým pravidlem, uprav ho a napiš proč do LOG.md.
- Pokud něco nejde dokončit, commitni jen funkční část nebo nic, a zapiš do LOG.md, kde ses zasekl.

## Rozsah a rozhodnutí
- Volná ruka: herní mechaniky, balanc, AI, grafika (kreslená v canvasu/SVG), UI, zvuky generované v kódu.
- Na rozhodnutí počkej (napiš otázku do LOG.md a do závěrečné zprávy a pracuj mezitím na něčem jiném) u:
  - zásadní změny žánru nebo pravidel vítězství,
  - přidání závislosti na externí službě, serveru nebo účtu,
  - čehokoli s penězi, reklamami nebo sběrem dat hráčů.
- Žádné cizí obrázky, fonty ani hudba chráněné autorským právem. Vše si nakresli v kódu.

## Závěrečná zpráva
- Česky, stručně: co přibylo v tomto běhu, stav testů, případná otázka.
