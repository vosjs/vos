/**
 * What the editor bridge may pick and box: the meshes an element actually
 * SHOWS. Plain page JavaScript (the template embeds it verbatim inside the
 * editor API), kept in its own module so the rules can be run in a test.
 *
 * - An element is all of its meshes: a split text is one mesh per unit, so
 *   `inst.meshes()` (elements >= 0.10.1) lists them. An older instance
 *   without it falls back to `inst.mesh`, which for a split text is only its
 *   first unit.
 * - A mesh is seen when it and every ancestor are visible AND its material
 *   draws something: a transparent material at opacity <= 1% does not. An
 *   element faded out at this moment (an entrance before it starts, an exit
 *   after it ends) is not under the pointer, so a press goes through it to
 *   what IS there, and its rect reports `visible: false`.
 */
export const ELEMENT_PICK_JS = `
            const __PICK_MIN_OPACITY = 0.01;
            const __elementMeshes = (inst) => {
                const list = inst && typeof inst.meshes === 'function' ? inst.meshes() : null;
                if (list && list.length) return list.filter(Boolean);
                return inst && inst.mesh ? [inst.mesh] : [];
            };
            const __meshSeen = (mesh) => {
                if (!mesh || mesh.visible === false) return false;
                for (let p = mesh.parent; p; p = p.parent) {
                    if (p.visible === false) return false;
                }
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                return mats.some((m) =>
                    !m || m.visible === false ? false
                        : m.transparent !== true || typeof m.opacity !== 'number' || m.opacity > __PICK_MIN_OPACITY);
            };
`
