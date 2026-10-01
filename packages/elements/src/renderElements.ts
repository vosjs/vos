import { preloadAssets } from './assetCache'
import {
  createElementProps,
  createSplitGroup,
  createSplitGroupProps,
  relayoutSplitGroup,
} from './createElementProps'
import type { SplitGroup } from './createElementProps'
import { extractTextBindings, resolveTextElement } from './dataBinding'
import { renderAudioElement } from './renderers/audio'
import { renderImageElement } from './renderers/image'
import { renderSVGElement } from './renderers/svg'
import {
  mergeQueuedPatches,
  rasterPropPatch,
  renderSplitTextElement,
  renderTextElement,
} from './renderers/text'
import { renderVideoElement } from './renderers/video'
import type * as THREE_NS from 'three'

/**
 * Calculate position from config
 */
function calculatePosition(
  position: any,
  resolution: any,
  elementWidth: number,
  elementHeight: number,
) {
  const { width, height } = resolution
  const halfW = elementWidth / 2
  const halfH = elementHeight / 2

  if (typeof position === 'string') {
    switch (position) {
      case 'center':
        return { x: width / 2 - halfW, y: height / 2 - halfH }
      case 'top-left':
        return { x: 0, y: 0 }
      case 'top-center':
        return { x: width / 2 - halfW, y: 0 }
      case 'top-right':
        return { x: width - elementWidth, y: 0 }
      case 'center-left':
        return { x: 0, y: height / 2 - halfH }
      case 'center-right':
        return { x: width - elementWidth, y: height / 2 - halfH }
      case 'bottom-left':
        return { x: 0, y: height - elementHeight }
      case 'bottom-center':
        return { x: width / 2 - halfW, y: height - elementHeight }
      case 'bottom-right':
        return { x: width - elementWidth, y: height - elementHeight }
      default:
        return { x: 0, y: 0 }
    }
  }

  const x =
    typeof position.x === 'string'
      ? (parseFloat(position.x) / 100) * width
      : position.x
  const y =
    typeof position.y === 'string'
      ? (parseFloat(position.y) / 100) * height
      : position.y
  return { x, y }
}

// Design resolution baseline
const DESIGN_HEIGHT = 1080

/**
 * Render all elements to a dedicated overlay scene with pixel-space camera.
 */
export async function renderElements(
  elementsConfig: any[],
  overlayScenes: Record<number, THREE_NS.Scene>,
  resolution: any,
  THREE: typeof THREE_NS,
  data?: Record<string, unknown> | null,
) {
  const getScene = (config: any) => overlayScenes[config.zIndex ?? 100]
  await preloadAssets(elementsConfig)

  const elementMap = new Map()
  const resolutionScale = resolution.height / DESIGN_HEIGHT

  for (let i = 0; i < elementsConfig.length; i++) {
    // {$data} bindings resolve into a working copy; the raw config keeps the
    // refs so the instance can re-resolve against fresh data on setData.
    const rawConfig = elementsConfig[i]
    const bindings = extractTextBindings(rawConfig)
    const config = bindings
      ? resolveTextElement(rawConfig, bindings, data)
      : rawConfig
    const id = config.id ?? `element_${i}`

    try {
      let mesh: THREE_NS.Mesh
      let elementWidth = 0
      let elementHeight = 0
      let segments: any = null
      const segmentMeshes: THREE_NS.Mesh[] = []
      let videoElement: HTMLMediaElement | null = null
      let videoSource: any = null
      let videoTexture: THREE_NS.Texture | null = null
      let rerasterize: ((res: any) => boolean) | null = null
      const segmentRerasters: Array<(res: any) => boolean> = []
      let textRerender:
        | ((patch: any) => { width: number; height: number })
        | null = null

      // Split text: one mesh and one props proxy per unit. Built by a
      // function so a data edit to a bound split element can build it again
      // from the new words (the units are structure, so they are replaced,
      // never re-rastered, and the host rebuilds the timeline over them).
      // The word the units make up: the element's `props` (a group over
      // the units). It outlives a rebuild, keeping what the timeline set.
      let splitGroup: SplitGroup | null = null
      const buildSplit = () => {
        const splitResult = renderSplitTextElement(config, resolution, THREE)
        elementWidth = splitResult.totalWidth
        elementHeight = splitResult.totalHeight

        const scaledWidth = elementWidth * resolutionScale
        const scaledHeight = elementHeight * resolutionScale

        const { x, y } = calculatePosition(
          config.position,
          resolution,
          scaledWidth,
          scaledHeight,
        )
        const basePosX = x - resolution.width / 2 + scaledWidth / 2
        const basePosY = -(y - resolution.height / 2 + scaledHeight / 2)

        let transformX = 0
        let transformY = 0
        if (config.transform) {
          transformX = (config.transform.translateX ?? 0) * resolutionScale
          transformY = -((config.transform.translateY ?? 0) * resolutionScale)
        }

        const zIndex = config.zIndex ?? 100

        const centreX = basePosX + transformX
        const centreY = -(basePosY + transformY)
        if (splitGroup) relayoutSplitGroup(splitGroup, centreX, centreY)
        else splitGroup = createSplitGroup(centreX, centreY, zIndex)
        const group = splitGroup

        segments = splitResult.meshes.map((item: any, si: number) => {
          const segMesh = item.mesh
          if (item.rerasterize) segmentRerasters.push(item.rerasterize)
          segMesh.scale.set(resolutionScale, resolutionScale, 1)
          segMesh.position.x =
            basePosX + item.offsetX * resolutionScale + transformX
          segMesh.position.y =
            basePosY + item.offsetY * resolutionScale + transformY
          segMesh.position.z = 0
          segMesh.renderOrder = zIndex + i * 0.01 + si * 0.001

          if (config.opacity !== undefined) {
            segMesh.material.opacity = config.opacity
          }

          getScene(config).add(segMesh)
          segmentMeshes.push(segMesh)

          return createElementProps(
            THREE,
            segMesh,
            segMesh.position.x,
            -segMesh.position.y,
            config.opacity ?? 1,
            null,
            null,
            null,
            null,
            null,
            group,
          )
        })
        // A group a tween already moved places the new units where it is.
        for (const recompose of group.members) recompose()

        return splitResult.meshes[0]?.mesh ?? new THREE.Mesh()
      }
      const disposeSplit = () => {
        const targetScene = getScene(config)
        for (const m of segmentMeshes) {
          targetScene.remove(m)
          m.geometry.dispose()
          const mat = m.material as THREE_NS.MeshBasicMaterial
          if (mat.map) mat.map.dispose()
          mat.dispose()
        }
        segmentMeshes.length = 0
        segmentRerasters.length = 0
      }

      if (config.type === 'text' && config.split) {
        mesh = buildSplit()
      } else if (config.type === 'text') {
        const result = renderTextElement(config, resolution, THREE)
        mesh = result.mesh
        elementWidth = result.width
        elementHeight = result.height
        rerasterize = result.rerasterize
        textRerender = result.rerender
      } else if (config.type === 'image') {
        const result = await renderImageElement(config, resolution, THREE)
        mesh = result.mesh
        elementWidth = result.width
        elementHeight = result.height
      } else if (config.type === 'svg') {
        const result = await renderSVGElement(config, resolution, THREE)
        mesh = result.mesh
        elementWidth = result.width
        elementHeight = result.height
        rerasterize = result.rerasterize ?? null
      } else if (config.type === 'video') {
        const result = await renderVideoElement(config, resolution, THREE)
        mesh = result.mesh
        elementWidth = result.width
        elementHeight = result.height
        mesh.userData.video = result.video
        videoElement = result.video
        videoSource = result.videoSource
        videoTexture = result.texture
        videoElement?.pause() // null on the webcodecs path
      } else if (config.type === 'audio') {
        // Non-visual: audio ignores position (default it so the shared
        // positioning below is a harmless no-op on the invisible mesh), and
        // the media element rides the same props proxy as html5 video.
        if (!config.position) config.position = 'center'
        const result = renderAudioElement(config, THREE)
        mesh = result.mesh
        elementWidth = result.width
        elementHeight = result.height
        videoElement = result.audio
        videoElement.pause()
      } else {
        mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(100, 100),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
        )
        console.warn(`Element type "${config.type}" not implemented`)
      }

      if (!config.split) {
        const scaledWidth = elementWidth * resolutionScale
        const scaledHeight = elementHeight * resolutionScale

        const { x, y } = calculatePosition(
          config.position,
          resolution,
          scaledWidth,
          scaledHeight,
        )

        const posX = x - resolution.width / 2 + scaledWidth / 2
        const posY = -(y - resolution.height / 2 + scaledHeight / 2)

        mesh.scale.set(resolutionScale, resolutionScale, 1)
        mesh.position.x = posX
        mesh.position.y = posY
        mesh.position.z = 0

        const zIndex = config.zIndex ?? 100
        mesh.renderOrder = zIndex + i * 0.01

        if (config.opacity !== undefined) {
          ;(mesh.material as THREE_NS.MeshBasicMaterial).opacity =
            config.opacity
          ;(mesh.material as THREE_NS.MeshBasicMaterial).transparent = true
        }

        if (config.transform) {
          const t = config.transform
          if (t.translateX) mesh.position.x += t.translateX * resolutionScale
          if (t.translateY) mesh.position.y -= t.translateY * resolutionScale
          if (t.translateZ) mesh.position.z += t.translateZ
          if (t.scale)
            mesh.scale.set(
              t.scale * resolutionScale,
              t.scale * resolutionScale,
              1,
            )
          if (t.rotateZ || t.rotation) {
            mesh.rotation.z = ((t.rotateZ ?? t.rotation ?? 0) * Math.PI) / 180
          }
        }

        getScene(config).add(mesh)
      }

      // Live text editing: raster-prop writes (content, font*, letterSpacing,
      // color, stroke*) coalesce and re-render IN PLACE — the mesh keeps its
      // identity (scene, render order, timeline bindings) and the element
      // re-measures. The engine's frame flushes the queue before it draws
      // (`flushRaster` on the instance), so a write from onFrame or a tween
      // lands in the frame that made it; the microtask is the fallback for a
      // write made outside a frame. Split text has one mesh per unit and
      // stays structural (commit = recompile).
      let pendingRaster: any = null
      let rasterScheduled = false
      // Where the layout last put the element, in props space (y down). A
      // re-raster moves the element to its new layout and keeps whatever
      // offset a tween or a drag added on top, instead of snapping back.
      let baseX = mesh.position.x
      let baseY = -mesh.position.y
      const flushRaster = () => {
        rasterScheduled = false
        const patch = pendingRaster
        pendingRaster = null
        if (!patch || !textRerender) return
        const dims = textRerender(patch)
        elementWidth = dims.width
        elementHeight = dims.height
        const scaledWidth = dims.width * resolutionScale
        const scaledHeight = dims.height * resolutionScale
        const { x, y } = calculatePosition(
          config.position,
          resolution,
          scaledWidth,
          scaledHeight,
        )
        let posX = x - resolution.width / 2 + scaledWidth / 2
        let posY = -(y - resolution.height / 2 + scaledHeight / 2)
        if (config.transform) {
          posX += (config.transform.translateX ?? 0) * resolutionScale
          posY -= (config.transform.translateY ?? 0) * resolutionScale
        }
        // Write through the proxy (y sign per its convention) so ephemeral
        // transform state stays coherent with the new geometry.
        const offsetX = (props as any).x - baseX
        const offsetY = (props as any).y - baseY
        baseX = posX
        baseY = -posY
        ;(props as any).x = posX + offsetX
        ;(props as any).y = -posY + offsetY
      }
      const queueRaster = (prop: string, value: unknown) => {
        if (!textRerender) return
        const patch = rasterPropPatch(prop, value, config)
        if (!patch) return
        pendingRaster = pendingRaster
          ? mergeQueuedPatches(pendingRaster, patch)
          : patch
        if (!rasterScheduled) {
          rasterScheduled = true
          void Promise.resolve().then(flushRaster)
        }
      }

      const props = splitGroup
        ? createSplitGroupProps(splitGroup, () => segmentMeshes)
        : createElementProps(
            THREE,
            mesh,
            mesh.position.x,
            -mesh.position.y,
            config.opacity ?? 1,
            videoElement,
            videoSource,
            videoTexture,
            textRerender ? queueRaster : null,
            videoElement && Array.isArray((config as any).gainEnvelope)
              ? (config as any).gainEnvelope
              : null,
          )

      const elementInstance: Record<string, any> = {
        config,
        mesh,
        node: null,
        props,
        segments,
        setContent: (content: string) => {
          if (config.type === 'text' && textRerender) {
            queueRaster('content', content)
          } else if (config.type === 'text') {
            // Split text: one mesh per unit — content changes are structural.
            console.warn('[vos] setContent on split text requires a reload')
          }
        },
        // Apply queued raster writes NOW. The engine's frame calls this for
        // every element after onFrame and before it draws; a no-op when
        // nothing is queued.
        flushRaster: () => {
          if (rasterScheduled) flushRaster()
        },
        // Force a re-raster with UNCHANGED values — the hook for late-landing
        // webfonts (a face registered after this element painted with the
        // fallback stack). Rides the same coalescing queue; split text skips
        // (per-unit meshes re-raster only on resolution/structure changes).
        refreshRaster: () => {
          if (!textRerender) return false
          pendingRaster = pendingRaster || {}
          if (!rasterScheduled) {
            rasterScheduled = true
            void Promise.resolve().then(flushRaster)
          }
          return true
        },
        // Set when a data edit REBUILT this element's units (split text): its
        // `segments` and `props` are new objects, so a timeline holding the
        // old ones must be rebuilt. The host reads it through takeStructural.
        structural: false,
        // Re-resolve {$data}-bound props against fresh data (host setData).
        // Routed through the raster queue so bursts coalesce with prop
        // writes. Split text has one mesh per unit, so its words are
        // structure: the units are rebuilt from the new values instead.
        updateData: (next: Record<string, unknown> | null | undefined) => {
          if (bindings && config.type === 'text' && config.split) {
            let changed = false
            if (bindings.content) {
              const v = String(next?.[bindings.content] ?? '')
              if (v !== config.content) {
                config.content = v
                changed = true
              }
            }
            if (bindings.family) {
              const v = next?.[bindings.family]
              if (typeof v === 'string' && v && v !== config.font?.family) {
                config.font = { ...config.font, family: v }
                changed = true
              }
            }
            if (bindings.color) {
              const v = next?.[bindings.color]
              if (typeof v === 'string' && v && v !== config.font?.color) {
                config.font = { ...config.font, color: v }
                changed = true
              }
            }
            if (!changed) return false
            disposeSplit()
            const first = buildSplit()
            elementInstance.mesh = first
            elementInstance.segments = segments
            elementInstance.props = createSplitGroupProps(
              splitGroup as SplitGroup,
              () => segmentMeshes,
            )
            elementInstance.structural = true
            return true
          }
          if (!bindings || !textRerender) return false
          let changed = false
          if (bindings.content) {
            const v = String(next?.[bindings.content] ?? '')
            if (v !== config.content) {
              queueRaster('content', v)
              changed = true
            }
          }
          if (bindings.family) {
            const v = next?.[bindings.family]
            if (typeof v === 'string' && v && v !== config.font?.family) {
              queueRaster('fontFamily', v)
              changed = true
            }
          }
          if (bindings.color) {
            const v = next?.[bindings.color]
            if (typeof v === 'string' && v && v !== config.font?.color) {
              queueRaster('color', v)
              changed = true
            }
          }
          return changed
        },
        // Re-rasterize canvas-backed textures for a new output resolution
        // (called by the host's resize path; geometry stays in design units).
        updateResolution: (res: any) => {
          let changed = false
          for (const fn of segmentRerasters) {
            if (fn(res)) changed = true
          }
          if (rerasterize && rerasterize(res)) changed = true
          return changed
        },
        destroy: () => {
          videoSource?.dispose?.()
          const targetScene = getScene(config)
          if (segmentMeshes.length > 0) {
            segmentMeshes.forEach((m) => {
              targetScene.remove(m)
              m.geometry.dispose()
              const mat = m.material as THREE_NS.MeshBasicMaterial
              if (mat.map) mat.map.dispose()
              mat.dispose()
            })
          } else {
            targetScene.remove(mesh)
            mesh.geometry.dispose()
            const mat = mesh.material as THREE_NS.MeshBasicMaterial
            if (mat.map) mat.map.dispose()
            mat.dispose()
          }
        },
      }

      elementMap.set(id, elementInstance)
    } catch (error) {
      console.warn(
        `[vos] Failed to render element "${id}" (${config.type}):`,
        error,
      )
      // Insert transparent placeholder so layout/animation refs still work
      const fallbackMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      )
      getScene(config).add(fallbackMesh)
      const props = createElementProps(THREE, fallbackMesh, 0, 0, 0)
      elementMap.set(id, {
        config,
        mesh: fallbackMesh,
        node: null,
        props,
        segments: null,
        setContent: () => {},
        updateResolution: () => false,
        destroy: () => {
          getScene(config).remove(fallbackMesh)
          fallbackMesh.geometry.dispose()
          fallbackMesh.material.dispose()
        },
      })
    }
  }

  return elementMap
}
