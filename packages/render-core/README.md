# @vosjs/render-core

> The render harness for deterministic vos renders: shard a timeline into parallel chunks, then stream-copy the encoded chunks back into one file without re-encoding.

[![npm](https://img.shields.io/npm/v/@vosjs/render-core.svg)](https://www.npmjs.com/package/@vosjs/render-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos). Pixels never leave the browser: every frame is encoded in-page with WebCodecs and [mediabunny](https://mediabunny.dev). This package owns what happens around that in Node: how a timeline is split into frame ranges that can render concurrently, and how the encoded parts are muxed into a single container. Its one dependency is mediabunny. Consumed by the `vos` CLI's local render and by any host that fans a render out across browser sessions.

What is deliberately not here: the pages a hosted fleet runs (a finalize page that fetches parts from an ingest route, an audio mix page), and any queue, storage or session-pool policy. Those are a host's opinions about its own infrastructure; this package hands them the plan and the mux and nothing else.

## Install

```bash
pnpm add @vosjs/render-core
```

## Why sharding is correct here

A vos render is a pure `seek(t)` function, so a timeline splits cleanly into independent frame ranges. Each range renders concurrently as its own page, encoded with pinned encoder params and chunk-local timestamps, and the packets are stream-copied into one container: a plain demux and remux, no re-encode, no quality loss. Timestamp offsets come from the plan (frames divided by fps), never from measured durations, so rounding cannot drift.

```
planChunks(totalFrames, fps, { maxParallel }) ──▶ [ { index, startFrame, endFrame, frameCount, startTime, duration }, … ]
        │  render each range concurrently (a browser page each, pinned encoder)
        ▼
muxEncodedExport({ video: parts, audio?, format }) ──▶ one file, packet-identical to a single-pass render
```

Audio stays out of the chunks by design and is mixed once at finalize, so codec priming seams never exist.

## Exports

| Export                                 | Purpose                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planChunks(totalFrames, fps, policy)` | Split a timeline into balanced frame ranges. `policy` is `{ maxParallel, minFramesPerChunk? }`; the floor is `DEFAULT_MIN_FRAMES_PER_CHUNK` (24). Pure math.                |
| `muxEncodedExport(options)`            | Stream-copy encoded video parts (an iterable or async iterable of `{ data, duration }`, fed one at a time) plus an optional encoded audio part into one `webm` or `mp4`.    |
| `concatEncodedVideo(chunks, options)`  | The same for an in-memory list of video chunks; a thin wrapper over `muxEncodedExport`.                                                                                     |
| `countVideoPackets(bytes)`             | Count the video packets in an encoded file; used by parity checks.                                                                                                          |
| `audioProducerCode(options?)`          | Page JavaScript that mixes a composition's audio in the browser through `@vosjs/core/audio`, from a host-built plan or from the studio's audio data, for the finalize step. |
| `dataHasAudio(data, stack?, plan?)`    | Whether a lowered composition carries any sound, so a video-only render can skip the audio page.                                                                            |
| `studioEntryData(stack)`               | Find the studio layer entry's data in a lowered `stack` (array or keyed).                                                                                                   |

Types: `ChunkPlanPolicy`, `RenderChunk`, `ConcatChunk`, `ConcatOptions` (`{ format, frameRate? }`), `ConcatResult` (`{ bytes, packetCount, codec }`), `MuxExportOptions`, `AudioPlanJson`, `AudioProducerCodeOptions`; plus `CORE_AUDIO_CDN_URL`, the pinned `@vosjs/core/audio` module the producer page imports.

## Contract: the concat mirror

A host that concatenates parts inside a browser page (a fleet's fallback, where the Node mux cannot run) must stay packet-identical to `concat.ts`: the CLI uses the Node path, a fleet may use a page, and the two must produce the same file. Keep any such page in sync with `concat.ts` and assert the parity in the host's own harness.

## Development

```bash
pnpm --filter @vosjs/render-core test
pnpm --filter @vosjs/render-core typecheck
```

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
