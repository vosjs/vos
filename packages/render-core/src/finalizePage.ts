/**
 * Finalize page — an HTML page that stream-copy concatenates encoded chunk
 * videos IN A BROWSER and PUTs the result to an upload URL.
 *
 * Why a page and not the Worker: concat needs every chunk in memory plus the
 * output buffer, which busts a 128MB isolate on real exports; a browser page
 * (the same Browser Run substrate that rendered the chunks) has gigabytes,
 * mediabunny already proven in it, and gives the later audio-mix step a home
 * (OfflineAudioContext exists only in browsers).
 *
 * The in-page algorithm MIRRORS ./concat.ts (concatEncodedVideo) — same
 * packet walk, same plan-derived timestamp offsets, same keyframe guard.
 * KEEP THEM IN SYNC; scripts/verify-finalize-page.ts (vos-plugin) asserts the
 * two implementations produce packet-identical output.
 *
 * Failure contract: any error (fetch, codec mismatch, upload) lands in
 * `__renderComplete = { success: false, error }` — there is no base64
 * fallback here (finals can be huge); the caller fails the job.
 */

const MEDIABUNNY_URL = 'https://esm.sh/mediabunny@1.27.3?target=es2022'

export interface FinalizePart {
  /** Where the page fetches this chunk's encoded bytes (CORS-accessible). */
  url: string
  /** The chunk's PLANNED duration in seconds (frameCount / fps) — the
   * timestamp offset source, never demuxed durations (rounding drifts). */
  duration: number
}

export interface FinalizeConcatPageOptions {
  parts: FinalizePart[]
  format: 'webm' | 'mp4'
  /** Stamped into the output track metadata. */
  frameRate: number
  /** The finished file is PUT here (Content-Type set from `format`). */
  uploadUrl: string
  /**
   * Audio-once-at-finalize (the rendering plan's audio model — chunks are
   * video-only by construction, so encoder priming seams never exist):
   * `producerCode` defines `window.__vosAudioProducer__({ data, duration,
   * sampleRate }) => AudioBuffer | null` (the studio clips' plan rides the
   * code itself, baked by `audioProducerCode({ plan })`, since this
   * page passes none), evaluated before the concat; a
   * returned buffer is muxed as the output's audio track (AAC for mp4 with
   * an Opus fallback, Opus for webm). Null/absent = video-only.
   */
  audio?: {
    producerCode: string
    data: unknown
    /** Total OUTPUT duration in seconds (the mix length). */
    duration: number
  }
  /**
   * Pre-encoded audio: the `audio` ingest part produced by the audio
   * mix page. Its packets are STREAM-COPIED into the output — no decode, no
   * OfflineAudioContext, no producer — so a fallback finalize on this page
   * carries none of the audio-production memory bill. Mutually exclusive
   * with `audio`.
   */
  audioPart?: { url: string }
}

export function buildFinalizeConcatPage(
  options: FinalizeConcatPageOptions,
): string {
  if (options.parts.length === 0) {
    throw new Error('buildFinalizeConcatPage: no parts')
  }
  if (options.audio && options.audioPart) {
    throw new Error(
      'buildFinalizeConcatPage: audio and audioPart are mutually exclusive',
    )
  }
  const contentType = options.format === 'mp4' ? 'video/mp4' : 'video/webm'
  const config = JSON.stringify({
    parts: options.parts,
    format: options.format,
    frameRate: options.frameRate,
    uploadUrl: options.uploadUrl,
    contentType,
    audioData: options.audio ? options.audio.data : null,
    audioDuration: options.audio ? options.audio.duration : 0,
    audioPartUrl: options.audioPart ? options.audioPart.url : null,
  })
  const audioProducerBlock = options.audio ? options.audio.producerCode : ''

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>vos finalize</title></head>
<body>
<script type="module">
const CONFIG = ${config};
${audioProducerBlock}

// Stage marker: the supervising worker polls this every tick and reports the
// last stage seen when the page dies without a result — the only way to
// localize a page death on a fleet with no devtools (a diagnosis aid).
// Each stage carries the V8 heap sample when available, so a death
// names its memory peak too. Heap only covers JS objects (ArrayBuffers are
// external), so treat it as a floor, not the whole bill. The stage NAME must
// stay the first space-delimited token — renderPolicy's finalizeDeathStage
// parses it out of the error message.
const stage = (s) => {
  const m = performance.memory;
  window.__finalizeStage = m ? s + ' heap=' + Math.round(m.usedJSHeapSize / 1048576) + 'MB' : s;
};
stage('boot');

;(async () => {
  stage('import-mediabunny');
  const MB = await import(${JSON.stringify(MEDIABUNNY_URL)});

  // Audio first: a producer failure aborts before any concat work.
  let audioBuffer = null;
  if (window.__vosAudioProducer__ && CONFIG.audioData != null) {
    stage('audio-produce');
    audioBuffer = await window.__vosAudioProducer__({
      data: CONFIG.audioData,
      duration: CONFIG.audioDuration,
      sampleRate: 48000,
    });
  }

  // Pre-encoded audio part: stream-copy, no production memory bill.
  let audioPartTrack = null;
  let audioPartConfig = null;
  if (CONFIG.audioPartUrl) {
    stage('audio-part-open');
    const abytes = await (await fetch(CONFIG.audioPartUrl)).arrayBuffer();
    const ainput = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BufferSource(abytes) });
    audioPartTrack = await ainput.getPrimaryAudioTrack();
    if (!audioPartTrack || !audioPartTrack.codec) {
      throw new Error('Audio part has no readable audio track');
    }
    audioPartConfig = await audioPartTrack.getDecoderConfig();
    if (!audioPartConfig) throw new Error('Audio part has no decoder config');
  }

  const openTrack = async (bytes, index) => {
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BufferSource(bytes) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Chunk ' + index + ' has no video track');
    return track;
  };

  stage('fetch-part-0');
  const first = await (await fetch(CONFIG.parts[0].url)).arrayBuffer();
  stage('open-part-0');
  const firstTrack = await openTrack(first, 0);
  const codec = firstTrack.codec;
  if (!codec) throw new Error('Chunk 0 video codec could not be determined');
  const decoderConfig = await firstTrack.getDecoderConfig();
  if (!decoderConfig) throw new Error('Chunk 0 has no decoder config');

  const output = new MB.Output({
    format: CONFIG.format === 'mp4' ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat(),
    target: new MB.BufferTarget(),
  });
  const videoSource = new MB.EncodedVideoPacketSource(codec);
  output.addVideoTrack(videoSource, { frameRate: CONFIG.frameRate });

  let audioSource = null;
  let audioPacketSource = null;
  if (audioPartTrack) {
    audioPacketSource = new MB.EncodedAudioPacketSource(audioPartTrack.codec);
    output.addAudioTrack(audioPacketSource);
  } else if (audioBuffer) {
    // AAC first for mp4 (compatibility), Opus fallback — AAC encode is
    // unavailable on some fleets (probe: aacEncode false on Linux).
    const preferred = CONFIG.format === 'mp4' ? 'aac' : 'opus';
    const audioCodec =
      preferred === 'aac' && !(await MB.canEncodeAudio('aac')) ? 'opus' : preferred;
    audioSource = new MB.AudioBufferSource({ codec: audioCodec, bitrate: MB.QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  if (audioPacketSource && audioPartTrack) {
    stage('audio-part-copy');
    const asink = new MB.EncodedPacketSink(audioPartTrack);
    let firstAudio = true;
    for await (const packet of asink.packets()) {
      await audioPacketSource.add(
        packet,
        firstAudio ? { decoderConfig: audioPartConfig } : undefined,
      );
      firstAudio = false;
    }
    audioPacketSource.close();
  } else if (audioSource && audioBuffer) {
    await audioSource.add(audioBuffer);
    audioSource.close();
  }

  // Mirrors render-core concat.ts: plan-derived offsets, keyframe-per-chunk
  // guard, decode-order packet walk.
  let offset = 0;
  let packetCount = 0;
  for (let i = 0; i < CONFIG.parts.length; i++) {
    stage('concat-part-' + i);
    const bytes = i === 0 ? first : await (await fetch(CONFIG.parts[i].url)).arrayBuffer();
    const track = i === 0 ? firstTrack : await openTrack(bytes, i);
    if (track.codec !== codec) {
      throw new Error('Chunk ' + i + ' codec ' + track.codec + ' != chunk 0 codec ' + codec);
    }
    const sink = new MB.EncodedPacketSink(track);
    let firstOfChunk = true;
    for await (const packet of sink.packets()) {
      if (firstOfChunk && packet.type !== 'key') {
        throw new Error('Chunk ' + i + ' does not start on a keyframe');
      }
      const shifted = packet.clone({ timestamp: packet.timestamp + offset });
      await videoSource.add(shifted, firstOfChunk && i === 0 ? { decoderConfig } : undefined);
      firstOfChunk = false;
      packetCount++;
    }
    offset += CONFIG.parts[i].duration;
  }

  stage('finalize-output');
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Concat produced no output buffer');

  stage('upload');
  const res = await fetch(CONFIG.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': CONFIG.contentType },
    body: buffer,
  });
  if (!res.ok) throw new Error('Upload failed: HTTP ' + res.status);

  window.__renderComplete = {
    success: true,
    uploaded: true,
    size: buffer.byteLength,
    packetCount,
  };
})().catch((e) => {
  window.__renderComplete = { success: false, error: String((e && e.stack) || e) };
});
</script>
</body>
</html>`
}
