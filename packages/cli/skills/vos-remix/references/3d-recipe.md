# The 3D recipe — showcase a model

The 3D showcase programs (gallery tag `3d` — e.g. Studio Turntable, Dolly
Reveal: https://vos.so/gallery?tag=3d) are built to take a model swap.

## Steps

1. **Fetch** a 3d-tagged program: `vos fetch <its watch URL>`.
2. **Give it the model**, either way:
   - Put the `.glb` beside `config.json`, declare it, and read it by name
     (the one rule for a program's own files; see the vos-authoring
     skill's Declared Files):
     ```json
     "assets": { "product": { "ref": "./chair.glb", "kind": "model" } },
     "setup": "async (ctx) => { const gltf = await new ctx.loaders.GLTFLoader().loadAsync(ctx.assets.product); return { model: gltf.scene } }"
     ```
     then replace the `buildProduct()` body — it is commented as **THE SWAP
     POINT** in these programs — with the loaded `setupData.model`,
     bbox-normalized to ~1.7 units and grounded at `y = 0` (the templates
     ship the normalization snippet; keep it so `scale` knobs stay
     model-independent).
   - Or keep the template's own product and only retune params.
3. **Never type the model's URL or path inside a function string.**
   `vos render` and `vos preview` serve the declared file to the page;
   `vos push` uploads it once and stores the program naming it
   `asset:<id>`, which is what lets the platform's own render of a PRIVATE
   program fetch it. A URL baked into `setup` plays on your machine and
   then draws nothing there. A file is never readable by its address
   alone: it is served to whoever can open a program that uses it. A
   `.glb` only (a `.gltf` with files beside it is refused: export one
   `.glb`), up to 50 MB.
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
