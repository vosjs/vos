/**
 * Global asset cache - stores preloaded assets by URL.
 * Handles images, videos, and SVGs.
 */
export const AssetCache = {
  images: new Map<
    string,
    { element: HTMLImageElement; width: number; height: number }
  >(),
  videos: new Map<
    string,
    {
      element: HTMLVideoElement
      blobUrl?: string
      duration: number
      width: number
      height: number
    }
  >(),
  svgContents: new Map<string, string>(),

  getImage(url: string) {
    return this.images.get(url) || null
  },
  getVideo(url: string) {
    return this.videos.get(url) || null
  },
  getSVG(url: string) {
    return this.svgContents.get(url) || null
  },

  dispose() {
    this.videos.forEach((cached) => {
      cached.element.pause()
      cached.element.src = ''
      cached.element.load()
      if (cached.blobUrl) {
        URL.revokeObjectURL(cached.blobUrl)
      }
    })
    this.images.clear()
    this.videos.clear()
    this.svgContents.clear()
  },
}

/**
 * Extract all asset URLs from elements config
 */
function extractAssetUrls(elementsConfig: any[]) {
  const assets: {
    images: string[]
    videos: string[]
    svgs: string[]
  } = {
    images: [],
    videos: [],
    svgs: [],
  }

  for (const el of elementsConfig) {
    if (el.type === 'image' && el.src) {
      assets.images.push(el.src)
    } else if (el.type === 'video' && el.src) {
      assets.videos.push(el.src)
    } else if (el.type === 'svg' && el.src) {
      assets.svgs.push(el.src)
    }
  }

  assets.images = [...new Set(assets.images)]
  assets.videos = [...new Set(assets.videos)]
  assets.svgs = [...new Set(assets.svgs)]

  return assets
}

async function preloadImage(url: string) {
  if (AssetCache.images.has(url)) return

  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => {
      console.warn('Failed to preload image:', url)
      resolve()
    }
    img.src = url
  })

  AssetCache.images.set(url, {
    element: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
  })
}

async function preloadVideo(url: string) {
  if (AssetCache.videos.has(url)) return

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('Failed to fetch video: ' + response.status)
    }
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    await new Promise<void>((resolve, reject) => {
      video.oncanplaythrough = () => resolve()
      video.onerror = reject
      video.src = blobUrl
      video.load()
    })

    video.currentTime = 0
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      setTimeout(() => resolve(), 100)
    })

    video.pause()

    console.log('Video preloaded:', url, 'duration:', video.duration)

    AssetCache.videos.set(url, {
      element: video,
      blobUrl,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    })
  } catch (e) {
    console.warn('Failed to preload video:', url, e)
  }
}

async function preloadSVG(url: string) {
  if (AssetCache.svgContents.has(url)) return

  try {
    if (url.startsWith('<svg') || url.startsWith('<?xml')) {
      AssetCache.svgContents.set(url, url)
      return
    }

    if (url.startsWith('data:image/svg')) {
      const base64 = url.split(',')[1]
      const svgContent = atob(base64)
      AssetCache.svgContents.set(url, svgContent)
      return
    }

    const response = await fetch(url)
    const svgContent = await response.text()
    AssetCache.svgContents.set(url, svgContent)
  } catch (e) {
    console.warn('Failed to preload SVG:', url, e)
    AssetCache.svgContents.set(url, '')
  }
}

/**
 * Preload all assets from elements config.
 * Reports progress via postMessage to parent.
 */
export async function preloadAssets(elementsConfig: any[]) {
  const assets = extractAssetUrls(elementsConfig)
  const total = assets.images.length + assets.videos.length + assets.svgs.length

  if (total === 0) return

  let loaded = 0

  if (window.parent !== window) {
    window.parent.postMessage(
      { type: 'PRELOAD_PROGRESS', loaded: 0, total },
      '*',
    )
  }

  const preloadWithProgress = async (
    fn: (url: string) => Promise<void>,
    url: string,
  ) => {
    await fn(url)
    loaded++
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: 'PRELOAD_PROGRESS', loaded, total },
        '*',
      )
    }
  }

  const promises = [
    ...assets.images.map((url) => preloadWithProgress(preloadImage, url)),
    ...assets.videos.map((url) => preloadWithProgress(preloadVideo, url)),
    ...assets.svgs.map((url) => preloadWithProgress(preloadSVG, url)),
  ]

  await Promise.all(promises)
}
