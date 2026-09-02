/**
 * Image diff page — computes the RMS difference between two images in a
 * browser page. Workers can't decode images (no canvas/Image APIs), so the
 * golden-frame canary hands both images to a page and reads one number back.
 *
 * Same completion contract as every render page: `__renderComplete` with
 * `{ success, rms, width, height }` or `{ success: false, error }`.
 * RMS is over RGB (alpha ignored) in 0–255 units: WebP re-encode jitter of
 * the same frame lands well under 5; a real engine/fleet drift (missing
 * layer, changed shader, font fallback) lands far above 10.
 */

export interface ImageDiffPageOptions {
  /** data: URLs — the canary inlines both images (they are ~tens of KB). */
  candidateUrl: string
  goldenUrl: string
}

export function buildImageDiffPage(options: ImageDiffPageOptions): string {
  // <-escape so no input can ever close the script tag (data URLs are
  // base64 and can't contain '<', but the builder shouldn't rely on that).
  const config = JSON.stringify({
    candidate: options.candidateUrl,
    golden: options.goldenUrl,
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>vos golden diff</title></head>
<body>
<script type="module">
const CONFIG = ${config};

const load = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });

;(async () => {
  const [candidate, golden] = await Promise.all([
    load(CONFIG.candidate),
    load(CONFIG.golden),
  ]);
  if (candidate.width !== golden.width || candidate.height !== golden.height) {
    throw new Error(
      'size mismatch: candidate ' + candidate.width + 'x' + candidate.height +
      ' vs golden ' + golden.width + 'x' + golden.height,
    );
  }
  const draw = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const a = draw(candidate);
  const b = draw(golden);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      sum += d * d;
      n++;
    }
  }
  const rms = Math.sqrt(sum / n);
  window.__renderComplete = {
    success: true,
    rms,
    width: candidate.width,
    height: candidate.height,
  };
})().catch((e) => {
  window.__renderComplete = { success: false, error: String((e && e.message) || e) };
});
</script>
</body>
</html>`
}
