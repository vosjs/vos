/**
 * Global asset cache - stores preloaded assets by URL.
 * Handles images, videos, audio, and SVGs.
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
  audios: new Map<
    string,
    { element: HTMLAudioElement; blobUrl?: string; duration: number }
  >(),
  svgContents: new Map<string, string>(),

  getImage(url: string) {
    return this.images.get(url) || null
  },
  getVideo(url: string) {
    return this.videos.get(url) || null
  },
  getAudio(url: string) {
    return this.audios.get(url) || null
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
    this.audios.forEach((cached) => {
      cached.element.pause()
      cached.element.src = ''
      cached.element.load()
      if (cached.blobUrl) {
        URL.revokeObjectURL(cached.blobUrl)
      }
    })
    this.images.clear()
    this.videos.clear()
    this.audios.clear()
    this.svgContents.clear()
  },
}

/**
 * Extract all asset URLs from elements config
 */
export function extractAssetUrls(elementsConfig: any[]) {
  const assets: {
    images: string[]
    videos: string[]
    audios: string[]
    svgs: string[]
  } = {
    images: [],
    videos: [],
    audios: [],
    svgs: [],
  }

  for (const el of elementsConfig) {
    if (el.type === 'image' && el.src) {
      assets.images.push(el.src)
    } else if (el.type === 'video' && el.src) {
      assets.videos.push(el.src)
    } else if (el.type === 'audio' && el.src) {
      assets.audios.push(el.src)
    } else if (el.type === 'svg' && el.src) {
      assets.svgs.push(el.src)
    }
  }

  assets.images = [...new Set(assets.images)]
  assets.videos = [...new Set(assets.videos)]
  assets.audios = [...new Set(assets.audios)]
  assets.svgs = [...new Set(assets.svgs)]

  return assets
}

async function preloadAudio(url: string) {
  if (AssetCache.audios.has(url)) return

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('Failed to fetch audio: ' + response.status)
    }
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)

    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'

    await new Promise<void>((resolve, reject) => {
      audio.oncanplaythrough = () => resolve()
      audio.onerror = reject
      audio.src = blobUrl
      audio.load()
    })

    audio.pause()

    AssetCache.audios.set(url, {
      element: audio,
      blobUrl,
      duration: audio.duration,
    })
  } catch (e) {
    console.warn('Failed to preload audio:', url, e)
  }
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
  const total =
    assets.images.length +
    assets.videos.length +
    assets.audios.length +
    assets.svgs.length

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
    ...assets.audios.map((url) => preloadWithProgress(preloadAudio, url)),
    ...assets.svgs.map((url) => preloadWithProgress(preloadSVG, url)),
  ]

  await Promise.all(promises)
}
