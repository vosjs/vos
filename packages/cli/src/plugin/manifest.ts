/**
 * The verb manifest of the take pipeline and the vos.so verbs — what
 * `vos help` lists under the engine verbs. It kept the shape a separately
 * installed plugin once handed the host (name + host range), so a script
 * reading it keeps working.
 */
export interface PluginVerb {
  name: string
  summary: string
}

export interface PluginManifest {
  name: string
  /** Host versions this plugin speaks the run(argv) contract with. */
  hostRange: string
  verbs: PluginVerb[]
}

export const manifest: PluginManifest = {
  name: '@vosjs/cli',
  hostRange: '>=0.9.0',
  verbs: [
    {
      name: 'create',
      summary: 'record + auto-plan + render, one command (--strict)',
    },
    {
      name: 'record',
      summary: 'drive actions.json into a take (screencast + cursor track)',
    },
    {
      name: 'plan',
      summary:
        'plan zoom/cursor effects into doc.json (wand contract); --reuse re-times a previous cut onto a re-recording',
    },
    {
      name: 'render',
      summary: 'render a take directory (engine configs render in the host)',
    },
    {
      name: 'frames',
      summary:
        'PNG stills at output times / zoom apexes / moments / exact sizes',
    },
    {
      name: 'deliver',
      summary:
        'render a take to release destinations (CWS, Product Hunt, X, LinkedIn, OG…) + verified kit.json',
    },
    {
      name: 'digest',
      summary:
        'see a recording before cutting it: moments (clicks, typing, scrolls, idle, scenes) + footage frames + crops, in doc units',
    },
    { name: 'open', summary: 'serve the take into the vos.so studio' },
    {
      name: 'validate',
      summary:
        'lint actions.json, a take dir (doc.json semantics), or re-measure a kit.json against the channel specs',
    },
    {
      name: 'brand',
      summary:
        "write a product's BRAND.md, witnessed: /design.md, /llms.txt, then the page (palette, faces, marks, the avoid list)",
    },
    {
      name: 'fetch',
      summary: 'download a hosted program: config.json + vos.json tracking',
    },
    {
      name: 'push',
      summary: 'push a config.json or take to vos.so (private; versioned)',
    },
    {
      name: 'duplicate',
      summary:
        'a private sibling of your OWN vos (someone else\u2019s is remixed: fetch + push --remix-of)',
    },
    {
      name: 'pull',
      summary:
        'sync what changed on vos.so since your base (--media brings a take’s footage home)',
    },
    {
      name: 'folder',
      summary:
        'list/create/pull folders, move voses and assets into them (pull = the context package on disk)',
    },
    {
      name: 'asset',
      summary: 'rename one of your assets in place (recipes included)',
    },
    {
      name: 'recipe',
      summary:
        'push a recipe .md into a folder, or replace one in place (prior body kept)',
    },
    {
      name: 'login',
      summary: 'sign in via the browser (or --key); stores a content key',
    },
  ],
}
