---
'@vosjs/core': minor
---

`text3d` object asset kind. Declarative world-space objects can now be
extruded 3D text: `{ kind: 'text3d', text, typeface, depth?, bevel?, color?,
metalness?, roughness?, unlit? }`, where `typeface` is a three.js typeface
JSON URL (FontLoader format). Geometry is centered and bbox-normalized like
GLB (largest dimension = 1 world unit), so `scale` means the same thing for
every asset kind. Declaring one auto-imports the FontLoader and TextGeometry
addons — objects are data, not code. Fail-open per object, like GLB.
