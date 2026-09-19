---
'@vosjs/core': minor
'@vosjs/cli': minor
---

`vos check` catches two programs that used to pass clean and then disappoint at render.

`repeat: -1` on a tween is now a dialect error. GSAP answers an infinite repeat by giving the timeline its infinity sentinel, so the program's duration reads 10000000000 seconds instead of its real length and anything placed after that tween is unreachable. The compiled timeline already loops on its own, so the infinite repeat was never buying the loop it looked like it was buying. A finite `repeat` is untouched.

A postprocessing chain that never applies `{ type: 'output' }` is now a warning, and so is one where that pass is not last. The output pass is what applies tone mapping and converts to the renderer's output color space; every pass before it works in linear space on a render target. A chain that simply stops after its last effect hands the screen an image the renderer never got to finish, so the same scene looks different with the chain than without it. The schema cannot see this — `postprocessing` is a list, and every ordering of a list is a valid list. Both composer chains are checked, and the message names which one it means.
