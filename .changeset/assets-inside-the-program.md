---
'@vosjs/cli': patch
---

Declared files (`config.assets`) are held to the program's own directory, and six defects in how the CLI served, uploaded and fetched them are fixed.

- **A manifest path reaches only into the config's directory.** A `ref` could name any file on the machine (`../.env`, an absolute path, a link pointing away), and `vos render`, `still`, `preview` and `compare` served it to a page whose code comes from the same config, while `vos push` uploaded it. A path outside the directory is now refused in words by every verb, a config loaded from a URL reads no local file, and `vos check` reports it. `vos preview` listens on loopback only.
- **A manifest name is an identifier everywhere.** `vos fetch --media` named the files it brought home after manifest names that, in a fetched document's own config, had passed no schema; a name with `../` in it wrote outside `assets/`.
- **A file with a space or an accent in its name loads in a render.** The served path carried the raw file name, and the page asked for the percent-encoded one.
- **Served files answer `Range` and wear a content type**, in the render page's route and in the preview server: a video element seeks by range, and an SVG needs its type to draw.
- **`vos fetch --media` fetches again when a name means a different hosted file.** A file kept by name alone stayed under a changed manifest, and the next push stored the old one. `assets/.hosted.json` remembers which hosted file each one is.
- **A push says what it cannot carry yet.** A font, an HDR or a `.gltf` in the manifest was sent and refused as a bare 415; it is now refused before anything is sent, with what to do instead.
- Hosted files a render downloads are cached under `~/.cache/vos/assets` (private to the user, written whole through a `.part`, named with their type), not the shared temp directory; a hosted file spelled as its absolute URL is read with the key too; and the same path on a host that is not vos.so stays a URL.
