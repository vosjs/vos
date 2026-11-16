import { MEDIABUNNY_VERSION } from '../addons/cdn'

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
 *
 * THE PICTURE MAY COME FROM A DECODER. An element cannot always show what
 * its clock says: above 1× Chrome's stops near 13× and Safari's presents a
 * few frames a second, and a seek that is dear holds the picture for as
 * long as it takes. So a caller that draws the element onto a canvas may
 * say `picture: true` and draw through
 *
 *   media.draw(el, ctx2d, crop, dx, dy, dw, dh, at)   // false: draw `el`
 *
 * and, where the host switched it on (`window.__vos__.mediaDecoder`), a
 * WebCodecs decoder walks the same file and supplies the frame:
 *
 *   - ABOVE 1×, while its measured capacity covers the rate. It falls back
 *     to the element, for good at that rate, once it has trailed the
 *     allowance for longer than a catch-up takes;
 *   - OVER A HAND-BACK: after a fast piece, and after a cut where the
 *     element's own seek is dear, until the element is playing on the
 *     clock again.
 *
 * Never at plain 1×, never for sound, and never on a paused frame except
 * to hold the last picture while the element is still seeking to it. The
 * element stays the dimension source and the fallback at every step: a
 * file the decoder cannot open (a WebM in Safari) is the element's, as
 * before. An element whose caller says `silent: true` RESTS while the
 * decoder serves a fast piece (paused, parked at the piece's end, where
 * the next piece usually begins), so one decoder runs, not two.
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
  /**
   * This caller draws the element through `media.draw`, so the picture may
   * be a decoder's where the host switched that on.
   */
  picture?: boolean
  /**
   * The media carries no sound that should be heard, so the element may
   * rest while a decoder supplies the picture.
   */
  silent?: boolean
  /**
   * The caller knows a fast piece is coming (the document has one), so the
   * decoder may open the file ahead of it. Nothing is decoded until it is
   * the picture.
   */
  warm?: boolean
  /**
   * The piece after this one, for the same element: where it starts in the
   * source, its rate, and how many output seconds away it is. When the
   * decoder will be its picture (a fast piece, or a cut the element is
   * slow to make), it finds that frame in the last 0.3 s before it, so the
   * piece opens on its own first frame.
   */
  next?: { at: number; rate?: number; in: number } | null
}

/** A crop in the media's own pixels. */
export interface MediaCrop {
  x: number
  y: number
  w: number
  h: number
}

/** `window.__vos__.media`, as a program reads it. */
export interface VosMedia {
  /** The contract's version: 1. */
  v: number
  /** False when another caller leads this element and the call was ignored. */
  follow: (el: HTMLMediaElement, target: MediaFollowTarget) => boolean
  /**
   * Draw the picture a decoder holds for `el` at source second `at` (the
   * `at` this frame's `follow` was given, or the paused frame's moment).
   * False when the element is the picture: the caller draws it.
   */
  draw: (
    el: HTMLMediaElement,
    ctx: CanvasRenderingContext2D,
    crop: MediaCrop | null,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    at: number,
  ) => boolean
}

/**
 * What the decoder is read through: a host or a test may supply its own at
 * `window.__vos__.mediaSink` (the default opens the element's file with
 * mediabunny). `samples(t)` yields the frame holding `t` and those after
 * it; `keyAt(t)` is the timestamp of the keyframe at or before `t`.
 */
export interface MediaSink {
  samples: (t: number) => AsyncIterator<MediaSinkSample>
  keyAt: (t: number) => Promise<number | null>
}
export interface MediaSinkSample {
  timestamp: number
  duration: number
  draw: (ctx: CanvasRenderingContext2D, ...rect: Array<number>) => void
  close: () => void
}

/**
 * The follower's source: a script that installs `window.__vos__.media`. It
 * reads `window.__vos__.transport` (the player's speed, the clock's jumps)
 * when the document has one. Plain ES5 on purpose: it is inlined into a
 * page and evaluated by tests.
 */
const DEFAULT_MEDIABUNNY_URL = `https://esm.sh/mediabunny@${MEDIABUNNY_VERSION}?target=es2022`

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
  // ------------------------------------------------------------------
  // THE PICTURE FROM A DECODER (the host's switch: ns.mediaDecoder).
  // Output seconds the decoder's frame may trail the clock and still be
  // the better picture: the element's own allowance above 1×.
  var PIC_ALLOW = 0.3;
  // How long it may trail that, in time spent playing (a frame that took
  // long, a tab that slept, counts as one frame), before the element takes
  // the rate back.
  var PIC_BEHIND_MS = 1000;
  // How long the decoder covers a hand-back before the element is taken
  // as it is.
  var PIC_COVER_MS = 2000;
  // An idle walk is let go after this long: its frames are GPU memory.
  var PIC_IDLE_MS = 3000;
  function closeSample(s) { if (s) { try { s.close(); } catch (e) {} } }
  // The element's own file, read in ranges (or the blob it already holds).
  function openSink(el) {
    var url = (ns.modules && ns.modules.mediabunny) || '${DEFAULT_MEDIABUNNY_URL}';
    return import(url).then(function (MB) {
      var src = el.currentSrc || el.src || '';
      var source = src.indexOf('blob:') === 0
        ? fetch(src).then(function (r) { return r.blob(); }).then(function (b) { return new MB.BlobSource(b); })
        : Promise.resolve(new MB.UrlSource(src));
      return source.then(function (from) {
        var input = new MB.Input({ formats: MB.ALL_FORMATS, source: from });
        var fail = function () { try { input.dispose(); } catch (e) {} return null; };
        return input.getPrimaryVideoTrack().then(function (track) {
          if (!track) return fail();
          // The frame must be drop-in for the element at the draw site (a
          // crop is in the element's pixels): rotation metadata or an
          // anamorphic track keeps the element.
          if (el.videoWidth && (track.displayWidth !== el.videoWidth || track.displayHeight !== el.videoHeight)) return fail();
          return track.canDecode().then(function (can) {
            if (!can) return fail();
            var frames = new MB.VideoSampleSink(track);
            var packets = new MB.EncodedPacketSink(track);
            return {
              samples: function (t) { return frames.samples(t); },
              keyAt: function (t) {
                return packets.getKeyPacket(t, { metadataOnly: true }).then(function (k) { return k ? k.timestamp : null; });
              }
            };
          }, fail);
        }, fail);
      });
    });
  }
  function picOf(st) {
    return st.pic || (st.pic = {
      // 0 unopened, 1 opening, 2 open, -1 this file is the element's.
      state: 0, sink: null, iter: null, cur: null, pre: null, gen: 0, walking: -1,
      at: null, wall: 1, dt: 0, hop: 0, w0: 0, s0: 0,
      // meas: source seconds a wall second it decodes when flat out. cap:
      // the rate it was FOUND unable to hold (Infinity: none), after a
      // second of trailing the clock at it.
      meas: 0, cap: Infinity, behind: 0, last: 0,
      fast: false, cover: 0, nudge: 0, nudges: 0, rest: false, parked: undefined,
      piece: undefined, epoch: undefined,
      use: false, held: false, seen: undefined, fresh: false, used: 0, timer: 0
    });
  }
  function endIter(it) {
    if (it && it.return) { try { var r = it.return(); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
  }
  // THE WALK AHEAD: a second walk, begun shortly before a piece the decoder
  // will serve, that finds the piece's first frame and holds it. When the
  // playhead arrives it BECOMES the walk, so a cut into a fast piece (or
  // between two) shows its first frame on the frame of the cut.
  function dropAhead(pic) {
    var p = pic.pre;
    if (!p) return;
    pic.pre = null;
    endIter(p.iter);
    closeSample(p.cur);
  }
  function ahead(pic, t) {
    if (pic.pre && pic.pre.at === t) return;
    dropAhead(pic);
    var p = pic.pre = { at: t, iter: pic.sink.samples(t), cur: null };
    p.iter.next().then(function (nx) {
      var v = nx && !nx.done ? nx.value : null;
      if (pic.pre !== p) return closeSample(v);
      p.cur = v || null;
    }, function () { if (pic.pre === p) pic.pre = null; });
  }
  function letGo(pic) {
    pic.gen++;
    endIter(pic.iter);
    pic.iter = null;
    closeSample(pic.cur);
    dropAhead(pic);
    pic.cur = null; pic.use = false; pic.held = false; pic.w0 = 0;
    if (pic.timer) { clearInterval(pic.timer); pic.timer = 0; }
  }
  // THE WALK: one loop per element, and THE LATEST REQUEST WINS. It reads
  // pic.at afresh before every frame it decodes, so a request made while
  // it was busy is never queued behind the ones before it.
  function walk(pic) {
    if (pic.walking === pic.gen || pic.state !== 2) return;
    var gen = pic.walking = pic.gen;
    var done = function () { if (pic.walking === gen) pic.walking = -1; };
    var take = function (s) {
      var now = performance.now();
      // WHAT IT CAN DO: source seconds a second, measured only while the
      // walk is flat out (it has not caught the clock for a quarter
      // second) and alone (a walk ahead shares the decoder). It is not a
      // verdict: that takes a second of trailing the clock (follow).
      if (pic.pre) pic.w0 = 0;
      else if (pic.w0 && s.timestamp > pic.s0) {
        if (now - pic.w0 >= 250) {
          var c = (s.timestamp - pic.s0) / ((now - pic.w0) / 1000);
          pic.meas = pic.meas ? pic.meas * 0.5 + c * 0.5 : c;
          pic.w0 = now; pic.s0 = s.timestamp;
        }
      } else { pic.w0 = now; pic.s0 = s.timestamp; }
      if (pic.cur !== s) closeSample(pic.cur);
      pic.cur = s;
    };
    var from = function (t) {
      endIter(pic.iter);
      pic.iter = pic.sink.samples(t);
      pic.w0 = 0;
    };
    // A walk that throws (a file gone bad under it) ends as a file the
    // decoder cannot read: never as a walk that is busy for ever.
    var bad = function () { pic.state = -1; done(); };
    var next = function () {
      try { step(); } catch (e) { bad(); }
    };
    var step = function () {
      if (gen !== pic.gen) return done();
      var t = pic.at, cur = pic.cur;
      if (t == null) return done();
      // It holds the frame that contains t: nothing to do, and not flat out.
      if (cur && cur.timestamp <= t + 0.001 && cur.timestamp + cur.duration > t) { pic.w0 = 0; return done(); }
      var pull = function () {
        pic.iter.next().then(function (nx) {
          if (gen !== pic.gen) { if (nx && nx.value) closeSample(nx.value); return done(); }
          if (!nx || nx.done || !nx.value) { pic.w0 = 0; return done(); }
          take(nx.value);
          next();
        }, bad);
      };
      // Behind the frame it holds (the clock went back), or nothing yet.
      if (!pic.iter || !cur || t < cur.timestamp - 0.001) { from(t); return pull(); }
      // THE CATCH-UP: trailing by more than the allowance, it steps to the
      // keyframe under the clock when there is one ahead of where it is.
      var gap = t - (cur.timestamp + cur.duration);
      var now = performance.now();
      if (gap > Math.max(1, PIC_ALLOW * pic.wall) && now - pic.hop > 250) {
        pic.hop = now;
        return pic.sink.keyAt(t).then(function (key) {
          if (gen !== pic.gen) return done();
          var c2 = pic.cur;
          try {
            if (key != null && c2 && key > c2.timestamp + c2.duration) from(pic.at != null ? Math.max(key, pic.at) : key);
            pull();
          } catch (e) { bad(); }
        }, function () { try { pull(); } catch (e) { bad(); } });
      }
      pull();
    };
    next();
  }
  function pump(pic, el) {
    if (pic.state === 0) {
      pic.state = 1;
      var open = ns.mediaSink || openSink;
      Promise.resolve().then(function () { return open(el); }).then(
        function (sink) { pic.sink = sink || null; pic.state = sink ? 2 : -1; },
        function () { pic.state = -1; }
      );
      return;
    }
    if (pic.state !== 2 || pic.at == null) return;
    if (!pic.timer) pic.timer = setInterval(function () {
      if (performance.now() - pic.used > PIC_IDLE_MS && pic.walking !== pic.gen) letGo(pic);
    }, 1000);
    walk(pic);
  }
  function draw(el, c, crop, dx, dy, dw, dh, at) {
    try {
      var st = el.__vosFollow, pic = st && st.pic;
      if (!pic || !pic.cur) return false;
      if (pic.fresh && pic.seen === at && performance.now() - pic.last < 250) {
        // Followed this frame: follow decided whose picture it is. One
        // draw a follow: a frame paused on the very moment last followed
        // is a paused frame.
        pic.fresh = false;
        if (!pic.use) return false;
      } else {
        // A paused frame is the element's. The decoder's last picture
        // stands in only while the element is still seeking to it.
        if (!pic.held) return false;
        if (!(el.seeking || el.readyState < 2)) { pic.held = false; return false; }
      }
      if (crop) pic.cur.draw(c, crop.x, crop.y, crop.w, crop.h, dx, dy, dw, dh);
      else pic.cur.draw(c, dx, dy, dw, dh);
      return true;
    } catch (e) { return false; }
  }

  function follow(el, o) {
    try {
      var now = performance.now();
      var st = stateOf(el);
      // One owner: a caller that does not lead stands back while one does.
      if (o.lead) st.lead = now;
      else {
        st.other = now;
        if (st.lead && now - st.lead < 100) return false;
      }

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

      // WHOSE PICTURE. Decided before the element is touched, since an
      // element that rests is not stepped, played or re-rated.
      var pic = st.pic, resting = false;
      try {
      if (o.picture && !loop && ns.mediaDecoder && window.VideoDecoder && (pic || (pic = picOf(st))).state >= 0) {
        var pcut = pic.piece !== o.piece || pic.epoch !== epoch;
        pic.piece = o.piece; pic.epoch = epoch; pic.seen = at; pic.fresh = true;
        var fast = wall > 1.001 && wall < pic.cap;
        var since = pic.last ? Math.min(50, now - pic.last) : 16.7;
        pic.last = now;
        // What a frame takes here: a frame asked for now is drawn one later.
        pic.dt = pic.dt ? pic.dt * 0.8 + since * 0.2 : since;
        if (o.warm && pic.state === 0) pump(pic, el);
        // Leaving a fast piece, and a cut where the element's own seek is
        // dear: the decoder covers until the element is on the clock again.
        if ((pic.fast && !fast) || (!fast && pcut && cost > 0.15)) { pic.cover = now; pic.nudges = 0; pic.nudge = now; }
        pic.fast = fast;
        if (pic.cover && !fast) {
          // Back: playing, not seeking, and near enough the clock that
          // handing the picture over is not a visible step. A silent
          // element is held to a tenth of a second and, while the decoder
          // covers for it, stepped again when it landed outside that (a
          // seek costs nothing anyone sees here); one with sound is taken
          // inside its allowance, since a step is heard.
          var near = o.silent === true ? 0.1 * wall : allow;
          var away = off(el.currentTime);
          var back = !el.seeking && !el.paused && away <= near;
          if (back || now - pic.cover > PIC_COVER_MS) pic.cover = 0;
          else if (o.silent === true && !el.seeking && !el.paused && away > near && pic.nudges < 3 && now - pic.nudge > 300) {
            pic.nudge = now; pic.nudges++;
            step(false);
          }
        }
        // WHAT COMES NEXT, when the caller says: in the last 0.3 s before a
        // piece the decoder will serve and cannot simply walk into (a cut,
        // or a fast piece after one that is the element's), the walk ahead
        // finds its first frame.
        var nx = o.next, pre = pic.pre;
        if (nx && nx.in >= 0 && nx.in < 0.3 && pic.state === 2) {
          var nwall = (nx.rate > 0 ? nx.rate : 1) * speed;
          var nfast = nwall > 1.001 && nwall < pic.cap;
          var ncut = Math.abs(nx.at - end) > 0.05;
          if (nfast ? ncut || !fast : ncut && cost > 0.15) {
            pic.used = now;
            ahead(pic, nx.at);
            pre = pic.pre;
          }
        }
        if (pre) {
          // The playhead is in the piece it was found for: it is the walk.
          var mine = at >= pre.at - 0.001 && at - pre.at <= wall;
          if (mine && pre.cur && (fast || pic.cover)) {
            pic.gen++;
            endIter(pic.iter);
            closeSample(pic.cur);
            pic.iter = pre.iter; pic.cur = pre.cur; pic.pre = null; pic.w0 = 0;
          } else if (!mine && !(nx && nx.at === pre.at)) dropAhead(pic);
        }
        if (fast || pic.cover) {
          // A cover at a rate it was found unable to hold decodes nothing:
          // it only holds its last picture while the element comes back.
          var walks = fast || wall < pic.cap;
          if (walks) {
            // Asked for where the clock will be when it is drawn, the next
            // frame, and never past the piece.
            pic.at = Math.min(at + wall * pic.dt / 1000, Math.max(at, end - 0.001));
            pic.wall = wall; pic.used = now;
            pump(pic, el);
          } else pic.at = null;
          var cur = pic.cur, ok = false;
          if (cur) {
            // Output seconds the frame trails the clock (0 or less: it is
            // the frame), and leads it (a walk not yet turned back).
            var lag = (at - (cur.timestamp + cur.duration)) / wall;
            ok = lag <= PIC_ALLOW && (cur.timestamp - at) / wall <= 0.1;
            if (fast && lag > PIC_ALLOW) {
              pic.behind += since;
              if (pic.behind > PIC_BEHIND_MS) {
                // It cannot hold this rate here: the element's from now
                // on, at this rate and above, and down to what it was
                // measured to do when that is lower still.
                pic.cap = Math.min(pic.cap, wall, pic.meas > 0 ? Math.max(pic.meas, 1.001) : wall);
                pic.behind = 0;
              }
            } else pic.behind = 0;
          }
          // A resting element has no picture of its own to fall back on.
          pic.use = ok || (!!cur && (walks ? pic.rest && fast : true));
        } else {
          pic.at = null; pic.use = false; pic.behind = 0;
        }
        pic.held = pic.use;
        // THE REST: a silent element under a decoder that holds a fast
        // piece is paused and parked at the piece's end, once, so it is
        // already there when the next piece starts from it.
        var rest = fast && pic.use && o.silent === true && !(st.other && now - st.other < 100);
        if (rest) {
          pic.rest = true;
          if (!el.paused) el.pause();
          var park = Math.min(end, (el.duration || Infinity) - 0.05);
          if (pic.parked !== o.piece && isFinite(park) && !el.seeking) {
            pic.parked = o.piece;
            if (Math.abs(el.currentTime - park) > 0.02) { st.at = 0; el.currentTime = park; }
          }
          resting = true;
        }
        if (!resting) { pic.rest = false; pic.parked = undefined; }
      } else if (pic) {
        // Not asked, switched off, or a file that is the element's: nothing
        // of the decoder's is kept.
        if (pic.cur || pic.iter || pic.pre) letGo(pic);
        pic.at = null; pic.use = false; pic.held = false; pic.fresh = false; pic.rest = false; pic.fast = false; pic.cover = 0;
      }
      } catch (e) {
        // A decoder that faults is never the reason an element is not
        // driven: the file is the element's from here on.
        resting = false;
        if (st.pic) {
          try { letGo(st.pic); } catch (e2) {}
          st.pic.state = -1; st.pic.use = false; st.pic.held = false; st.pic.rest = false; st.pic.fast = false; st.pic.cover = 0;
        }
      }
      if (resting) return true;

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
  ns.media = { v: 1, follow: follow, draw: draw };
})();
`
