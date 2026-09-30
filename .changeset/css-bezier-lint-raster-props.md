---
'@vosjs/core': patch
---

The dialect lint accepts `css-bezier(x1, y1, x2, y2)`: `vos check` warned that it "would fall back to linear" while the evaluator resolves it, so every program using a CSS curve got a false warning. A CSS `cubic-bezier(…)` and a `css-bezier` with the wrong number of arguments still warn.

`ElementProps` declares what an element's props accept at runtime beyond the transform: `zIndex`, and the text raster props `content`, `fontFamily`, `fontWeight`, `fontStyle`, `color`, `strokeColor` and `strokeWidth` beside `fontSize` and `letterSpacing`. Each of the text ones re-rasters the element when written.
