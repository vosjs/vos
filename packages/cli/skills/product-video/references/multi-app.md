# One film across several apps

Read this when the story leaves one window: a prompt in a chat app, a
command in a terminal, the result in a browser. Read `desktop.md` first;
everything in it holds for each app here.

**The unit is still one window.** A take records one app's window, and a
film is a list of takes: record each app as its own take, then
`vos join` them. There is no capture of several windows at once, and none
is needed. Needs `@vosjs/cli` 0.93 or later; what needs 0.94 says so.

## Before the first take

Say these to the person, once, before anything is launched:

- **The takes, in order**, and which app each one is.
- **What each app will show that is theirs** (a name, a plan, recent work)
  and what you will mask. A picker that lists their recent work is chosen
  OFF camera (in `setup`), or masked row by row; off camera is simpler.
- **What will be launched and closed**: a terminal window, a throwaway
  browser, a dev server. And what will be left: a session in their
  account, a project on disk.
- **How long the pointer and keyboard are taken**, in total.
- **The look.** Apps follow the system's light or dark appearance, and a
  stage cannot pin it without changing the person's settings. Film every
  take in one sitting, and say so if the appearance changed between takes.

## A stage per app

Each app is made fit to film before its take, and put back after. Keep
the stage in one script with an up and a down per app, and keep the
process ids it started.

### The app that is an account

`desktop.md`, "An app that is an account". Its window is resized by the
take (`viewport`): put it back to the size it had.

### A terminal

Start a terminal that was not running, in the project's folder, with a
shell of its own: no name, no host, no history of the person's.

```bash
# stage/zdot/.zshrc
unsetopt PROMPT_SP
HISTFILE=/dev/null
PROMPT='%1~ ❯ '
printf '\e[3J'; clear
```

```bash
# stage/terminal.command (chmod +x), opened with: open -a Terminal stage/terminal.command
cd /path/to/project
export ZDOTDIR=/path/to/stage/zdot
exec zsh -i
```

- **Mask the title bar.** A terminal's title names the running process,
  and once a tool rewrites its process title (`npm` does) the title can
  show the environment of the shell that launched it. Cover the title's
  text before the command runs:
  `"mask": [{ "selector": "text[name*='<project> —']" }]` (read the role
  and the name from `vos look`).
- **A resize reflows the screen.** The take gives the window its
  `viewport`, and the prompt lands a third of the way down. Clear the
  screen in `setup`:
  ```json
  "setup": [
    { "do": "type", "selector": "textarea[name='shell']", "text": "clear" },
    { "do": "press", "key": "Enter" },
    { "do": "wait", "ms": 700 }
  ]
  ```
- **Only start the app if it was not running.** If it was, it is the
  person's: ask, or use another terminal. End what you started
  (`pkill -x Terminal` only when the whole app is the stage's).

### A browser

A throwaway instance with its own profile, never the person's browser:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$STAGE/chrome-profile" --force-renderer-accessibility \
  --no-first-run --no-default-browser-check --disable-sync \
  --window-size=1440,900 about:blank &
echo $! > "$STAGE/chrome.pid"
```

- **A fresh profile suggests searches as you type**, and the suggestions
  are in the picture. Before the FIRST launch, write
  `{"search":{"suggest_enabled":false}}` to
  `$STAGE/chrome-profile/Default/Preferences`.
- **The address bar holds the page's address**, so typing lands inside
  it. Click the field, `press` `Mod+A`, then `type`.
- Aim every command at the process: `--pid "$(cat $STAGE/chrome.pid)"`.
  End it by that pid and check nothing with that profile is left
  (`pgrep -f "user-data-dir=$STAGE/chrome-profile"`).

### A server

A dev server the film needs is started ON camera, in the terminal take,
so the port must be free first. If an agent's session already started one,
stop that one by its process id, after checking it is the stage's:

```bash
for pid in $(lsof -ti :5173 -sTCP:LISTEN); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn | grep '^n' | cut -c2-)
  case "$cwd" in "$PROJECT"*) kill "$pid" ;; *) echo "port 5173 is not the stage's: $cwd" ;; esac
done
```

Never kill by pattern.

### A panel that is another window

An app's Open panel is its own window: no selector of the take reaches
it. Drive it with keys (`Meta+Shift+G`, the path, `Enter`, `Enter`), and
expect what follows (a workspace trust dialog). When opening the folder
is not the story, do it in `setup`.

## What answers back is played by a program

A script is a list. A game, a chart that moves, a drag that depends on
where something landed need a loop that looks, decides and acts. Do not
script it with guessed coordinates. Write a play (`@vosjs/cli` 0.94 and
later):

```bash
vos record --pid "$(cat $STAGE/chrome.pid)" --play play.mjs --out take-play
```

```js
// play.mjs
export const take = { viewport: { width: 1280, height: 800 } }

export default async function (play, { window }) {
  await play.step('start', () => play.click("button[name='Play']"), {
    caption: 'And it plays',
  })
  await play.step(
    'fly',
    async () => {
      const until = play.now() + 25
      while (play.now() < until) {
        const ring = await nextRing() // your read of the world
        await play.move(ring.x * window.w, ring.y * window.h, 12)
      }
    },
    { zoom: false, payoff: true },
  )
}
```

- **`play`** has `click`, `type`, `press`, `move`, `find`, `gone`, `sleep`,
  `now` and `send`. `click` and `type` keep a script's rules (waited for,
  never a disabled control, never typed where keys are commands), and
  whatever the program throws ends the take. A play has no rehearsal.
- **`play.step(id, fn, marks)`** names a stretch: that is what a caption,
  a pin and the plan hold on to. Mark the stretch that is play
  `zoom: false`: the pointer there is steering, not pointing, and the
  planner then proposes nothing over it. Mark the reveal `payoff: true`.
- **Reading the world.** For a page, start the stage's browser with
  `--remote-debugging-port=<port>` and read state over it (the position
  of what must be followed, the score). Read, never write: the product's
  code is not touched and nothing is injected that changes what it does.
  For a native app, `play.find(selector)` answers an element's bounds and
  name.
- **Keep it honest.** The program plays the product as a person would,
  through the real pointer and keys. Never set a score, skip a level or
  edit state to make the picture.

Before 0.94 there is no `--play`: the film then shows the thing running
without play, and says so.

## A long task

"Ask, wait, show the result" is one take when the working is worth
showing (0.94 and later): wait inside the take, then cut it.

```json
{ "do": "expect", "gone": "button[name='Stop']", "timeout": 1200, "id": "working", "zoom": false }
```

with `--max-duration` above the wait. A window that stands still costs
almost nothing (about 7 KB a second), and a wait looks again when the
window cannot be read for a moment. In the cut, `segments` drop the
middle and a `speed` span (up to 16) runs what is kept: a checklist
ticking at 16 times is a beat. The machine is taken for the whole wait,
so say how long.

When the wait is long and nobody can leave the machine alone, it is two
takes joined, as `desktop.md` says. Either way, never take clips on a
clock: they catch the same moment three times.

## Join, then cut

```bash
vos join take-ask take-terminal take-play --out film --captions
vos digest film            # one digest per take: digest/, digest/m1/, digest/m2/
```

The first take is the primary; each next one is `m1`, `m2`, in order. A
span on a later take carries `"media": "m1"` and its seconds are that
take's own footage.

- **The cold open is a segment.** Open on two or three seconds of the
  payoff, then tell the story from the start: the first entry of
  `segments` names the last take
  (`{ "in": 14, "out": 16.5, "media": "m2", "camera": "rest" }`), and the
  rest follow in story order. Say it in a caption ("One prompt made
  this").
- **A change of app is a transition**, written on the segment that
  enters: `"anim": { "enter": { "kind": "slide", "side": "right", "seconds": 0.5 } }`
  between apps, a short `fade` between two takes of one app.
- **Captions sit where the app was not pressed.** A chat app's composer
  is in the lower third, where the house caption goes. From 0.94 the
  plan puts that take's captions at the top and says so; before it, set
  `transform.y` (0.14) on that take's captions by hand. Judge each
  caption at its own instant.
- **The pointer is off where nobody points**: `cursor.off` spans over
  the cold open and over play.
- **Reject by take.** A proposal you drop goes in `rejected` with its
  `media`. (Before 0.94, `vos validate` refuses a rejection that starts
  later than the FIRST take is long: upgrade, do not delete the span by
  hand and re-plan.)
- **One bed across the film**, placed after the cut, with its swell on
  the step marked `payoff`.

## The report

Beside the film: every app that was launched and that it is closed, the
servers stopped, what is left in an account (a session, by name) and on
disk, what of the person's showed and for how long, and how long the
pointer and keyboard were taken.

## Avoid

- Scripting play. If the thing answers back, it needs a loop.
- Opening a picker of the person's recent work on camera.
- Clips of a long task taken on a clock.
- Trusting a terminal's title bar. Mask it.
- Typing into an address bar without selecting what is there.
- Filming across a change of the system's appearance.
- Leaving a server the agent started, or stopping one by pattern.
- A second browser profile that is the person's own.
