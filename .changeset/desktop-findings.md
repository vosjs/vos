---
'@vosjs/cli': minor
'@vosjs/render-core': minor
'@vosjs/studio-core': patch
---

A desktop script: selectors refused when it is read, masks, and its own setup and teardown. A joined take's digest covers every input. A step can say it is the film's payoff.

- A selector that is not one in the desktop dialect is refused by `vos validate`, `vos look --app` and `vos record --app` before a step runs. A take presses the real app, and `popup[name^='Folder']` used to stop one at the step that named it, after the steps before it had run.
- `mask` in a desktop script covers what each selector names before a frame is encoded (the helper's work, `@vosjs/driver` 0.4.0). A driver that cannot cover a mask is refused before anything is recorded.
- `setup` and `teardown` in a desktop script run the page's verbs through a driver session that is not the take, so a rehearsal's leftovers are the script's to undo. `teardown` runs after a take that stopped early and after a look's walk.
- `vos digest` on a joined take digests each input after the first beside it (`digest/m1/digest.json`, its own sheet and crops), with source times in that input's footage and output times in the film's. It used to list the first input's moments alone.
- `"payoff": true` on a step says it is the film's payoff, where `vos music pick` and `vos score` land the swell. Without it the rule is unchanged (the last step marked `zoom: true`), and an end card's clips are no longer taken for the payoff when nothing is marked.
