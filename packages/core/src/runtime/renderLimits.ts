export const RENDER_LIMITS = {
  preview: {
    maxWidth: 1920,
    maxHeight: 1080,
    maxDuration: 10,
    maxFps: 30,
    defaultWidth: 1280,
    defaultHeight: 720,
    defaultFps: 24,
    defaultDuration: 3,
  },
  thumbnail: {
    maxWidth: 1920,
    maxHeight: 1080,
    defaultWidth: 640,
    defaultHeight: 360,
  },
  export: {
    maxWidth: 3840,
    maxHeight: 2160,
    maxDuration: 60,
    maxFps: 60,
  },
} as const
