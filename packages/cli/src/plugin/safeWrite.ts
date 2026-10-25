import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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

/**
 * Make the folders a path a person named lives in (`vos render take
 * out/demo.mp4`), or throw in words. Called BEFORE the work that produces
 * the bytes: a render takes minutes and its result lives only in memory
 * until it is written, so a folder that is not there yet must not be what
 * loses it, and a folder that cannot be made (a file already at its name,
 * no permission) is said before anything runs.
 */
export async function prepareOutput(path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch (e) {
    throw new Error(outputDirRefusal(path, e))
  }
}

/** Write a file a person named, making its folders first. */
export async function writeOutput(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  await prepareOutput(path)
  await writeFile(path, data)
}

/** The synchronous twin of `writeOutput`. */
export function writeOutputSync(path: string, data: string | Uint8Array): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch (e) {
    throw new Error(outputDirRefusal(path, e))
  }
  writeFileSync(path, data)
}

function outputDirRefusal(path: string, e: unknown): string {
  const code = (e as { code?: string }).code
  const why =
    code === 'EEXIST' || code === 'ENOTDIR'
      ? 'a file stands where a folder on its path would go'
      : code === 'EACCES' || code === 'EPERM'
        ? 'this user may not create it'
        : e instanceof Error
          ? e.message
          : String(e)
  return `cannot make the folder for ${path}: ${why}. Nothing was written.`
}

export function symlinkRefusal(path: string): string {
  return `${path} is a symbolic link, and the CLI writes only a regular file there: remove the link and run again`
}
