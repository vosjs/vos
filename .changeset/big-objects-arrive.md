---
'@vosjs/core': minor
---

Declarative world-space objects: `objects?: ObjectConfig[]` in VosConfigJson — engine-managed 3D props in the main scene (parametric primitives or GLB models by URL, bbox-normalized so `transform.scale` is asset-independent), addressable by id like elements. The editor bridge (protocol 3) gains `SET_OBJECT_PROPS` (ephemeral prop overrides for gesture-time preview) and `OBJECT_HIT_TEST` (a main-camera raycast returning the nearest object id). GLTF objects auto-detect the GLTFLoader addon. Fully additive — configs without `objects` compile byte-identically.
