---
'@vosjs/elements': patch
'@vosjs/core': patch
'@vosjs/cli': patch
---

An element's `anchor` is read. With an `{x, y}` position it names the point of the box that sits there (`anchor: 'center'` centres a caption on `x: '50%'`; `'bottom-right'`, `'top'` and the rest likewise); a preset position ignores it, and an element without one keeps its box's top-left corner on the point, as before. The bundled skills say so, where one called the default `center` and another said the field was not read.
