---
'@vosjs/cli': minor
---

Many accounts on one machine (MA1): `vos login` is additive, so a second sign-in (the person picks the account on the approval page, themselves or an organization they act for) keeps the first, each stored by name under `~/.config/vos/accounts/<host>/<id>` with the one in use at `~/.config/vos/credentials`, whose first line is still the key every older reader expects. `vos switch [<handle>]` makes another stored account the one in use (with two stored, the other one), `vos whoami` says which account is in use, which rung of the ladder resolved it and what else is stored, `vos logout [<handle>] [--all]` forgets one or all, and `vos doctor` lists them. `--account <handle>` on every platform verb and `VOS_ACCOUNT` in the environment pick a stored account by name, and a name nothing is stored under is refused in words, never answered with another account. A key still acts for exactly the account it belongs to; switching is choosing a key.
