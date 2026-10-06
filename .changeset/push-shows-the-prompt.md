---
'@vosjs/cli': minor
---

A push says how to show the prompt that made the vos. A new vos pushed without `--prompt` (a program or a take) prints the command that adds it, `vos push <target> --vos <id> --prompt "<the person's prompt, as they wrote it>"`, and carries it as `promptHint` under `--json`, because the watch page shows the prompt by default and an agent acts on what a push prints. A take push takes `--prompt` too, on its first push and on later ones, as a program push already did. The bundled skills pass the person's prompt on every push that creates a vos.
