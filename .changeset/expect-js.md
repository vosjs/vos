---
'@vosjs/render-core': minor
'@vosjs/cli': minor
'@vosjs/studio-core': minor
---

`expect` and `await` check what an app keeps in script rather than in the DOM. `{ "do": "expect", "js": "window.app.count() === 14" }` holds when the expression, evaluated in the page (a promise is awaited), is truthy; with `equals` (`"js": "window.app.count()", "equals": 14`) it holds when the value equals that one, compared as JSON, and a miss says what the app had: ``js `window.app.count()` was 15, not 14, for 5 s``. An expression that throws is read again until the timeout and a miss says what it threw. `await` takes the same in `until`. The value the expression last answered is kept on the step as `meta.steps[].value` (`StepSpan.value`, its JSON at most 2 KB) and printed beside the step in a rehearsal. Timeouts, skips and `--strict` are an `expect`'s and an `await`'s; the CLI refuses an expression that does not parse before a browser opens (`vos validate actions.json` too), and `hostedRefusals` refuses a `js` check, since a hosted browser runs no code a submitted script hands it. `vos actions script` says a `js` check as the console expression to run.
