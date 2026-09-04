---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

The release kit composes. studio-core: `frame.inset` (per-side card placement as fractions, a negative side bleeds), `frame.shadowContact` and `frame.shadowColor`, a pure `look` module (plate, gradient, dark; `lookFromBrand`, `cardInset`, `applyLook`), `frame.entrance` (tilt-in, pull-out, rise) lowered into the tilt or zoom track's head plus a card-pose track, a segment `hold`, `doc.endCard`, `frame.focusFollow`; the channel specs carry a word policy, a safe rect and a default poster template per destination.

CLI: `vos deliver` presents cards and cuts in a look read from `BRAND.md` beside the take (or `--look`), picks its still moments from the step timeline and drops blank or duplicate frames with the reason, renders every card destination from a bundled poster template (`split-cover`, `card-on-gradient`) filled with the brand's colours and faces and `LAUNCH.md`'s headline, bakes the shot as an object, and plans each video by kind (entrance, end card, beat captions from `actions.json`, a music bed and click sounds where the channel plays sound, the 9:16 reframe). `vos validate <kit.json> --picture` reads what each asset looks like (blank, duplicate, subject, separation, halfsize, sliced, safe, contrast, firstlast) with a code, a fix hint and a box. `vos judge <kit.json> --against <manifest>` composes pairwise sheets beside a reference set and reports the win rate. `vos brand` writes a `look` role.
