/**
 * The take audio producer — page JavaScript implementing the export audio mix
 * for the take data schema, as a source string for injection into render
 * pages (the engine's `capture.audioProducerCode` seam for single-flight
 * captures, the audio mix page, and the finalize page for chunked exports).
 *
 * MIRRORS the client exporter's audio path (the platform's
 * decodeAudio → spliceAudio → mixExportAudio) — the same
 * algorithm, so a cloud export sounds identical to a client export of the
 * same composition. KEEP THEM IN SYNC when the client mixer changes.
 *
 * The producer is `window.__vosAudioProducer__({ data, plan, duration,
 * sampleRate })`. Inputs read from `data` (all optional):
 *   videoSrc   recording URL (requires hasAudio; the VOICE on legacy takes,
 *              the SYSTEM track on split takes)
 *   micSrc     mic sidecar URL (the mic/system split) — the voice; when present the
 *              recording's own track mixes as system audio under sysGain
 *   hasAudio   whether the recording carries audio
 *   segments   [{ in, out, rate? }] SOURCE spans — mic is spliced/resampled
 *              so trims and speed changes stay lip-synced (pitch shifts with
 *              rate, matching preservesPitch=false preview playback)
 *   micGain    voice master fader (default 1)
 *   sysGain    system-audio master fader (default 1; split takes only)
 *
 * The music/SFX clips no longer ride `data`: they live on the
 * studio stack entry (`vosso.studio`), and the host builds an ENGINE audio
 * plan from them ahead of the page (studio-core's `studioAudioPlan`), the
 * shape `@vosjs/core/audio`'s `mixAudio` renders. The page imports that
 * mixer from the CDN and renders the plan to ONE buffer beside the
 * recording's tracks. `plan` reaches the producer either as a call argument
 * (a page's CONFIG) or baked into the code as `window.__vosAudioPlan__`
 * (the engine's capture template calls the producer with `{ data, duration,
 * sampleRate }` only, so single-flight captures bake it); no plan, no clips.
 */

/**
 * The `@vosjs/core/audio` build a render page imports for `mixAudio`.
 * Pinned to the version the api installs (`coreAudioCdn.test.ts` there
 * holds it to the installed package): render-core has no engine dependency.
 */
export const CORE_AUDIO_CDN_URL =
  'https://esm.sh/@vosjs/core@0.23.1/audio?target=es2022'

/**
 * A sampled audio plan, structurally `@vosjs/core/audio`'s `AudioPlan` (and
 * studio-core's `StudioAudioPlan`), typed here so render-core depends on
 * neither.
 */
export interface AudioPlanJson {
  duration: number
  step: number
  tracks: {
    id: string
    src: string
    loop: boolean
    points: { t: number; on: boolean; pos: number; gain: number }[]
  }[]
}

export interface AudioProducerCodeOptions {
  /**
   * Bake the plan into the code (`window.__vosAudioPlan__`) for callers
   * that cannot pass one at call time (the engine's capture template).
   */
  plan?: AudioPlanJson | null
  /** Override the mixer import (tests, a self-hosted engine). */
  coreAudioUrl?: string
}

/** The studio stack entry id (studio-core's `STUDIO_ENTRY_ID`). */
export const STUDIO_ENTRY_ID = 'vosso.studio'

/**
 * The studio entry's own data out of a stack in either shape: the STORED
 * config's `stack` array (`[{ id, data, … }]`) or the lowered record keyed
 * by entry id (`{ 'vosso.studio': data }`). Null when there is none.
 */
export function studioEntryData(
  stack: unknown,
): Record<string, unknown> | null {
  if (stack == null || typeof stack !== 'object') return null
  const asData = (value: unknown) =>
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null
  if (Array.isArray(stack)) {
    for (const entry of stack) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as { id?: unknown }).id === STUDIO_ENTRY_ID
      ) {
        return asData((entry as { data?: unknown }).data)
      }
    }
    return null
  }
  return asData((stack as Record<string, unknown>)[STUDIO_ENTRY_ID])
}

export function audioProducerCode(
  options: AudioProducerCodeOptions = {},
): string {
  const coreAudioUrl = options.coreAudioUrl ?? CORE_AUDIO_CDN_URL
  const bakedPlan = options.plan
    ? `window.__vosAudioPlan__ = ${JSON.stringify(options.plan)};`
    : ''
  return `
${bakedPlan}
window.__vosAudioProducer__ = async ({ data, plan, duration, sampleRate }) => {
  const rate = sampleRate || 48000;
  const audioPlan = plan === undefined ? window.__vosAudioPlan__ : plan;
  const CORE_AUDIO_URL = ${JSON.stringify(coreAudioUrl)};

  const decodeAudio = async (url) => {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      const ac = new AudioContext();
      try {
        return await ac.decodeAudioData(buf);
      } finally {
        void ac.close();
      }
    } catch (e) {
      console.warn('[audio-producer] source not decodable:', e);
      return null;
    }
  };

  // Cut mic audio to the kept source segments; rated segments resample
  // piecewise with linear interpolation (tape-style pitch shift).
  const spliceAudio = (buf, segments) => {
    const sr = buf.sampleRate;
    const pieces = segments.map((s) => {
      const start = Math.max(0, Math.min(Math.round(s.in * sr), buf.length));
      const end = Math.max(start, Math.min(Math.round(s.out * sr), buf.length));
      const r = s.rate !== undefined && s.rate > 0 ? s.rate : 1;
      return { start, end, rate: r, outLen: Math.round((end - start) / r) };
    });
    const total = pieces.reduce((sum, p) => sum + p.outLen, 0);
    if (total <= 0) return buf;
    if (pieces.length === 1 && pieces[0].start === 0 && pieces[0].rate === 1 && total === buf.length) {
      return buf;
    }
    const out = new AudioBuffer({ length: total, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = out.getChannelData(ch);
      let offset = 0;
      for (const p of pieces) {
        if (p.rate === 1) {
          dst.set(src.subarray(p.start, p.end), offset);
        } else {
          const last = buf.length - 1;
          for (let i = 0; i < p.outLen; i++) {
            const pos = p.start + i * p.rate;
            const j = Math.min(Math.floor(pos), last);
            const a = src[j];
            const b = src[Math.min(j + 1, last)];
            dst[offset + i] = a + (b - a) * (pos - j);
          }
        }
        offset += p.outLen;
      }
    }
    return out;
  };

  const videoSrc = typeof data?.videoSrc === 'string' ? data.videoSrc : null;
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  const tracks = audioPlan && Array.isArray(audioPlan.tracks) ? audioPlan.tracks : [];
  const micGain = typeof data?.micGain === 'number' ? data.micGain : 1;
  const sysGain = typeof data?.sysGain === 'number' ? data.sysGain : 1;
  const micSrc = typeof data?.micSrc === 'string' ? data.micSrc : null;
  // Voice: the mic sidecar (AT split), else the legacy track on the recording.
  // System: the recording's own track, only when the take is split.
  const voiceSrc = micSrc ?? (data?.hasAudio && videoSrc ? videoSrc : null);
  const sysSrc = micSrc && data?.hasAudio && videoSrc ? videoSrc : null;

  // Recording tracks load through a pluggable seam: a host page may
  // install window.__vosStreamSplice__(url, segments, maxSeconds) — the
  // audio mix page does, backed by mediabunny streaming decode of ONLY the
  // needed source spans, capped at the output duration — and the producer
  // prefers it, falling back to the whole-file decodeAudioData path on any
  // failure. Standalone pages (single-flight capture) have no seam and
  // behave exactly as before.
  const loadRecordingTrack = async (url) => {
    const streamSplice = window.__vosStreamSplice__;
    if (streamSplice) {
      try {
        const buf = await streamSplice(url, segments, duration);
        if (buf) return buf;
      } catch (e) {
        console.warn('[audio-producer] stream splice failed, falling back:', e);
      }
    }
    const raw = await decodeAudio(url);
    return raw && segments.length ? spliceAudio(raw, segments) : raw;
  };

  let mic = voiceSrc ? await loadRecordingTrack(voiceSrc) : null;
  let sys = sysSrc ? await loadRecordingTrack(sysSrc) : null;

  // The clips: decode each distinct plan source to plain PCM, then render
  // the plan with the engine's mixer (one buffer, every clip at its
  // interpolated position and gain, the duck curve already folded in).
  const clipPcm = new Map();
  for (const src of new Set(tracks.map((t) => t.src))) {
    const buf = await decodeAudio(src);
    if (!buf) continue;
    const channels = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    clipPcm.set(src, { sampleRate: buf.sampleRate, length: buf.length, channels });
  }
  if (!mic && !sys && clipPcm.size === 0) return null;
  // Voice-only at unity gain: skip the offline pass — but ONLY when the
  // buffer fits the requested output duration. A spliced take can run longer
  // than a duration-capped render asks for (Render API maxDuration), and
  // returning it whole used to mux extra seconds of audio onto the video
  // Overlong falls through to the offline render, whose
  // length IS the duration by construction.
  if (
    clipPcm.size === 0 && mic && !sys && micGain === 1 &&
    mic.length <= Math.ceil(duration * mic.sampleRate)
  ) return mic;

  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
  if (mic) {
    const src = off.createBufferSource();
    src.buffer = mic;
    const gain = off.createGain();
    gain.gain.value = micGain;
    src.connect(gain);
    gain.connect(off.destination);
    src.start(0);
  }
  if (sys) {
    const src = off.createBufferSource();
    src.buffer = sys;
    const gain = off.createGain();
    gain.gain.value = sysGain;
    src.connect(gain);
    gain.connect(off.destination);
    src.start(0);
  }
  if (clipPcm.size > 0) {
    const { mixAudio } = await import(CORE_AUDIO_URL);
    const pcm = mixAudio(audioPlan, clipPcm, { sampleRate: rate, channels: 2 });
    const buf = off.createBuffer(pcm.channels.length, pcm.length, pcm.sampleRate);
    for (let c = 0; c < pcm.channels.length; c++) buf.copyToChannel(pcm.channels[c], c);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0);
  }
  return off.startRendering();
};
`
}

/**
 * Does this composition carry anything the audio producer could mix? The
 * voice reads off `data`; the clips off the studio stack entry (`stack` in
 * either shape `studioEntryData` reads) or an already-built plan.
 */
export function dataHasAudio(
  data: unknown,
  stack?: unknown,
  plan?: AudioPlanJson | null,
): boolean {
  const d =
    data != null && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : null
  const hasVoice =
    !!d &&
    (typeof d.micSrc === 'string' ||
      (!!d.hasAudio && typeof d.videoSrc === 'string'))
  const entryAudio = studioEntryData(stack)?.audio
  const hasClips =
    (!!plan && plan.tracks.length > 0) ||
    (Array.isArray(entryAudio) && entryAudio.length > 0)
  return hasVoice || hasClips
}
