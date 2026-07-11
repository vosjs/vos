---
'@vosjs/timeline': minor
---

`css-bezier(x1, y1, x2, y2)` ease — the CSS cubic-bezier timing function as a
dialect-only ease name (deliberately not a GSAP name, so it can never shadow
one). Resolves through `resolveEase`/keyframe `ease` everywhere the registry
names work, including the inlined runtime bundle. Newton–Raphson with a
bisection fallback; x control points clamped to [0, 1] per the CSS invariant,
y control points may overshoot. Unknown/malformed forms still fall back to
linear (evaluation never throws per-frame).
