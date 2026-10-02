---
'@vosjs/core': minor
'@vosjs/cli': minor
---

A program can declare its canvas with `size: { width, height }`, at any shape (9:16, 4:5, 21:9 or any width and height): `vos render` and `vos still` output it by default, one of `--width`/`--height` keeps its aspect, `vos info` prints it, `vos preview` letterboxes to it, and `vos check` and `vos push` keep it instead of dropping it. `@vosjs/core` exports the shared rule (`programSize`, `resolveOutputSize`, `fitWithinEdges`) so every host sizes a program the same way.
