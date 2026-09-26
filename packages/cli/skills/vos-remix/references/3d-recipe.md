# The 3D recipe — showcase a model

The 3D showcase programs (gallery tag `3d` — e.g. Studio Turntable, Dolly
Reveal: https://vos.so/gallery?tag=3d) are built to take a model swap.

## Steps

1. **Fetch** a 3d-tagged program: `vos fetch <its watch URL>`.
2. **Point it at the model**, either way:
   - Add or replace the async `setup` field to load a GLB by URL:
     ```js
     "setup": "async (ctx) => { const gltf = await new ctx.loaders.GLTFLoader().loadAsync('https://…/model.glb'); return { model: gltf.scene } }"
     ```
     then replace the `buildProduct()` body — it is commented as **THE SWAP
     POINT** in these programs — with the loaded `setupData.model`,
     bbox-normalized to ~1.7 units and grounded at `y = 0` (the templates
     ship the normalization snippet; keep it so `scale` knobs stay
     model-independent).
   - Or keep the template's own product and only retune params.
3. **The model URL must be CORS-clean and absolute `https`.** Assets
   uploaded to vos.so (`POST /api/assets/upload`, browser-session auth,
   `.glb`/`.gltf` ≤50MB) serve public+immutable with `ACAO: *` at
   `/api/assets/{id}/file` — bake that absolute URL into the config so the
   platform's preview render can fetch it. Any other host must send
   `Access-Control-Allow-Origin` and be publicly reachable.
4. **Knob honesty on GLBs**: the template's material knobs (hue, finish) do
   nothing on a GLB's own materials — declare only params that act
   (backdrop, light mood, camera pace, and whatever you wire yourself).
   Verify per `params-knobs.md` rule 2.
5. **Check and push** as usual: `vos check` → `vos push`. Humans do the
   same flow UI-side by dropping a GLB on https://vos.so/gallery.

## Server-render cautions (the preview fleet)

- No `THREE.DoubleSide` on transmission materials; no `dispersion`.
- Big GLBs slow the preview render — prefer draco-compressed models and
  keep textures ≤2K for the showcase context.
