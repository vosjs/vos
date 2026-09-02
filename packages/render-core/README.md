# @vosso/render-core

The orchestration math and Node-side media plumbing for deterministic vos
renders. Pixels never leave the browser — every frame is encoded in-page via
WebCodecs + [mediabunny](https://mediabunny.dev). This package owns everything
around that: how a timeline is sharded into parallel chunks, and how the encoded
chunks are stitched back into one file without re-encoding.

Pure Node, no browser and no WebGL. Consumed in-source by
[`@vosso/vos-plugin`](../vos-plugin) (bundled via tsup `noExternal`) and by the
vosso render worker's finalize path. MIT.

## Why sharding is correct here

A vos render is a pure `seek(t)` function, so a timeline splits cleanly into
independent frame ranges. Each range is rendered concurrently as its own page,
encoded with **pinned** encoder params and chunk-local timestamps, then the
packets are stream-copied into a single container — a plain demux/remux, no
re-encode, no quality loss. Timestamp offsets come from the plan (frames ÷ fps),
never from measured durations, so rounding can't drift.

```
planChunks(total, fps, policy) ──▶ [ {startFrame, endFrame}, … ]
        │  render each range concurrently (browser, pinned encoder)
        ▼
concatEncodedVideo([chunk₀, chunk₁, …]) ──▶ one file, packet-identical to a single-pass render
```

Audio stays out of the chunks by design and is mixed **once** at finalize, so AAC
priming seams never exist.

## Exports

| Export                                       | Purpose                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `planChunks(totalFrames, fps, policy)`       | Split a timeline into balanced frame ranges (floor `DEFAULT_MIN_FRAMES_PER_CHUNK` per chunk). Pure math.                                                           |
| `concatEncodedVideo(chunks, options)`        | Stream-copy encoded chunks into one video (mediabunny demux/mux, no re-encode).                                                                                    |
| `countVideoPackets(bytes)`                   | Count video packets in an encoded file — used by parity checks.                                                                                                    |
| `buildFinalizeConcatPage(options)`           | Build the in-browser finalize page: fetch chunk parts, concat, mux produced audio, upload the result. Runs in a browser page (its memory, not the 128 MB isolate). |
| `audioProducerCode()` / `dataHasAudio(data)` | Page-JS mirror of the client audio exporter — produces the mixed audio buffer at finalize from the lowered Voila data.                                             |

## Contract: the concat mirror

`concat.ts` and the concat inside `buildFinalizeConcatPage` must stay
**packet-identical** — the finalize page runs in a browser, the standalone concat
runs in Node, and cloud exports fan-in through the page while the CLI uses the Node
path. `vos-plugin`'s `verify-finalize-page` asserts they produce identical output;
keep the two in sync when touching either.

## Development

```bash
pnpm --filter @vosso/render-core test       # vitest
pnpm --filter @vosso/render-core typecheck
```
