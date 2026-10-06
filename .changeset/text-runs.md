---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

Styled text is a list of runs.

- A text layer's `text` is a string, or a list of runs when parts of it are
  set differently: `[{ "text": "Ship " }, { "text": "faster", "weight": 700,
"underline": true }]`. A run is a piece of text and the fields in which it
  departs from its layer: `weight`, `italic`, `color`, `underline`, `strike`,
  `highlight`. There is no markup in the words, a style may start and end
  anywhere (mid-word, across a line break), and a per-unit entrance keeps
  every unit in its own style.
- `richText/runs` is every edit made to that list (`replaceRange`,
  `setStyle`, `toggleStyle`, `commonStyle`, `diffInput`, `normalizeRuns`),
  over offsets into the plain text. `overlayPlainText` is a layer's words;
  `styledTextOf` resolves its runs for the painter; `boldWeightFor` and
  `snapRunWeight` say what a weight paints as in the layer's family.
- `emphasis` and its `*markers*` are retired. A document that carries them
  is read into runs (document schema 6; the lowering reads them too), so it
  paints as it did. `parseEmphasis`, `overlayDisplayText`, `stripEmphasis`,
  `resolveEmphasis`, `EM_OPEN` and `EM_CLOSE` are removed.
- `vos validate` checks runs (an unknown field is an error that says what
  to write), warns on a weight the family cannot offer, and prints the runs
  to write for a layer still using `emphasis` or asterisks.
