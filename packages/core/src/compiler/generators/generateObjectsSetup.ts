/**
 * Generate world-space objects setup code for the animation template.
 *
 * Unlike elements (which delegate to the injected element-system bundle),
 * objects are fully self-contained codegen: primitives build from parameters,
 * GLB models load through the GLTFLoader addon import (auto-detected by the
 * compiler when a gltf asset is present). Each object becomes an
 * `ObjectInstance` `{ config, root, props, dispose }` in an id-keyed Map that
 * is exposed on the context (`ctx.objects`) and the result — the same
 * addressable contract as elements, which is what the bridge's
 * SET_OBJECT_PROPS / OBJECT_HIT_TEST commands operate on.
 *
 * `__syncObjects()` mirrors the props bag onto the meshes; the render loop
 * calls it every frame so prop changes (editor drags, tweens targeting
 * `ctx.objects.get(id).props`) apply without any per-object bookkeeping.
 * GLB roots are bbox-normalized at load (largest dimension = 1 world unit) so
 * `props.scale` is asset-independent.
 */
export function generateObjectsSetup(config: any): string {
  const objects = config.objects
  if (!objects || objects.length === 0) {
    return `
  // No declarative objects
  const objects = new Map();
  const __syncObjects = () => {};
`
  }

  const objectsJson = JSON.stringify(objects, null, 2).replace(/\n/g, '\n  ')

  return `
  // World-space objects (declarative)
  const objectsConfig = ${objectsJson};
  const objects = new Map();
  const __objBuild = async (cfg) => {
    let root;
    let dispose = () => {};
    if (cfg.asset.kind === 'gltf') {
      const gltf = await new Promise((res, rej) =>
        new GLTFLoader().load(cfg.asset.key, res, undefined, rej)
      );
      root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      box.getSize(size);
      root.userData.__objNorm = 1 / (Math.max(size.x, size.y, size.z) || 1);
      root.traverse((n) => {
        if (n.isMesh && n.material) {
          n.material = n.material.clone();
          n.material.transparent = true;
        }
      });
      dispose = () => root.traverse((n) => {
        if (n.geometry && n.geometry.dispose) n.geometry.dispose();
        if (n.material && n.material.dispose) n.material.dispose();
      });
    } else if (cfg.asset.kind === 'text3d') {
      // Extruded text from a typeface JSON (FontLoader format). Centered and
      // bbox-normalized like GLB, so props.scale is asset-independent.
      const a = cfg.asset;
      const font = await new Promise((res, rej) =>
        new FontLoader().load(a.typeface, res, undefined, rej)
      );
      const geo = new TextGeometry(a.text, {
        font,
        size: 1,
        height: a.depth == null ? 0.25 : a.depth,
        curveSegments: 8,
        bevelEnabled: a.bevel !== false,
        bevelThickness: 0.02,
        bevelSize: 0.015,
        bevelSegments: 2,
      });
      geo.computeBoundingBox();
      geo.center();
      const bb = geo.boundingBox;
      const dim = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
      const mat = a.unlit
        ? new THREE.MeshBasicMaterial({ color: a.color || '#e4e4e7', transparent: true })
        : new THREE.MeshStandardMaterial({
            color: a.color || '#e4e4e7',
            metalness: a.metalness == null ? 0.5 : a.metalness,
            roughness: a.roughness == null ? 0.4 : a.roughness,
            transparent: true,
          });
      root = new THREE.Mesh(geo, mat);
      root.userData.__objNorm = 1 / (dim || 1);
      dispose = () => { geo.dispose(); mat.dispose(); };
    } else {
      const a = cfg.asset;
      const geo = a.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 32, 20)
        : a.shape === 'torus' ? new THREE.TorusGeometry(0.4, 0.16, 20, 40)
        : a.shape === 'knot' ? new THREE.TorusKnotGeometry(0.35, 0.12, 80, 14)
        : new THREE.BoxGeometry(1, 1, 1);
      const mat = a.unlit
        ? new THREE.MeshBasicMaterial({ color: a.color || '#e4e4e7', transparent: true })
        : new THREE.MeshStandardMaterial({
            color: a.color || '#e4e4e7',
            metalness: a.metalness == null ? 0.5 : a.metalness,
            roughness: a.roughness == null ? 0.4 : a.roughness,
            transparent: true,
          });
      root = new THREE.Mesh(geo, mat);
      dispose = () => { geo.dispose(); mat.dispose(); };
    }
    const t = cfg.transform || {};
    const props = {
      x: t.x || 0, y: t.y || 0, z: t.z || 0,
      rx: t.rx || 0, ry: t.ry || 0, rz: t.rz || 0,
      scale: t.scale == null ? 1 : t.scale,
      opacity: 1,
      visible: cfg.visible !== false,
    };
    root.userData.__vosObjectId = cfg.id;
    scene.add(root);
    objects.set(cfg.id, { config: cfg, root, props, dispose });
  };
  // Fail-open per object: a bad asset skips its object, never the whole load.
  await Promise.all(objectsConfig.map((c) =>
    __objBuild(c).catch((e) => console.warn('[vos] object failed to build', c && c.id, e))
  ));
  const __syncObjects = () => {
    objects.forEach((o) => {
      const p = o.props;
      const norm = o.root.userData.__objNorm || 1;
      o.root.visible = p.visible !== false;
      o.root.position.set(p.x, p.y, p.z);
      o.root.rotation.set(p.rx * Math.PI / 180, p.ry * Math.PI / 180, p.rz * Math.PI / 180);
      o.root.scale.setScalar(p.scale * norm);
      if (o.root.isMesh) {
        if (o.root.material) o.root.material.opacity = p.opacity;
      } else {
        o.root.traverse((n) => { if (n.isMesh && n.material) n.material.opacity = p.opacity; });
      }
    });
  };
  __syncObjects();
`
}
