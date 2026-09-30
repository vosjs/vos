---
'@vosjs/cli': minor
'@vosjs/studio-core': minor
---

Sound rides every push and every program render; finished footage ingests bare.

- `vos asset push` sends sound and video through the recording door (typed by their bytes, in parts when large, filed with `--folder`), so a score lands in Sound > Uploads.
- `vos push` of a program (and of a take) uploads the local files its `doc.audio` names; a claimable push sends the composed config and says which local sounds it left out.
- `vos render` of a program mixes the sound its document adds, inlining files the capture page cannot fetch; `vos check` warns that an `audio` element is not a track.
- The output's name picks mp4 or webm, and a contradicting `--format` is refused. `vos still` takes `--times` in one browser and writes PNG or JPEG by name. `--set data.<key>=<value>` reaches a program on `render` and `still`.
- `vos push --wait` stays until the version's still renders; `vos delete <id|url|dir>` takes a vos down; a push without `--folder` says it landed unfiled.
- studio-core: `FOOTAGE_FRAME_STYLE` and `projectFromArtifact(…, { footage: true })`. `vos ingest` reads a file with no cursor trace as finished footage (no card, no bar, no drawn cursor, its own frame rate); `--as footage|take` says it outright.
