/**
 * The `paste` step, the pure parts: what a file is pasted as, and the two
 * page scripts that put an item where a person's ⌘V finds it.
 *
 * The first rung is the browser's own clipboard: the item is written with
 * `navigator.clipboard.write` (the context is granted clipboard access
 * first), and the recorder then presses the platform's paste chord, so the
 * page receives a TRUSTED keydown and a trusted `paste` event carrying the
 * item, and a page that reads `navigator.clipboard.read()` itself sees it
 * there too. A headless browser keeps its own clipboard, so nothing on the
 * machine's clipboard is touched.
 *
 * When the browser refuses the write (no clipboard access on this driver,
 * a type it will not hold), the second rung dispatches the paste in the
 * page: a `paste` event with a `DataTransfer` holding the item on the
 * focused element, and `navigator.clipboard.read`/`readText` answering the
 * item for the rest of the take. Those events are untrusted, which the
 * recorder says.
 *
 * Both scripts are strings, the one evaluate shape every driver shares,
 * and neither carries anything the cursor track keeps: a paste is a typing
 * ping, never its contents.
 */

/** How long after a dispatched paste is first read its item stays on the async reads, ms. */
export const PASTE_READ_WINDOW_MS = 300
/** How long a dispatched paste's item stays on the async reads when nothing reads it, ms. */
export const PASTE_UNREAD_MS = 3000

/** The most bytes a pasted file may hold. */
export const PASTE_MAX_BYTES = 10 * 1024 * 1024

/** The file types a paste takes, by extension. */
export const PASTE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'text/plain',
  '.csv': 'text/plain',
}

/** A pasted file's type from its name, or null when a paste does not take it. */
export function pasteTypeOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return PASTE_TYPES[name.slice(dot).toLowerCase()] ?? null
}

/** What a paste puts on the clipboard: words, or a file's bytes (base64) with its type and name. */
export interface PasteItem {
  text?: string
  b64?: string
  type?: string
  name?: string
}

/**
 * The page script that builds the item's blobs: an image other than PNG
 * is redrawn as PNG for the clipboard (the one image type every browser
 * holds) and an SVG rides as its markup too, so an app that reads text
 * finds it. Shared by both rungs.
 */
const BUILD = (item: PasteItem) => `
  const item = ${JSON.stringify(item)};
  const bytes = item.b64 ? Uint8Array.from(atob(item.b64), (c) => c.charCodeAt(0)) : null;
  const asText = bytes ? new TextDecoder().decode(bytes) : null;
  async function blobs() {
    if (item.text !== undefined) return { 'text/plain': new Blob([item.text], { type: 'text/plain' }) };
    const type = item.type;
    if (type === 'text/plain') return { 'text/plain': new Blob([asText], { type }) };
    if (type === 'text/html') return { 'text/html': new Blob([asText], { type }), 'text/plain': new Blob([asText], { type: 'text/plain' }) };
    if (type === 'image/svg+xml') return { 'image/svg+xml': new Blob([bytes], { type }), 'text/plain': new Blob([asText], { type: 'text/plain' }) };
    if (type === 'image/png') return { 'image/png': new Blob([bytes], { type }) };
    const bmp = await createImageBitmap(new Blob([bytes], { type }));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    return { 'image/png': png };
  }
`

/**
 * Rung one: write the item to the browser's clipboard. Answers 'ok', or
 * 'refused: <why>'. An SVG the clipboard will not hold as an image is
 * written as its markup alone.
 */
export function stageClipboardScript(item: PasteItem): string {
  return `(async () => {
  ${BUILD(item)}
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return 'refused: this page has no clipboard';
    const b = await blobs();
    try {
      await navigator.clipboard.write([new ClipboardItem(b)]);
    } catch (e) {
      if (!b['text/plain'] || Object.keys(b).length === 1) throw e;
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': b['text/plain'] })]);
    }
    return 'ok';
  } catch (e) {
    return 'refused: ' + (e && e.message ? e.message : String(e));
  }
})()`
}

/**
 * Rung two: the paste dispatched in the page, on the focused element (or
 * the body), with the item in its `clipboardData`; and the async clipboard
 * reads answer the item from here on. A plain field the page did not take
 * the paste for gets the words inserted, as the browser's own paste does.
 * Answers 'ok', or 'failed: <why>'.
 */
export function syntheticPasteScript(
  item: PasteItem,
  opts: { original?: boolean } = {},
): string {
  return `(async () => {
  ${BUILD(item)}
  try {
    // With original, an image file is handed over as its own bytes and type
    // (an SVG also as its markup), never redrawn.
    const b = ${opts.original ? `item.type === 'image/svg+xml' ? { 'image/svg+xml': new Blob([bytes], { type: item.type }), 'text/plain': new Blob([asText], { type: 'text/plain' }) } : { [item.type]: new Blob([bytes], { type: item.type }) }` : 'await blobs()'};
    const dt = new DataTransfer();
    let file = null;
    for (const [type, blob] of Object.entries(b)) {
      if (type.startsWith('image/')) {
        file = new File([blob], item.name || 'image.png', { type: blob.type || type });
        dt.items.add(file);
      } else dt.setData(type, await blob.text());
    }
    try {
      // The async reads answer the item for THIS paste only: shortly after
      // the first read (an app may read text and items in turn), or after a
      // few seconds when nothing reads, the browser's own reads come back,
      // so a later paste through the clipboard is the clipboard's.
      const staged = [new ClipboardItem(b)];
      const clip = navigator.clipboard;
      const own = { read: Object.prototype.hasOwnProperty.call(clip, 'read'), readText: Object.prototype.hasOwnProperty.call(clip, 'readText') };
      const was = { read: clip.read, readText: clip.readText };
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        for (const k of ['read', 'readText']) {
          if (own[k]) clip[k] = was[k];
          else delete clip[k];
        }
      };
      let soon = null;
      const readOnce = () => { if (!soon) soon = setTimeout(restore, ${PASTE_READ_WINDOW_MS}) };
      clip.read = async () => { readOnce(); return staged };
      clip.readText = async () => { readOnce(); return b['text/plain'] ? b['text/plain'].text() : '' };
      setTimeout(restore, ${PASTE_UNREAD_MS});
    } catch {}
    const target = document.activeElement || document.body;
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    const taken = !target.dispatchEvent(ev);
    const words = dt.getData('text/plain');
    if (!taken && words && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName)))
      document.execCommand('insertText', false, words);
    return 'ok';
  } catch (e) {
    return 'failed: ' + (e && e.message ? e.message : String(e));
  }
})()`
}
