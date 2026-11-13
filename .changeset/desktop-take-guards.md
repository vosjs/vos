---
'@vosjs/cli': minor
'@vosjs/render-core': minor
---

A scripted desktop take is safe to get wrong: it stops at the first step that misses, checks where the keyboard is before it types, and can be aimed at one process. Found by filming VS Code end to end.

- **A desktop take stops at the first miss.** An element that never appeared, an `expect` that never held, or a disabled control ends the take there (exit 1, the step and the reason), where it used to go on and type the rest of the script into whatever had focus. `"onSkip": "continue"` in the script goes on, and `--strict` then fails the miss.
- **Typing checks where the keyboard is.** Before the first key of a `type`, the take asks what has focus and refuses to type onto a row, a button or anything else where a key is a command. A `type` may leave `selector` out with `"focus": false` to type where the keyboard already is, and a new line in `text` is the Return key.
- **`--pid <n>`** on `vos record` and `vos look`: one process's window. `vos record --windows` shows each window's process. Two instances of one app share a name, and `--app` picks the largest window of that name.
- **`vos look --app … --actions actions.json --until <step id>`** runs the script to that step, for real, then looks, and keeps no take.
- **Electron and Chromium apps.** `vos look --app` says when such an app has not built its accessibility tree, and what to do (`--force-renderer-accessibility` at launch).
- **`vos look --app` says when the outline carries a file path the picture does not show.**
- The short `vos help` lists the scripted desktop take and `look --app`.
- `@vosjs/render-core/record`: `runDesktopSteps` takes `until`; `validateActions` takes `{ desktop }`; `onSkip` on the script. Needs `@vosjs/driver` 0.3.
