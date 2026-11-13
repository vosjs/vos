---
'@vosjs/cli': minor
'@vosjs/render-core': minor
'@vosjs/studio-core': patch
---

A desktop take played by a program, and what a film across several apps found.

- `vos record --app <name> --play play.mjs`: the window is recorded while your module drives it, for what answers back and a list of steps cannot play (a game, a chart that moves, a drag that depends on where something landed). The module's default export is `async (play, { window })`; `play` has `click`, `type`, `press`, `move`, `find`, `gone`, `sleep`, `now` and `send`. `click` and `type` keep a script's rules: an element is waited for, a disabled control is not pressed, nothing is typed where keys are commands, and whatever the program throws ends the take with the step it was in. `play.step(id, fn, marks)` names a stretch as a step of the take, so captions, pins and the plan hold on to it. An optional `take` export is a desktop script's head (`app`, `viewport`, `mask`, `setup`, `teardown`). `@vosjs/render-core/record` exports `desktopPlay` for a host of its own.
- A stretch marked as play (`zoom: false` on a play's step) is watched whole: the planner proposes nothing over it, and no zoom from either side reaches into it. A pointer that is steering is not pointing.
- A step's `payoff` mark is kept on the recorded step, so the film's payoff is found whether or not the script travelled with the take (a joined film's first input, a play).
- `vos validate`: a rejection of a later input's proposal is measured against that input's length. It was held to the first input's, so a proposal late in a longer take could not be rejected and every re-plan proposed it again.
- `vos validate`: a zoom over a press that focused a field to type into it is held to the typed line, from the field's left edge to the press, not to the whole field. An address bar and a terminal are as wide as their windows, and a zoom that framed the words was told it points beside them.
- Step captions (`vos plan --captions`, `vos join --captions`) sit at the top for an input whose lower third is where it was pressed or typed into (a chat's composer), one answer per input, and the plan says so.
- A wait on a desktop take (`expect`, a play's `find` and `gone`) looks again when the window's tree cannot be read for a moment, up to its own deadline, so a long wait is not ended by a window that moved or was covered.
