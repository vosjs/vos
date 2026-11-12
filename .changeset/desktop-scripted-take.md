---
'@vosjs/cli': minor
'@vosjs/render-core': minor
---

A desktop app's take can be scripted: `vos record --app <name> --actions actions.json` runs the same `actions.json` a page's take runs, driving the app through accessibility while its window is recorded, and `vos look --app <name>` lists what the script can name.

- **The script.** `app` names the app (so `vos record actions.json` is enough), and `viewport` is the size its window is given first. A selector is a role, then what the element is called or its accessibility identifier: `button[name='Save']`, `textfield[id='title']`, `toolbar > button[name*='Share']`, `button[name='Delete']:nth(1)`. The steps are `wait`, `hover`, `click`, `type`, `press`, `scroll`, `move`, `drag` and `expect`, with `id`, `zoom`, `caption`, `read`, `guard` and `ms` as on a page. A page's fields (`url`, `mask`, `setup`, `teardown`, `ready`, `peers`) and steps (`paste`, `download`, `await`, an `expect` on `js`, a drag `path`) are refused before anything is recorded, each in words.
- **The take.** It keeps its script and its step spans (`meta.steps`, in the window's points), so the planner groups presses by step and pins, anchors, `--zooms per-beat` and recording again work as on a page take. A step whose element never appears is skipped and said; a disabled control is reached and not pressed; `--strict` exits 2 on either.
- **`vos look --app`.** `look.png` of the window as a take would show it, and each control with one proposed selector, UNIQUE or AMBIGUOUS. Nothing is pressed, and what was typed into a field is never read.
- **What it takes.** The app comes to the front and the real pointer and keyboard are used, so there is no `--dry-run` and nobody else can use the machine while it runs. If another app takes the keyboard, typing stops there. macOS, with Screen Recording and Accessibility granted to the app the CLI runs from; `vos doctor` says.
- `@vosjs/render-core/record` gains the step loop (`runDesktopSteps`) and `desktopProblems`, over a session the host hands in; the CLI hands in `@vosjs/driver` 0.2.
