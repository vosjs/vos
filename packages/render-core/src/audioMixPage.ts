/**
 * Audio mix page — an HTML page that renders a chunked export's audio track
 * ALONE and PUTs it to the ingest route as the `audio` part.
 *
 * Why a page: the mix needs OfflineAudioContext + WebCodecs AudioEncoder,
 * which exist only in browsers. Why ALONE: the finalize page used to produce
 * audio AND concat video in one context, and the combined memory bill
 * (whole source recording + full-length PCM + all parts + output buffer)
 * is what the fleet kills at peak (job 288257ae). This page's
 * live set stays ~tens of MB by construction:
 *
 *   - the source recording is never fetched whole: `__vosStreamSplice__`
 *     (installed here, consumed by the shared audio producer) streams-decodes
 *     ONLY the needed source spans through mediabunny's UrlSource, whose
 *     read cache is bounded (~8MiB) — the asset route serves Range/206.
 *   - the spliced voice buffer is capped at the REQUESTED output duration,
 *     which is also the duration fix (a duration-capped render must not carry the
 *     full take's audio).
 *   - the encoded result is ~1MB of Opus in WebM.
 *
 * The whole-file decodeAudioData path stays as the in-page fallback rung
 * (unsupported codec, no Range support): the producer falls back on any
 * stream-splice failure, so a mix is never LOST to the optimization.
 *
 * Runs CONCURRENTLY with the chunk phase — it depends only on the source
 * recording and the doc, never on a part.
 *
 * Failure contract: mirrors the finalize page — any error lands in
 * `__renderComplete = { success: false, error }`; stage markers ride
 * `__finalizeStage` (heap-stamped) so a death localizes itself.
 */

import { audioProducerCode } from './audioProducer'
import type { AudioPlanJson } from './audioProducer'

const MEDIABUNNY_URL = 'https://esm.sh/mediabunny@1.27.3?target=es2022'

export interface AudioMixPageOptions {
  /** The vos's resolved ctx.data (asset URLs absolute, render token baked). */
  data: unknown
  /**
   * The studio clips as an engine audio plan, built by the host from
   * the stored config's `vosso.studio` stack entry; null when the take has
   * no music/SFX. Rides the page's CONFIG, once.
   */
  plan?: AudioPlanJson | null
  /** Requested OUTPUT duration in seconds — the mix length, the trim bound. */
  duration: number
  /** The finished audio file is PUT here (ingest `?part=audio`). */
  uploadUrl: string
}

export function buildAudioMixPage(options: AudioMixPageOptions): string {
  const config = JSON.stringify({
    data: options.data,
    plan: options.plan ?? null,
    duration: options.duration,
    uploadUrl: options.uploadUrl,
  })

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>vos audio mix</title></head>
<body>
<script type="module">
const CONFIG = ${config};

// Same stage contract as the finalize page: worker polls __finalizeStage,
// reports the last stage on a silent death. Stage NAME stays the first
// space-delimited token (renderPolicy.finalizeDeathStage parses it).
const stage = (s) => {
  const m = performance.memory;
  window.__finalizeStage = m ? s + ' heap=' + Math.round(m.usedJSHeapSize / 1048576) + 'MB' : s;
};
stage('boot');

;(async () => {
  stage('import-mediabunny');
  const MB = await import(${JSON.stringify(MEDIABUNNY_URL)});

  // Streaming splice seam consumed by the audio producer below: decode ONLY
  // the source spans the segments keep, capped at maxSeconds of output.
  // Mirrors spliceAudio's piece math (copy at rate 1, linear resample
  // otherwise); the producer's whole-file path remains the authoritative
  // fallback, so a divergence here degrades to slower, never to wrong.
  window.__vosStreamSplice__ = async (url, segments, maxSeconds) => {
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.UrlSource(url) });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null;
      if (!(await track.canDecode())) return null;
      const sr = track.sampleRate;
      const ch = Math.min(2, Math.max(1, track.numberOfChannels || 2));
      const srcDur = await input.computeDuration();

      const spans = Array.isArray(segments) && segments.length
        ? segments
        : [{ in: 0, out: srcDur }];
      const pieces = [];
      let outTotal = 0;
      for (const s of spans) {
        const start = Math.max(0, Math.min(s.in, srcDur));
        const end = Math.max(start, Math.min(s.out, srcDur));
        const rate = s.rate !== undefined && s.rate > 0 ? s.rate : 1;
        let outLen = (end - start) / rate;
        if (outTotal + outLen > maxSeconds) outLen = maxSeconds - outTotal;
        if (outLen <= 0) break;
        pieces.push({ in: start, out: start + outLen * rate, rate, outLen });
        outTotal += outLen;
        if (outTotal >= maxSeconds) break;
      }
      if (pieces.length === 0) return null;

      const totalFrames = Math.max(1, Math.round(outTotal * sr));
      const out = new AudioBuffer({ length: totalFrames, numberOfChannels: ch, sampleRate: sr });
      const sink = new MB.AudioBufferSink(track);
      let outOffset = 0;
      for (let pi = 0; pi < pieces.length; pi++) {
        const p = pieces[pi];
        stage('voice-piece-' + pi);
        // Materialize ONE piece's source span (bounded), then splice from it.
        const pieceFrames = Math.max(1, Math.round((p.out - p.in) * sr));
        const temp = [];
        for (let c = 0; c < ch; c++) temp.push(new Float32Array(pieceFrames));
        for await (const wrapped of sink.buffers(p.in, p.out)) {
          const b = wrapped.buffer;
          const at = Math.round((wrapped.timestamp - p.in) * sr);
          for (let c = 0; c < ch; c++) {
            const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
            let from = 0, to = at, n = src.length;
            if (to < 0) { from = -to; to = 0; n -= from; }
            n = Math.min(n, pieceFrames - to);
            if (n > 0) temp[c].set(src.subarray(from, from + n), to);
          }
        }
        const outFrames = Math.min(Math.round(p.outLen * sr), totalFrames - outOffset);
        for (let c = 0; c < ch; c++) {
          const dst = out.getChannelData(c);
          const src = temp[c];
          if (p.rate === 1) {
            dst.set(src.subarray(0, Math.min(outFrames, src.length)), outOffset);
          } else {
            const last = src.length - 1;
            for (let i = 0; i < outFrames; i++) {
              const pos = i * p.rate;
              const j = Math.min(Math.floor(pos), last);
              const a = src[j];
              const b2 = src[Math.min(j + 1, last)];
              dst[outOffset + i] = a + (b2 - a) * (pos - j);
            }
          }
        }
        outOffset += outFrames;
      }
      return out;
    } finally {
      input.dispose();
    }
  };

  ${audioProducerCode()}

  stage('mix');
  let mixed = await window.__vosAudioProducer__({
    data: CONFIG.data,
    plan: CONFIG.plan,
    duration: CONFIG.duration,
    sampleRate: 48000,
  });
  if (!mixed) {
    // Every declared source failed to decode (fetch denied, undecodable
    // bytes). Reporting "no buffer" here used to route finalize onto the
    // browser concat fallback — whose in-page producer faces the SAME
    // failures and whose page-memory concat is the known OOM death (job
    // cdf6e026 died twice at concat-part-10 after this very branch). Land a
    // duration-true SILENT track instead so the worker mux still runs: the
    // audible outcome matches the client exporter's documented fail-open
    // (a source that won't decode loses its sound, never the export).
    console.warn('[audio-mix] no source decoded; landing a silent track');
    mixed = new AudioBuffer({
      length: Math.max(1, Math.ceil(CONFIG.duration * 48000)),
      numberOfChannels: 2,
      sampleRate: 48000,
    });
  }

  stage('encode');
  // Opus always: the fleet is Linux Chrome, which has no AAC encoder, and
  // the worker mux stream-copies whatever codec arrives here.
  const output = new MB.Output({ format: new MB.WebMOutputFormat(), target: new MB.BufferTarget() });
  const source = new MB.AudioBufferSource({ codec: 'opus', bitrate: MB.QUALITY_HIGH });
  output.addAudioTrack(source);
  await output.start();
  await source.add(mixed);
  source.close();
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Audio encode produced no output buffer');

  stage('upload');
  const res = await fetch(CONFIG.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/webm' },
    body: buffer,
  });
  if (!res.ok) throw new Error('Upload failed: HTTP ' + res.status);

  window.__renderComplete = { success: true, uploaded: true, size: buffer.byteLength };
})().catch((e) => {
  window.__renderComplete = { success: false, error: String((e && e.stack) || e) };
});
</script>
</body>
</html>`
}
