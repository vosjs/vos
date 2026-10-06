---
'@vosjs/elements': minor
'@vosjs/core': minor
'@vosjs/editor': minor
'@vosjs/studio-core': patch
'@vosjs/cli': patch
---

A run's colour can be bound to data, and a host can put a font face on the running page before the program declares it.

**A run's `color` and `highlight` take `{ "$data": "key" }`**, the spelling the element's own `font.color` already takes: one knob turns the accent of every word that wears it, with no edit to the text and no reload.

```json
"content": [
  { "text": "Ship it " },
  { "text": "faster", "weight": 700, "color": { "$data": "accent" } }
]
```

- A binding is a value like any other in the run operations (`@vosjs/elements/text`): it rides its run through typing, a cut and a merge, two runs bound to the same key are one run, and a literal set over part of it replaces it there alone. `resolveRunColors(text, data)` reads the bindings where a run is drawn; a key that holds no string paints the element's own colour.
- `props.content` and `setContent` may carry bindings: they are read against the data as it stands, and again whenever it moves. The element keeps what was WRITTEN, so a later data edit still reaches it.
- `resolveTextContent(content, data)` and `contentIsBound(content)` replace `resolveBoundRuns`, which took a list of indices; `TextBindings.runs` is `true` when any run reads data.
- `lintVosText` takes a bound colour, and warns when a run reads a key `config.data` does not hold (`unbound-run-key`): the run draws no words, or the element's own colour, until a value arrives.

**`REGISTER_FONTS`** (editor mode, `VOS_BRIDGE_PROTOCOL` 10; `registerFonts` on the editor bridge client): a host hands the page `{ family, url, weight?, style? }` faces to register now. A weight previewed in an edit that is not committed used to be faked from the regular face until the commit's reload; with its face on the page it is drawn as it will be. Each face is registered once, and text elements are drawn again when one lands. An engine before 10 ignores the message.

`FontFaceDecl` is exported from `@vosjs/core`. `@vosjs/studio-core` accepts `@vosjs/core` 0.29.
