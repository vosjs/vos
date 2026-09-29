---
'@vosjs/cli': minor
---

A push names the coding agent that ran it. With no `VOS_CLIENT` set, the client string a pushed version self-reports is now the host agent read from the environment (the `AI_AGENT` convention first, then Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Copilot, Replit, Augment, Antigravity and Devin's own markers), for example `claude-code vos-cli`, and `vos-cli` only when no agent is found. The string stays display-only; attribution still rests on the credential.
