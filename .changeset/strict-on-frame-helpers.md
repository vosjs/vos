---
'@vosjs/studio-core': patch
---

A take with a webcam plays again. The card painter's two helpers, the rounded rect and the cursor, were declared inside the per-pass loop, and the cam bubble and the boundary cursor call them after it. A compiled program is a module, so strict, and a function declared in a block does not exist outside it: every frame of a take with a visible webcam (or a cursor across a transition) threw `rr is not defined` and nothing rendered. Both now stand before the loop, and every test that evaluates a generated painter runs it strict, as the browser does.
