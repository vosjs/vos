/**
 * The house starters for an HTML layer: what one press of the studio's HTML
 * verb puts on the canvas, and what its panel's Starter select swaps in.
 * Product defaults the way the three text presets are (code, not shelf
 * data), five and not fifty: a LIBRARY of components is an official project
 * on the shelf that an agent applies as a template.
 *
 * Each is real, readable markup and CSS a person can retune, in the house
 * look (a dark card, Inter for words, JetBrains Mono for code, both hosted so
 * the faces resolve from the CSS alone), with a `box-shadow` so the derived
 * bleed is exercised. `htmlStarters.test.ts` proves every one passes the
 * gate with no problem and no warning.
 */
import type { HtmlOverlayClip } from './types'

export interface HtmlStarter {
  id: 'callout' | 'code' | 'terminal' | 'keys' | 'badge'
  name: string
  html: string
  css: string
  box: { width: number; height: number }
}

const WORDS =
  "font-family:'Inter',-apple-system,system-ui,sans-serif;color:#fafafa;-webkit-font-smoothing:antialiased;"
const MONO = "font-family:'JetBrains Mono',ui-monospace,monospace;"
const CARD =
  'background:#0b0b0d;border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.45);'

export const HTML_STARTERS: readonly HtmlStarter[] = [
  {
    id: 'callout',
    name: 'Callout',
    box: { width: 420, height: 132 },
    html:
      '<div class="callout">' +
      '<div class="head"><span class="dot"></span><span class="title">Title</span></div>' +
      '<div class="body">One line that says what this is.</div>' +
      '</div>',
    css:
      `.callout{${WORDS}${CARD}box-sizing:border-box;width:420px;height:132px;padding:22px 24px}` +
      '.head{display:flex;align-items:center;gap:10px}' +
      '.dot{width:8px;height:8px;border-radius:99px;background:#4ade80;box-shadow:0 0 10px rgba(74,222,128,.9)}' +
      '.title{font-size:20px;font-weight:600;letter-spacing:-0.01em}' +
      '.body{margin-top:12px;font-size:15px;line-height:1.5;color:#8b8b94}',
  },
  {
    id: 'code',
    name: 'Code',
    box: { width: 460, height: 168 },
    html:
      '<div class="code"><span class="mut">// button.tsx</span>\n' +
      '<span class="kw">export function</span> <span class="fn">Button</span>({ variant }) {\n' +
      '  <span class="kw">return</span> <span class="tag">&lt;button</span> className={<span class="fn">cn</span>(variant)} <span class="tag">/&gt;</span>\n' +
      '}</div>',
    css:
      `.code{${MONO}${CARD}color:#e8e8ec;box-sizing:border-box;width:460px;height:168px;padding:22px 24px;font-size:14px;line-height:1.8;white-space:pre;letter-spacing:-0.01em}` +
      '.kw{color:#c4b5fd}.fn{color:#7dd3fc}.tag{color:#f0abfc}.mut{color:#5b5b66}',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    box: { width: 460, height: 152 },
    html:
      '<div class="term"><span class="prompt">$</span> <span class="cmd">npx vos record https://your.app</span>\n' +
      '<span class="mut">recording 1920x1080 at 30 fps</span>\n' +
      '<span class="mut">saved take/</span></div>',
    css:
      `.term{${MONO}${CARD}background:#08080a;color:#e8e8ec;box-sizing:border-box;width:460px;height:152px;padding:22px 24px;font-size:14px;line-height:1.8;white-space:pre}` +
      '.prompt{color:#4ade80}.mut{color:#5b5b66}',
  },
  {
    id: 'keys',
    name: 'Keys',
    box: { width: 220, height: 64 },
    html: '<div class="keys"><kbd>&#8984;</kbd><span class="plus">+</span><kbd>K</kbd></div>',
    css:
      `.keys{${WORDS}display:flex;align-items:center;justify-content:center;gap:10px;width:220px;height:64px}` +
      'kbd{display:inline-flex;align-items:center;justify-content:center;min-width:48px;height:48px;padding:0 14px;border-radius:10px;background:#1a1a1f;border:1px solid rgba(255,255,255,.14);border-bottom-width:3px;box-shadow:0 10px 24px rgba(0,0,0,.4);font-size:22px;font-weight:600}' +
      '.plus{color:#8b8b94;font-size:18px}',
  },
  {
    id: 'badge',
    name: 'Badge',
    box: { width: 200, height: 52 },
    html: '<div class="badge"><span class="dot"></span>New in 2.0</div>',
    css:
      `.badge{${WORDS}display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 20px;border-radius:99px;background:#1a1a1f;border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 30px rgba(0,0,0,.4);font-size:16px;font-weight:600;letter-spacing:-0.01em}` +
      '.dot{width:8px;height:8px;border-radius:99px;background:#3b82f6;box-shadow:0 0 10px rgba(59,130,246,.9)}',
  },
]

/**
 * A starter as a clip at a moment: the studio's verb and the panel's Starter
 * select both call this, so what a press creates and what a swap replaces
 * are one shape. `bleed` is left absent (derived), `width` absent (the
 * design size), the transform centred.
 */
export function htmlStarterClip(
  starter: HtmlStarter,
  id: string,
  start: number,
  duration: number,
): HtmlOverlayClip {
  return {
    id,
    kind: 'html',
    html: starter.html,
    css: starter.css,
    box: { ...starter.box },
    start,
    duration,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  }
}
