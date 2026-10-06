---
'@vosjs/elements': minor
'@vosjs/core': minor
'@vosjs/editor': minor
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

A text element's words can be styled in parts. `content` is a string, or a list of runs: `[{ "text": "Ship it " }, { "text": "faster", "weight": 700, "underline": true }]`. A run is a piece of text and the fields in which it departs from the element's `font` (`weight`, `italic`, `color`, `underline`, `strike`, `highlight`). It is the same shape a studio text layer's `text` takes, so styled words read and write one way wherever they are.

**`@vosjs/elements`**

- One layout and one painter for a text element, plain or styled, whole or `split`: a string is one run a line. Plain text draws exactly as it did; `scripts/verify-text-raster.mjs` holds 28 plain cases to the pixel against the renderer before this change.
- With `split`, a unit draws the styles of the characters it holds, so a word set half in bold is one unit.
- A run's `text` may be `{ "$data": "key" }`: a knob edits plain words under a fixed style, and a data edit redraws in place.
- `props.content` and `setContent` take a string or runs.
- New entry `@vosjs/elements/text`: the runs and their operations, the layout and the caret helpers, pure (no DOM, no three). They moved here from `@vosjs/studio-core`, which re-exports them unchanged.
- `layoutTextElement(element, probe)` in that entry is a text element's measured layout as a pure function: its lines, where each stretch stands, its padding and its box. The renderer paints from it over a probe on its raster canvas (`canvasTextProbe`), and a host that stands a caret on an element calls the same function over a canvas of its own.

**`@vosjs/core`**

- `TextRun` and `TextElementRun` types; `TextElement.content`, `ElementProps.content` and `setContent` take runs; `textRunSchema`.
- `VOS_BRIDGE_PROTOCOL` is 9: `SET_ELEMENT_PROPS` may carry `content` as a list of runs. An engine before it draws a list as text, so a host sends one only to an engine that advertises 9.
- `ELEMENT_RECTS` gives an element drawn as one plane its `quad`: its four corners on screen, top-left first and clockwise. The box only bounds a rotated or scaled element; the corners say where it is.
- `lintVosText` (`@vosjs/core/lint`): a run with no words (an error: the renderer skips it), a field that is not a run's, with the one that was meant (`bold` → `weight: 700`), a field of the wrong type, and a run weight no declared face of its family holds.

**`@vosjs/editor`**: `setElementProps` and `setTextContentRecipe` take runs. Runs written to a content bound to data land in its knob as their words.

**`@vosjs/studio-core`**: the styled-text modules come from `@vosjs/elements/text` and are built in, so the layout a host measures a layer with is the build its painter was generated from. Accepts `@vosjs/core` 0.28.

**`@vosjs/cli`**: `vos check` prints what `lintVosText` finds.
