---
'@vosjs/cli': minor
---

`vos setup` shows its plan, says what it changed, and takes itself back out.

- `vos setup --plan` prints what setup would do with the same flags and does none of it: the agents found, each skills directory with the skills that would be copied and the ones already there, the browser found or the command that would install one, and the rules file with the exact block. No file is written, nothing is installed, nothing is run.
- `vos setup` ends with a receipt: every path it created or changed, as `changed` in the done event and in words before the doctor's lines, with the line that undoes it. A second run over the same files says it changed nothing.
- `vos setup` no longer stops at a skill that is already there as a symbolic link (the layout `npx skills add` writes). The link is left as it is, with nothing copied over or through it, the other skills are copied, and the run says what it left under `left as it was:` and in `skills.kept`. A file standing where a skill would go, and a skills directory reached through a link, are left the same way.
- `vos setup --remove` undoes setup. It removes a skill only when the directory has a bundled skill's name and its `SKILL.md` names that same skill; a skill that is a link is left as it is, since setup never writes one; anything else is kept and listed with the reason. The marked block comes out of `AGENTS.md` and `CLAUDE.md` and the rest of the file is byte for byte what it was. It never removes a browser, the package, a credential or a take, and prints the lines for those. `--remove --plan` shows what would go.
- `vos guide` and `vos guide host` print the setup procedure from the package, as plain markdown: recording a product, and hosting a video already made. Both are exported, as `agentGuide()` and `hostGuide()`.
- `vos feedback "<what happened>"` reports a problem to vos.so. It prints the address and the whole body before it sends, `--dry-run` sends nothing, and it never sends a credential.
- The block setup writes into `AGENTS.md` says the skill came from `vos setup` and how to undo it, and no longer names an unpinned catalog install. The doctor's next step on a ready machine is `npx vos guide`.
- A rules file with no final newline keeps having none after the block is added, so the undo can hand it back exactly.
