---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

One animation vocabulary on every visual primitive, and the output ends at the last clip.

- `anim` (`enter`, `exit`, `idle`; a kind, or a step with its seconds and, for words, the per-unit grammar) on the card (`frame.anim`), on text, image and video clips, and on props. `frame.entrance`, a clip's `enter`, `exit` and `fx`, and a prop's `animation` are read into it on migration and lower to the same picture; the fields stay accepted as legacy input for one cycle.
- The output lasts until the last visual clip ends (`docOutputDuration`, the lowering's `duration`); past its footage the card holds its last frame at the pose its `anim.exit` settled into (`recede` keeps it small and dim behind whatever plays after it, `fade` takes it out), and a `hold` stays the freeze primitive. A document that ends on its footage lowers byte-identically. Audio never extends the output.
- `doc.endCard` migrates on read into clips placed after the footage (stamped `from: 'endcard'`) plus a card `exit` of `recede`, so an end card is nothing but primitives a timeline can show and a person can retype in place. `expandEndCard` survives, deprecated.
- `from` on overlay, prop and audio clips: the template that placed them, provenance the lowering never reads.
- `applyTemplate(template, take, { at, words, keys, from, look })`: a template is a plain take document on a shelf, applied at an anchor (`start`, `end`, or an output second) with the release's words and keys patched in by id; `clipsFrom` and `dropTemplate` read and remove what one template placed. `copyLayout` stays, and a layout's frame fields now carry the card's `anim` in place of `entrance`.
- `docSchemaVersion` 3; `migrateHostedDoc` rewrites a recording document's motion spellings into the vocabulary.
- The CLI's schema and `vos validate` accept `anim` and `from`, checked per primitive (the card cannot typewrite, a word cannot tilt in, only a prop idles).
