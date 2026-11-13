---
'@vosjs/cli': patch
'@vosjs/render-core': patch
---

`vos validate actions.json` knows a desktop app's script. One that names its `app` is held to what a desktop take can run (a page's fields and steps are named, as `vos record --app` names them), and `--app` or `--pid` says so for a script that does not name its app. A page's `type` with `focus: false` and no selector now says how a desktop script differs, where it used to say only "type needs a selector": a cold agent's valid desktop script was refused with those words and no way to tell why.
