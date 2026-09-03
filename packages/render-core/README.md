# @vosjs/render-core

The orchestration math and Node-side media plumbing for deterministic vos
renders. Pixels never leave the browser — every frame is encoded in-page via
WebCodecs + [mediabunny](https://mediabunny.dev). This package owns everything
around that: how a timeline is sharded into parallel chunks, and how the encoded
chunks are stitched back into one file without re-encoding.

Pure Node, no browser and no WebGL. Consumed by the `vos` CLI's local render
(`../cli`) and by any host that fans a render out across browser sessions and
stitches the parts back together. MIT.

What is deliberately NOT here: the pages a hosted fleet runs (a finalize page
that fetches parts from an ingest route, an audio mix page, a digest page) and
any queue, storage or session-pool policy. Those are a host's opinions about its
own infrastructure; this package hands them the plan and the mux and nothing
else.

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

| Export                                       | Purpose                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `planChunks(totalFrames, fps, policy)`       | Split a timeline into balanced frame ranges (floor `DEFAULT_MIN_FRAMES_PER_CHUNK` per chunk). Pure math.               |
| `concatEncodedVideo(chunks, options)`        | Stream-copy encoded chunks into one video (mediabunny demux/mux, no re-encode).                                        |
| `countVideoPackets(bytes)`                   | Count video packets in an encoded file — used by parity checks.                                                        |
| `audioProducerCode()` / `dataHasAudio(data)` | Page-JS mirror of the client audio exporter — produces the mixed audio buffer at finalize from the lowered Voila data. |

## Contract: the concat mirror

A host that concatenates chunk parts inside a browser page (a fleet's finalize
fallback, where the Node mux cannot run) must stay **packet-identical** to
`concat.ts`: the CLI uses the Node path, a fleet may use a page, and the two
must produce the same file. Keep any such page in sync with `concat.ts` and
assert the parity in the host's own harness.

## Development

```bash
pnpm --filter @vosjs/render-core test       # vitest
pnpm --filter @vosjs/render-core typecheck
```
