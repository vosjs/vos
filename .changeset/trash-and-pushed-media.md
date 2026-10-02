---
'@vosjs/cli': minor
---

`vos delete` moves a vos to Trash on vos.so, and `vos trash` and `vos restore` see and undo it. A push now carries every local file a document names.

- **Deleting is undoable.** vos.so keeps a deleted vos in Trash until the date the delete prints. `vos delete` says that date and the way back (`vos restore <id>`), sends who is asking so Trash can name the tool, and gains `--dry-run`, which names what would move and changes nothing. `vos trash` lists what is there (what, moved by whom, restorable until when), `vos restore <id|url> [...]` brings things back as they were, and `vos trash restore --since <30m|1h|2d|ISO> [--by <key name>]` undoes everything a key moved to Trash since a moment. There is no verb that empties Trash: that is the person's act, on the web. The rules block `vos setup` writes says so in one line.
- **A take push keeps its voice and its webcam.** A local `micKey` or `camKey` was dropped from the push as "local-only", while `vos fetch --media` writes both beside the take: fetch, then push, and the hosted take had lost them. They now upload through the same content-addressed door as the recording, so a re-push sends nothing twice. A sidecar whose file is missing is still left out, and said.
- **3D props and a program's overlays upload too.** A document's object clips (a GLB) were never walked, and a program push uploaded only its sound, so a pushed document could key files only the pusher's disk held. Overlays, props and sound now ride the push for both kinds of document. A `.glb` is known by its bytes and its name (`model/gltf-binary`).
- The README and the port scaffold named a verb that does not exist (`vos asset upload`); it is `vos asset push`.
