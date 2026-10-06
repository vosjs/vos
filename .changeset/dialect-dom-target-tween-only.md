---
'@vosjs/core': patch
'@vosjs/studio-core': patch
'@vosjs/cli': patch
---

The `dom-target` dialect rule fires only on a TWEEN with a selector target: a string first argument followed by a vars object (`tl.to('.box', { x: 1 })`). It no longer fails ordinary JavaScript such as `map.set('key', 1)`, `Array.from('abc')` or `registry.set('name', fn)`, which `vos check` and the validate dry run used to refuse as errors.

`@vosjs/studio-core` exports `isLoweredRecording(config)`: whether a config is a recording's lowered program (its four functions are studio-core's own), so a host that lints an author's code can leave the generated code to the tests where it lives. `vos check` does: a recording's composed config no longer prints the engine's own timers and fetches as the author's, and a finding in another stack entry names its entry.
