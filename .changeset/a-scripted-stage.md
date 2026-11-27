---
'@vosjs/render-core': minor
'@vosjs/studio-core': patch
'@vosjs/cli': minor
---

A stage is scripted.

An `actions.json` is a stage's when it names `apps` where one app's names `app`. A step says which app it acts on with its own `app`; one that says none stays with the app of the step before it, and the first with the first app named. The app is brought forward when its step runs. A desktop drag may end at an element (`to`), and on a stage that element may be in another app: the thing is carried from one window into the other. A mask and a `setup` or `teardown` step say their app the same way. `viewport` and `--play` are refused on a stage, in words.

`vos record --actions <a stage's script>` records it like any scripted desktop take: setup off camera, masks, steps into `meta.steps`, teardown, `--strict`. `vos look --app <A> --app <B>` takes one picture of the stage and lists each app's controls. It needs `@vosjs/driver` 0.6.0, and says so when the installed helper is older.

The stage's camera shows a small window whole: when the least of the stage a beat may show would hold nearly all of a window, the beat frames the whole window instead of cutting a sliver off it.
