---
'@vosjs/core': patch
---

The capture templates inline the program through `inlineScriptSafe`, so a `</script` or `<!--` inside a function string can no longer end the page's script, and a string colour on `scene.background` or `scene.fog.color` is generated as a JSON literal.
