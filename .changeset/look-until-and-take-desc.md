---
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

`vos look --actions actions.json --until <step id>` walks the script's own steps the way a rehearsal does (its setup, its masks, its session; a spend-guarded step hovered and never pressed), stops after the step named, and looks at the page as that step left it, so the state behind a click that creates (a dialog that shows a new key) is seen without a script of your own. The steps after it never run, the script's teardown runs after the look, a step skipped on the way exits 2, and an id the script does not have is refused with the ids it has. render-core's rehearsal takes the hook as `until: { id, at(page) }`.

`vos push <take> --desc "<sentence>"` carries the watch page's description with a recording, as `--prompt` already did: the first push creates the vos with it, a later push that names it replaces it on the vos (never on a version), on a take, a claimable take and a program alike. A description longer than 500 characters, or empty, is refused before anything uploads. A program push now takes `--desc` on an existing vos too.
