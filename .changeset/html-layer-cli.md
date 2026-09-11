---
'@vosjs/cli': minor
---

`doc.json` accepts a `kind: 'html'` overlay clip (`html`, `css`, `box`, `bleed`, `fonts`): `vos validate` runs the layer's gate and says in words what would silently not paint, `push` and `pull --media` pass it through untouched (it has no key and is never an upload), and a template's html clips apply with nothing to swap.
