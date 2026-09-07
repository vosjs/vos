---
'@vosjs/cli': minor
---

The CLI writes the one animation vocabulary and assembles templates.

- `vos plan` proposes the card's `anim.enter` (never `frame.entrance`), lays the templates the recipe names at their anchors (`LAUNCH.md` `with: <ref>[@end|@start|@step:<id>|@<seconds>], …`, `--with` repeatable, `endCard: <ref>` at the end; a ref is a doc.json, a take dir or a vos id) with the release's words and the brand's mark patched in by id and every clip stamped `from`, writes the house end card as clips after the footage plus a card exit (`from: 'endcard'`) when `endCard` is on or absent, and gives the captions `anim`. A previous cut carried by `--reuse` is read into the vocabulary first.
- `vos deliver`'s loop mechanics drop the card's `anim`, every clip a template placed and the captions; the cuts and the stills read the output's end (the clips after the footage included) rather than the footage's.
- `vos validate` warns on the older spellings (`frame.entrance`, `endCard`, a clip's `enter`/`exit`/`fx`, a prop's `animation`), which are read into `anim` on the way in.
