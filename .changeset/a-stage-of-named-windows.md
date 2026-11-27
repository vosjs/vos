---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

A stage: several apps in one take.

`vos record --app <name> --app <name>` records one display with only the named apps' windows in its pixels, each where it is and in its real order. No other app, no wallpaper, no Dock and no menu bar is recorded, and a named window that something else covers on screen is recorded whole. `--stage` with one `--app` (or a `--pid`) is that app's every window; `--desk menubar,dock,wallpaper` keeps a part of the desk. There is no flag that records the screen as it is. A stage is performed: `--actions`, `--play` and a mask are refused with it. It needs `@vosjs/driver` 0.5.0 or later, and says so when the installed helper is older.

studio-core reads the take: `captureSurface: 'desktop'` keeps its cursor as an `'app'` take does and draws no bar, and `meta.apps`, `meta.desk` and `meta.windows` (where the stage's windows were, front to back, every time that changed) are part of `RecordingMeta`.

With `meta.windows` the zoom planner knows that a press belongs to a window. A stage is cut into visits, each visit is planned as a take of that window alone would be and mapped back onto the stage, a beat's view stays inside its window and never shows less of the stage than a reader needs, and the camera rests on the window between beats (spans `w0`, `w1`, …). Presses in two windows are never one beat. A window being moved is not chased, a press in an app's alert or tip belongs to that app's window, and a press on the ground between windows is planned against the stage. A take with no `meta.windows` plans as before.
