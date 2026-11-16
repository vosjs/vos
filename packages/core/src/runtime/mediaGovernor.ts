/**
 * THE MEDIA GOVERNOR: the same rule as the follower (./mediaFollower.ts),
 * for a program that was stored before there was one and will never call
 * it. Such a program keeps its media on the clock by assigning
 * `currentTime` whenever the element has drifted, with no thought for a
 * seek already in flight: at a fast rate that is an assignment on every
 * frame, each one aborting the seek before it, and the picture stops.
 *
 * The program is not changed and does not cooperate. The playback document
 * stands between it and the element: of the program's assignments, it
 * decides which become seeks.
 *
 *   - ONE SEEK IN FLIGHT. An assignment while the element is seeking is
 *     dropped, unless it asks for somewhere far from where the seek is
 *     going (a cut: the governor cannot see pieces, only the size of a
 *     jump).
 *   - THE ALLOWANCE IS OUTPUT TIME, AND NEVER UNDER THE COST: 0.3 output
 *     seconds for a sped-up element, 0.12 source seconds slowed, 0.3 at
 *     1×, and at least what one seek measurably costs here. An assignment
 *     inside it is dropped.
 *   - A SEEK IS AIMED WHERE THE PLAYHEAD WILL BE WHEN IT LANDS, by the
 *     element's own measured seek time, and never onto its last 0.05 s.
 *
 * What it leaves alone, by construction:
 *
 *   - a PAUSED element: the paused frame, a scrub and every capture pass
 *     straight through, so no picture a program draws can change;
 *   - an element that carries a rule of its own (`__vosFollow`, the
 *     follower's state; `__vosSv`, a lowering's inline copy);
 *   - any element that is not a lowered take's media
 *     (`window.__vos__.videoCache`): a program that seeks its own video on
 *     purpose still can.
 */

/**
 * The governor's source: a script for the playback document. It replaces
 * the `currentTime` setter on `HTMLMediaElement.prototype` with one that
 * passes everything through except what the header describes. Plain ES5.
 */
export const MEDIA_GOVERNOR_SRC = `
(function () {
  var M = window.HTMLMediaElement;
  if (!M || !M.prototype) return;
  var desc = Object.getOwnPropertyDescriptor(M.prototype, 'currentTime');
  if (!desc || !desc.set || !desc.configurable) return;
  var ns = window.__vos__ = window.__vos__ || {};
  // Is this element a stored take's media, with no rule of its own?
  function governed(el) {
    if (el.__vosFollow || el.__vosSv) return false;
    var cache = ns.videoCache;
    if (!cache || typeof cache.forEach !== 'function') return false;
    var found = false;
    cache.forEach(function (v) { if (v === el) found = true; });
    return found;
  }
  function stateOf(el) {
    var g = el.__vosGov;
    if (!g) {
      // cost < 0: no seek measured yet, so the first one is aimed at what was asked.
      g = el.__vosGov = { cost: -1, at: 0, to: 0, asked: 0, passed: 0 };
      if (el.addEventListener) el.addEventListener('seeked', function () {
        if (!g.at) return;
        var took = Math.min(2, (performance.now() - g.at) / 1000);
        g.cost = g.cost < 0 ? took : g.cost * 0.3 + took * 0.7;
        g.at = 0;
      });
    }
    return g;
  }
  Object.defineProperty(M.prototype, 'currentTime', {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set: function (x) {
      var el = this;
      try {
        // The paused step and every capture: untouched.
        if (el.paused || !governed(el)) return desc.set.call(el, x);
        var g = stateOf(el);
        g.asked++;
        var r = el.playbackRate > 0 ? el.playbackRate : 1;
        var cost = Math.max(0, g.cost);
        var allow = Math.max(r > 1 ? 0.3 * r : r < 1 ? 0.12 : 0.3, cost * r);
        if (el.seeking) {
          // One seek in flight, unless the target has moved far: a cut.
          if (Math.abs(x - g.to) <= allow + 2 * Math.max(1, r)) return;
        } else if (Math.abs(x - desc.get.call(el)) <= allow) {
          return;
        }
        var end = el.duration > 0 ? el.duration : Infinity;
        var to = Math.min(x + r * cost, Math.max(x, end - 0.05));
        g.at = performance.now();
        g.to = to;
        g.passed++;
        return desc.set.call(el, to);
      } catch (e) {
        return desc.set.call(el, x);
      }
    }
  });
  ns.mediaGovernor = { v: 1 };
})();
`
