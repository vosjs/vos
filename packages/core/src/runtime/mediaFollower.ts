/**
 * THE MEDIA FOLLOWER: how a playing `<video>` or `<audio>` is kept on the
 * clock. One rule, installed by the playback document at
 * `window.__vos__.media`, so a fix to it reaches every program the day the
 * player ships, where a rule compiled into a program reaches it when the
 * program is next saved.
 *
 *   media.follow(el, { at, rate, piece, end, loop, unlocked, lead })
 *
 * called once a frame WHILE PLAYING, by the code that knows which element
 * and which moment. It is then the only thing that assigns `currentTime` or
 * `playbackRate` to that element, or calls `play`. The paused frame is the
 * caller's: an export steps an element to an exact frame and takes nothing
 * from here.
 *
 * The rule, four parts:
 *
 *   1. ONE SEEK IN FLIGHT. Assigning `currentTime` aborts the seek before
 *      it, so a step on every frame is a seek that never lands. Only a CUT
 *      re-aims a seek in flight: another piece under the playhead, or the
 *      clock itself jumped (`transport.epoch`).
 *   2. THE ALLOWANCE IS OUTPUT TIME, AND NEVER UNDER THE COST. A sped-up
 *      piece may be 0.3 output seconds off (0.3 × rate source seconds),
 *      slow motion 0.12 source seconds and 1× 0.3; and at every rate at
 *      least what one seek measurably costs on this element.
 *   3. A STEP IS AIMED WHERE THE PLAYHEAD WILL BE WHEN IT LANDS, by the
 *      element's own measured seek time. The first step is aimed at now:
 *      nothing is guessed. Never onto a piece's last 0.05 s (an ended
 *      element rewinds when played).
 *   4. A LANDING IS CHECKED ONCE, and re-aimed once when it missed by more
 *      than half the allowance. After that only the allowance steps it.
 *
 * What is SHOWN stays a pure function of the clock: `at` is the caller's.
 * The state here (a measured cost, a seek in flight) lives on the element
 * and decides only how a real element is brought there.
 *
 * A program that finds no `window.__vos__.media` (an older player, a page
 * of its own) keeps its inline rule; the two must agree on the four parts
 * above, and a program is tested both ways.
 */

/** What `follow` is told each frame. */
export interface MediaFollowTarget {
  /** The source second the element should show now. */
  at: number
  /** Source seconds per output second at `at` (1 when absent). */
  rate?: number
  /** The continuous piece under the playhead; a change is a cut. */
  piece?: string | number
  /** The piece's last source second; a step never aims onto its last 0.05 s. */
  end?: number
  /** A loop of `dur` seconds: distances are taken around the wrap. */
  loop?: { dur: number } | null
  /** The viewer has asked for sound: lift a mute the autoplay policy forced. */
  unlocked?: boolean
  /**
   * This caller owns the element. When two callers drive one element (a
   * layer that shows a take's own footage), the lead's moment is the one
   * kept and the other is ignored while the lead is calling.
   */
  lead?: boolean
}

/** `window.__vos__.media`, as a program reads it. */
export interface VosMedia {
  /** The contract's version: 1. */
  v: number
  /** False when another caller leads this element and the call was ignored. */
  follow: (el: HTMLMediaElement, target: MediaFollowTarget) => boolean
}

/**
 * The follower's source: a script that installs `window.__vos__.media`. It
 * reads `window.__vos__.transport` (the player's speed, the clock's jumps)
 * when the document has one. Plain ES5 on purpose: it is inlined into a
 * page and evaluated by tests.
 */
export const MEDIA_FOLLOWER_SRC = `
(function () {
  var ns = window.__vos__ = window.__vos__ || {};
  function stateOf(el) {
    var st = el.__vosFollow;
    if (!st) {
      // lat < 0: no seek measured yet, so the first step is aimed at now.
      st = el.__vosFollow = { lat: -1, at: 0, to: 0, piece: undefined, landed: 0, fix: 0, lead: 0, epoch: undefined };
      if (el.addEventListener) el.addEventListener('seeked', function () {
        if (!st.at) return;
        var took = Math.min(2, (performance.now() - st.at) / 1000);
        st.lat = st.lat < 0 ? took : st.lat * 0.3 + took * 0.7;
        st.at = 0;
        st.landed = 1;
      });
    }
    return st;
  }
  function follow(el, o) {
    try {
      var now = performance.now();
      var st = stateOf(el);
      // One owner: a caller that does not lead stands back while one does.
      if (o.lead) st.lead = now;
      else if (st.lead && now - st.lead < 100) return false;

      var tr = ns.transport;
      var speed = tr && tr.speed > 0 ? tr.speed : 1;
      var rate = o.rate > 0 ? o.rate : 1;
      // Source seconds per WALL second: the piece's rate at the player's speed.
      var wall = rate * speed;
      var at = o.at;
      var loop = o.loop && o.loop.dur > 0 ? o.loop.dur : 0;
      var end = o.end == null ? Infinity : o.end;
      // A cut: the seek last issued aimed at another piece, or the clock
      // itself jumped since the last frame (a seek, a loop's wrap, a load).
      var epoch = tr ? tr.epoch : undefined;
      var cut = st.piece !== o.piece || (st.epoch !== undefined && st.epoch !== epoch);
      st.epoch = epoch;

      // What one seek costs here, in wall seconds (0 until one is measured).
      var cost = Math.max(0, Math.min(st.lat, 2));
      var allow = Math.max(rate > 1 ? 0.3 * rate : rate < 1 ? 0.12 : 0.3, cost * wall);
      var off = function (a) {
        var d = Math.abs(a - at);
        return loop ? Math.min(d, Math.abs(loop - d)) : d;
      };
      var step = function (fix) {
        var to = at + wall * cost;
        if (loop) to = to % loop;
        else to = Math.min(to, Math.max(at, end - 0.05));
        st.at = now; st.to = to; st.piece = o.piece; st.fix = fix ? 1 : 0; st.landed = 0;
        el.currentTime = to;
      };
      // 0 = leave it, 1 = step it, 2 = step it as the one re-aim of a landing.
      var due = function (tol) {
        if (el.seeking) return st.at !== 0 && cut && off(st.to) > tol ? 1 : 0;
        var d = off(el.currentTime);
        if (st.landed) {
          st.landed = 0;
          if (!st.fix && !cut && d > 0.5 * allow) return 2;
        }
        return d > tol ? 1 : 0;
      };

      var play = Math.min(16, Math.max(0.0625, wall));
      var a;
      if (el.playbackRate !== play) {
        el.playbackRate = play;
        // Resampled (tape-style) speed, matching an export's offline mix.
        if (el.preservesPitch !== false) el.preservesPitch = false;
        // A rate change lands late on the media clock, so the position is
        // checked against a tight margin at the switch.
        a = due(0.06);
      } else {
        a = due(allow);
      }
      if (a) step(a === 2);

      if (el.paused) {
        var p = el.play();
        if (p && p.catch) p.catch(function (err) {
          // Autoplay policy: an unmuted play() without a gesture rejects, and
          // an element that never plays is stepped by seeks alone. Muted
          // playback is always allowed; the mute lifts when the viewer asks.
          if (!el.muted && err && err.name === 'NotAllowedError') {
            el.muted = true;
            el.__vosAutoMuted = true;
            var p2 = el.play();
            if (p2 && p2.catch) p2.catch(function () {});
          }
        });
      } else if (el.__vosAutoMuted && o.unlocked) {
        el.muted = false;
        el.__vosAutoMuted = false;
      }
      return true;
    } catch (e) { return true; }
  }
  ns.media = { v: 1, follow: follow };
})();
`
