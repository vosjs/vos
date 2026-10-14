---
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

Three things a form needs from the recorder. `type` takes `replace: true` (the field's value is selected first, so what is typed replaces it: a form that opens filled in, a search box holding the last query) and `at: "end" | "start"` (the caret goes there after the focusing click, before the first character, so a code editor line is typed at its end). A `press` step presses one named key (`Escape`, `Enter`, `Tab`, `Backspace`, `Delete`, the arrows, `Home`, `End`, `PageUp`, `PageDown`, `Space`; never a character), recorded as a typing ping where the pointer is, or on `selector` with no click, so an Escape closes what a click opened and an Enter submits what was typed without a second click ringing on the field. `vos validate actions.json` holds all three, and `vos actions script` says them in words. And `read` on a field (an input, a textarea, a select) keeps its VALUE, what was typed, which its textContent never carried.
