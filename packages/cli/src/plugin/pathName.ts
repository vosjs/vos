/**
 * A name the server chose (a slug, a title, a file name) as a path segment
 * on this disk. The server's word is never trusted as a path: a separator,
 * a `..`, a control character or a leading dot is dropped, everything else
 * collapses to `[A-Za-z0-9._-]`, and a name with nothing left falls back to
 * the id, which is ours to shape.
 */
export function safePathName(
  name: string | undefined,
  fallback: string,
): string {
  const cleaned = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+$/, '')
    .slice(0, 80)
  if (cleaned) return cleaned
  const id = fallback.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
  return id || 'file'
}
