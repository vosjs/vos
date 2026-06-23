const CDN_BASE = 'https://esm.sh'

export function threeUrl(version: string): string {
  return `${CDN_BASE}/three@${version}?target=es2022`
}

export function threeAddonsPrefix(version: string): string {
  return `${CDN_BASE}/three@${version}&target=es2022/examples/jsm/`
}

export function gsapUrl(version: string): string {
  return `${CDN_BASE}/gsap@${version}?target=es2022`
}

export function dracoDecoderPath(version: string): string {
  return `${CDN_BASE}/three@${version}&target=es2022/examples/jsm/libs/draco/`
}

export function externalPackageUrl(
  packageName: string,
  options?: { external?: string[]; target?: string },
): string {
  const params = new URLSearchParams()
  if (options?.external?.length)
    params.set('external', options.external.join(','))
  params.set('target', options?.target ?? 'es2022')
  return `${CDN_BASE}/${packageName}?${params.toString()}`
}

export const CDN_ORIGIN = CDN_BASE
