import { lstat, writeFile } from 'node:fs/promises'
import { lstatSync, writeFileSync } from 'node:fs'

/**
 * Write a file the CLI owns into a take or program directory, never
 * through a symbolic link. `writeFile` follows a link already at the path,
 * so a `doc.json` pointing out of the directory would carry the bytes
 * wherever it points; here the path is looked at first and a link is
 * refused in words. A regular file is overwritten as before.
 */
export async function writeFileSafe(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  await refuseSymlink(path)
  await writeFile(path, data)
}

/** Throws in words when a symbolic link sits at the path; nothing else. */
export async function refuseSymlink(path: string): Promise<void> {
  let link = false
  try {
    link = (await lstat(path)).isSymbolicLink()
  } catch {
    // nothing there yet: a plain write
  }
  if (link) throw new Error(symlinkRefusal(path))
}

/** The synchronous twin, for the writers that are synchronous. */
export function writeFileSafeSync(
  path: string,
  data: string | Uint8Array,
): void {
  let link = false
  try {
    link = lstatSync(path).isSymbolicLink()
  } catch {
    // nothing there yet
  }
  if (link) throw new Error(symlinkRefusal(path))
  writeFileSync(path, data)
}

export function symlinkRefusal(path: string): string {
  return `${path} is a symbolic link, and the CLI writes only a regular file there: remove the link and run again`
}
