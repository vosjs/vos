---
'@vosjs/studio-core': minor
---

Text layers are laid out by one module and a held layer costs nothing.

- `layoutText` (fragments, the word wrap, per-unit entrance units,
  decoration rectangles) and the caret helpers (`caretStops`, `caretAt`,
  `offsetAtX`, `rangeRects`) are one pure, measurement-injected module. The
  studio entry carries a generated copy of it, so the page that paints a
  text layer and the host that picks it run the same code.
- A text layer with emphasis is painted from that layout, kept per clip:
  a frame that only moves, fades or reveals the layer measures nothing.
  Its pixels are unchanged.
- The overlay layer repaints when what it shows changed, while something on
  it animates, once after an animation ends, and once when a font face
  lands. It used to repaint and upload its texture on every frame any
  overlay was visible.
- `measureEmphasized` is removed (the layout module replaces it), and a
  lowered emphasis clip carries `rt` (its runs) where it carried `em`.
  `styledTextOf` is the styled payload of a clip.
