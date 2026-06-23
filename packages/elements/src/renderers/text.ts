import type * as THREE_NS from 'three'

/**
 * Render text to canvas and create textured plane
 */
export function renderTextElement(
  element: any,
  _resolution: any,
  THREE: typeof THREE_NS,
) {
  const { content, font = {} } = element
  const fontSize = font.size ?? 24
  const fontFamily = font.family ?? 'Inter, system-ui, sans-serif'
  const fontWeight = font.weight ?? 'normal'
  const fontStyle = font.style ?? 'normal'
  const color = font.color ?? '#ffffff'
  const align = font.align ?? 'left'
  const letterSpacing = font.letterSpacing ?? 0
  const lineHeight = font.lineHeight ?? 1.2

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const fontString = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.font = fontString

  const lines = content.split('\n')
  let maxWidth = 0
  lines.forEach((line: string) => {
    let w = 0
    for (let i = 0; i < line.length; i++) {
      w += ctx.measureText(line[i]).width
      if (i < line.length - 1) w += letterSpacing
    }
    if (w > maxWidth) maxWidth = w
  })

  const totalHeight = lines.length * fontSize * lineHeight
  const padding =
    Math.max(element.stroke?.width ?? 0, element.shadow?.blur ?? 0) * 2 + 10
  const canvasWidth = Math.ceil(maxWidth + padding * 2)
  const canvasHeight = Math.ceil(totalHeight + padding * 2)

  canvas.width = canvasWidth
  canvas.height = canvasHeight
  ctx.font = fontString
  ctx.textBaseline = 'top'
  ctx.textAlign = align as CanvasTextAlign
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  if (element.shadow) {
    ctx.shadowColor = element.shadow.color
    ctx.shadowBlur = element.shadow.blur
    ctx.shadowOffsetX = element.shadow.offsetX ?? 0
    ctx.shadowOffsetY = element.shadow.offsetY ?? 0
  }

  let textX = padding
  if (align === 'center') textX = canvasWidth / 2
  else if (align === 'right') textX = canvasWidth - padding

  lines.forEach((line: string, i: number) => {
    const y = padding + i * fontSize * lineHeight
    if (element.stroke) {
      ctx.strokeStyle = element.stroke.color
      ctx.lineWidth = element.stroke.width
      ctx.lineJoin = 'round'
      ctx.strokeText(line, textX, y)
    }
    ctx.fillStyle = color
    ctx.fillText(line, textX, y)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })

  const geometry = new THREE.PlaneGeometry(canvasWidth, canvasHeight)
  const mesh = new THREE.Mesh(geometry, material)

  return { mesh, canvas, width: canvasWidth, height: canvasHeight }
}

/**
 * Render a single text segment (char/word) to canvas and create mesh
 */
export function renderTextSegment(
  text: string,
  font: any,
  element: any,
  THREE: typeof THREE_NS,
) {
  const fontSize = font.size ?? 24
  const fontFamily = font.family ?? 'Inter, system-ui, sans-serif'
  const fontWeight = font.weight ?? 'normal'
  const fontStyle = font.style ?? 'normal'
  const color = font.color ?? '#ffffff'

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const fontString = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.font = fontString

  const metrics = ctx.measureText(text)
  const padding =
    Math.max(element.stroke?.width ?? 0, element.shadow?.blur ?? 0) * 2 + 4
  const canvasWidth = Math.ceil(metrics.width + padding * 2)
  const canvasHeight = Math.ceil(fontSize * 1.4 + padding * 2)

  canvas.width = canvasWidth
  canvas.height = canvasHeight
  ctx.font = fontString
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  if (element.shadow) {
    ctx.shadowColor = element.shadow.color
    ctx.shadowBlur = element.shadow.blur
    ctx.shadowOffsetX = element.shadow.offsetX ?? 0
    ctx.shadowOffsetY = element.shadow.offsetY ?? 0
  }

  if (element.stroke) {
    ctx.strokeStyle = element.stroke.color
    ctx.lineWidth = element.stroke.width
    ctx.lineJoin = 'round'
    ctx.strokeText(text, padding, padding)
  }
  ctx.fillStyle = color
  ctx.fillText(text, padding, padding)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })

  const geometry = new THREE.PlaneGeometry(canvasWidth, canvasHeight)
  const mesh = new THREE.Mesh(geometry, material)

  return {
    mesh,
    width: canvasWidth,
    height: canvasHeight,
    textWidth: metrics.width,
  }
}

/**
 * Render split text - creates multiple meshes (one per char/word/line)
 */
export function renderSplitTextElement(
  element: any,
  _resolution: any,
  THREE: typeof THREE_NS,
) {
  const { content, font = {}, split } = element
  const splitType = split?.type ?? 'chars'
  const letterSpacing = font.letterSpacing ?? 0

  let segments: string[]
  if (splitType === 'chars') {
    segments = content.split('')
  } else if (splitType === 'words') {
    segments = content.split(/\s+/)
  } else {
    segments = content.split('\n')
  }

  const meshes: any[] = []
  let totalWidth = 0

  segments.forEach((text: string, i: number) => {
    if (text.length === 0) return

    const result = renderTextSegment(text, font, element, THREE)
    meshes.push({
      mesh: result.mesh,
      width: result.width,
      height: result.height,
      textWidth: result.textWidth,
      text,
    })
    totalWidth += result.textWidth
    if (i < segments.length - 1) {
      totalWidth +=
        splitType === 'words' ? (font.size ?? 24) * 0.4 : letterSpacing
    }
  })

  const totalHeight = meshes[0]?.height ?? 0
  let currentX = -totalWidth / 2

  meshes.forEach((item: any, i: number) => {
    item.offsetX = currentX + item.textWidth / 2
    item.offsetY = 0
    currentX += item.textWidth
    if (i < meshes.length - 1) {
      currentX +=
        splitType === 'words' ? (font.size ?? 24) * 0.4 : letterSpacing
    }
  })

  return { meshes, totalWidth, totalHeight }
}
