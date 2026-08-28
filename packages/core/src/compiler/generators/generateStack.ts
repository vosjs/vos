import type { VosConfigJson } from '../../types'

/**
 * Generate the program stack (`config.stack`): more programs on the same
 * context, run after the main program in each phase, in array order, each
 * with its own `ctx.data` and its own error boundary.
 *
 * An entry is `{ id, data?, setup?, createContent?, onFrame? }` — the main
 * program's hooks minus `createTimeline`: one master clock, and an entry reads
 * it through `ctx.time` like anything else. Entries share `scene`,
 * `overlayScene`, `renderer`, `elements`, `objects` and the clock; they
 * compose, they do not nest.
 *
 * Each entry's context is `Object.create(context, { data })`: the prototype
 * keeps every live getter (`time`, `progress`, the main `data`) and the
 * derived object overrides `data` with the entry's own slot, so an entry
 * reads its own inputs with the same `ctx.data` it would anywhere else.
 *
 * A throwing entry is disabled for the session and reported through
 * `result.stack.onError`; the main program and the other entries keep
 * running. Error isolation is the point: a HUD that fails must not blank the
 * scene under it, and a scene that throws must not take its subtitles with it.
 */
export interface StackCodegen {
  /** Anything to emit? False leaves the artifact byte-identical to pre-stack. */
  present: boolean
  /** Some entry declares `setup` (the loaders registry + setup context are needed). */
  hasSetup: boolean
  /** Some entry declares `onFrame` (the render loop needs a delta clock). */
  hasFrame: boolean
  /** Declarations: the entry table, state, contexts, error reporting. */
  decls: string
  /** Mount: run each entry's setup + createContent (after the main content). */
  mount: string
  /** Live data for one entry (called by the instance's setData with a target). */
  setData: string
  /** Rebuild every live entry's content (after the main content rebuilt). */
  remount: string
  /** Dispose every entry's content (cleanup). */
  dispose: string
  /** The instance's `stack` API object literal. */
  api: string
}

const NONE: StackCodegen = {
  present: false,
  hasSetup: false,
  hasFrame: false,
  decls: '',
  mount: '',
  setData: '',
  remount: '',
  dispose: '',
  api: '',
}

export function generateStack(config: VosConfigJson): StackCodegen {
  const entries = config.stack ?? []
  if (!entries.length) return NONE
  const hasSetup = entries.some((e) => !!e.setup)
  const hasFrame = entries.some((e) => !!e.onFrame)

  const table = entries
    .map(
      (e) => `    {
      id: ${JSON.stringify(e.id)},
      setup: ${e.setup ?? 'null'},
      createContent: ${e.createContent ?? 'null'},
      onFrame: ${e.onFrame ?? 'null'},
      baked: ${JSON.stringify(e.data ?? {})},
    },`,
    )
    .join('\n')

  const decls = `
  // Program stack (config.stack): more programs on this context, after the
  // main one, each with its own ctx.data and error boundary. deps.stack[id]
  // overrides an entry's baked data the way deps.data overrides config.data.
  const __stackDefs = [
${table}
  ];
  const __stack = __stackDefs.map((def) => ({
    id: def.id,
    def,
    data: Object.freeze((deps && deps.stack && deps.stack[def.id]) ?? def.baked),
    ctx: null,
    setupData: undefined,
    content: null,
    ok: true,
    error: null,
  }));
  const __stackListeners = [];
  const __stackFail = (s, err) => {
    s.ok = false;
    s.error = String((err && err.message) || err);
    for (const cb of __stackListeners) { try { cb({ id: s.id, error: s.error }); } catch (e) {} }
  };
  // An entry's content lists the objects it added (\`objects\`), like the main
  // program's: that list is what a rebuild removes, since entries share the
  // scene and no sweep can tell whose child is whose.
  const __stackDisposeOne = (s) => {
    const c = s.content;
    s.content = null;
    if (!c) return;
    try { if (c.dispose) c.dispose(); } catch (e) {}
    const listed = Array.isArray(c.objects) ? c.objects : [];
    for (const obj of listed) { if (obj && obj.parent) obj.parent.remove(obj); }
  };
  const __stackCreate = (s) => {
    s.content = s.def.createContent ? s.def.createContent(s.ctx, s.setupData) : null;
  };
  const __stackFrame = (deltaTime) => {
    for (const s of __stack) {
      if (!s.ok || !s.def.onFrame) continue;
      try { s.def.onFrame(s.ctx, s.content, deltaTime); } catch (e) { __stackFail(s, e); }
    }
  };`

  const setupLine = hasSetup
    ? `
      if (s.def.setup) {
        s.setupData = await s.def.setup(Object.create(setupContext, { data: { get: () => s.data, enumerable: true } }));
      }`
    : ''

  const mount = `
  // Mount the stack after the main content, before layer assignment, so an
  // entry's zIndexed objects land in render groups like the main program's.
  for (const s of __stack) {
    try {${setupLine}
      s.ctx = Object.create(context, { data: { get: () => s.data, enumerable: true } });
      __stackCreate(s);
    } catch (e) { __stackFail(s, e); }
  }`

  const setData = `
  // Live data for one entry: the same three rungs as the main program —
  // content.onData, else an onFrame entry reads next frame, else rebuild.
  const __stackSetData = (id, next) => {
    const s = __stack.find((x) => x.id === id);
    if (!s) return;
    s.data = Object.freeze(next ?? {});
    if (!s.ok) return;
    try {
      if (s.content && typeof s.content.onData === 'function') { s.content.onData(s.data); return; }
      if (s.def.onFrame) return;
      __stackDisposeOne(s);
      __stackCreate(s);
    } catch (e) { __stackFail(s, e); }
  };`

  const remount = `
    // The sweep above removed every entry's objects with the main content's;
    // re-create the live entries in place (failed ones stay failed).
    for (const s of __stack) {
      if (!s.ok) continue;
      try { __stackDisposeOne(s); __stackCreate(s); } catch (e) { __stackFail(s, e); }
    }`

  const dispose = `
      for (const s of __stack) __stackDisposeOne(s);`

  const api = `
    stack: {
      ids: __stack.map((s) => s.id),
      state: () => __stack.map((s) => ({ id: s.id, ok: s.ok, error: s.error })),
      onError: (cb) => {
        __stackListeners.push(cb);
        return () => { const i = __stackListeners.indexOf(cb); if (i >= 0) __stackListeners.splice(i, 1); };
      },
    },`

  return {
    present: true,
    hasSetup,
    hasFrame,
    decls,
    mount,
    setData,
    remount,
    dispose,
    api,
  }
}
