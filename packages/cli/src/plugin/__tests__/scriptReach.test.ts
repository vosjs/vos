import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageError } from '../args'
import {
  envFlagProblem,
  grantReach,
  grantScriptEnv,
  grantStatePaths,
  jsSteps,
  jsStepsProblem,
  peerStatePath,
  scriptEnv,
  scriptedDesktopProblem,
  ungrantedEnvProblem,
} from '../scriptReach'
import { ownHost, saveNameOk } from '../server'

afterEach(() => {
  grantScriptEnv([])
  grantStatePaths([])
})

describe('a script never chooses the app it drives', () => {
  const nobody = { apps: [], byWindow: false }

  it('a page script asks nothing of the desktop', () => {
    expect(scriptedDesktopProblem({}, nobody, 'a.json')).toBeNull()
    expect(scriptedDesktopProblem({ app: '  ' }, nobody, 'a.json')).toBeNull()
  })

  it('a script that names an app is refused until the person names it', () => {
    const problem = scriptedDesktopProblem(
      { app: 'Terminal' },
      nobody,
      'a.json',
    )
    expect(problem).toContain('drives Terminal on your desktop')
    // The refusal is the command that grants it.
    expect(problem).toContain('vos record --app "Terminal" --actions a.json')
  })

  it('runs once the person names an app: which one is then theirs', () => {
    for (const named of ['Terminal', 'terminal', 'Notes'])
      expect(
        scriptedDesktopProblem(
          { app: 'Terminal' },
          { apps: [named], byWindow: false },
          'a.json',
        ),
      ).toBeNull()
  })

  it('a stage says every app it would drive, and the command that names them', () => {
    const stage = { apps: ['Notes', 'Terminal', 'Safari'] }
    const problem = scriptedDesktopProblem(stage, nobody, 's.json')
    expect(problem).toContain('drives 3 apps')
    expect(problem).toContain(
      '--app "Notes" --app "Terminal" --app "Safari" --actions s.json',
    )
    // Named, the stage's own check decides whether the names are its apps.
    expect(
      scriptedDesktopProblem(
        stage,
        { apps: ['Notes'], byWindow: false },
        's.json',
      ),
    ).toBeNull()
  })

  it('a window or a process pointed at by hand settles it', () => {
    expect(
      scriptedDesktopProblem(
        { app: 'Terminal' },
        { apps: [], byWindow: true },
        'a.json',
      ),
    ).toBeNull()
  })
})

describe('a script reads only the shell variables it is handed', () => {
  it('names what it wanted and the flags that grant it', () => {
    const problem = ungrantedEnvProblem(
      ['DEMO_PASSWORD', 'AWS_SECRET_ACCESS_KEY'],
      ['DEMO_PASSWORD'],
      'a.json',
    )
    expect(problem).toContain('AWS_SECRET_ACCESS_KEY')
    expect(problem).not.toContain('--env DEMO_PASSWORD')
    expect(problem).toContain('--env AWS_SECRET_ACCESS_KEY')
    expect(ungrantedEnvProblem(['A'], ['A', 'B'], 'a.json')).toBeNull()
    expect(ungrantedEnvProblem([], [], 'a.json')).toBeNull()
  })

  it('takes a name, never a value', () => {
    expect(envFlagProblem(['DEMO_PASSWORD', 'API_KEY2'])).toBeNull()
    const problem = envFlagProblem(['TOKEN=hunter2'])
    expect(problem).toContain('"TOKEN"')
    // The value a person typed by mistake is not echoed back.
    expect(problem).not.toContain('hunter2')
  })

  it('hands a script nothing until a name is granted', () => {
    const shell = {
      DEMO_PASSWORD: 'pw',
      HOME: '/h',
      AWS_SECRET_ACCESS_KEY: 's',
    }
    expect(scriptEnv(shell)).toEqual({})
    grantScriptEnv(['DEMO_PASSWORD'])
    expect(scriptEnv(shell)).toEqual({ DEMO_PASSWORD: 'pw' })
    // A granted name the shell does not hold is absent, not invented.
    grantScriptEnv(['MISSING'])
    expect(scriptEnv(shell)).toEqual({ MISSING: undefined })
  })
})

describe('a script runs code in the page only on the person’s word', () => {
  const walk = {
    steps: [
      { do: 'click' },
      { do: 'expect', js: 'document.cookie' },
      { do: 'await', until: { js: 'window.ready' } },
      { do: 'expect', selector: '#done' },
      { do: 'await', until: { text: 'Saved' } },
    ],
  }

  it('finds the js checks, and only those', () => {
    expect(jsSteps(walk)).toEqual([1, 2])
    expect(jsSteps({ steps: [{ do: 'click' }] })).toEqual([])
  })

  it('refuses them, saying what the code can reach and how to allow it', () => {
    const problem = jsStepsProblem(walk, false, 'a.json')
    expect(problem).toContain('steps 1, 2')
    expect(problem).toContain('--allow-js')
    expect(jsStepsProblem(walk, true, 'a.json')).toBeNull()
    expect(jsStepsProblem({ steps: [{ do: 'click' }] }, false, 'a')).toBeNull()
  })
})

describe('a script opens a saved sign-in only from its own directory', () => {
  const dir = resolve('/work/takes/demo')

  it('reads one beside the script', () => {
    expect(peerStatePath(dir, 'bob.json', [])).toBe(resolve(dir, 'bob.json'))
    expect(peerStatePath(dir, 'states/bob.json', [])).toBe(
      resolve(dir, 'states/bob.json'),
    )
  })

  it('refuses one anywhere else, by any spelling', () => {
    for (const name of [
      '../other/bob.json',
      '../../../Users/me/.vos/sessions/work.json',
      '/Users/me/.vos/sessions/work.json',
      'states/../../escape.json',
    ])
      expect(() => peerStatePath(dir, name, []), name).toThrow(
        /outside the script's own directory/,
      )
  })

  it('opens one elsewhere that the person named', () => {
    const elsewhere = '/Users/me/.vos/sessions/work.json'
    expect(peerStatePath(dir, elsewhere, [elsewhere])).toBe(resolve(elsewhere))
    // Naming one file is not naming its neighbours.
    expect(() =>
      peerStatePath(dir, '/Users/me/.vos/sessions/bank.json', [elsewhere]),
    ).toThrow(/--allow-state/)
  })
})

describe('the reach is settled before anything is opened', () => {
  const script = {
    setup: [{ do: 'type', selector: '#pw', text: { env: 'DEMO_PASSWORD' } }],
    steps: [{ do: 'expect', js: '1' }],
  } as unknown as Parameters<typeof grantReach>[0]

  it('throws a usage error for each thing not granted', () => {
    expect(() => grantReach(script, {}, {}, 'a.json')).toThrow(UsageError)
    expect(() => grantReach(script, {}, {}, 'a.json')).toThrow(
      /--env DEMO_PASSWORD/,
    )
    expect(() =>
      grantReach(script, {}, { env: ['DEMO_PASSWORD'] }, 'a.json'),
    ).toThrow(/--allow-js/)
  })

  it('and then hands over exactly what was granted', () => {
    grantReach(
      script,
      { 'allow-js': true },
      { env: ['DEMO_PASSWORD'] },
      'a.json',
    )
    expect(scriptEnv({ DEMO_PASSWORD: 'pw', OTHER: 'x' })).toEqual({
      DEMO_PASSWORD: 'pw',
    })
  })
})

describe('the take server answers only its own name', () => {
  it('is itself on a loopback name at its own port', () => {
    expect(ownHost('127.0.0.1:5173', 5173)).toBe(true)
    expect(ownHost('localhost:5173', 5173)).toBe(true)
    expect(ownHost('LOCALHOST:5173', 5173)).toBe(true)
    expect(ownHost('[::1]:5173', 5173)).toBe(true)
  })

  it('is not a name someone pointed at this machine', () => {
    expect(ownHost('attacker.example:5173', 5173)).toBe(false)
    expect(ownHost('127.0.0.1.attacker.example:5173', 5173)).toBe(false)
    expect(ownHost('localhost:9999', 5173)).toBe(false)
    expect(ownHost('localhost', 5173)).toBe(false)
    expect(ownHost(undefined, 5173)).toBe(false)
  })
})

describe('a page writes pictures and media, never a file a tool reads', () => {
  it('takes what the CLI’s own pages write', () => {
    for (const name of [
      'recording.webm',
      'render-chunk-3.tmp',
      'render-chunk-3-first.png',
      'frame-0012.png',
      'moment-4.png',
      'out.mp4',
    ])
      expect(saveNameOk(name), name).toBe(true)
  })

  it('refuses code, scripts and documents under any name', () => {
    for (const name of [
      'program.mjs',
      'program.js',
      'vos.config.ts',
      'actions.json',
      'doc.json',
      'notes.json',
      'CUT.md',
      'index.html',
      'out.bin',
      'noextension',
      '.env',
      '../recording.webm',
      'a/b.png',
      'program.mjs.png/../x.mjs',
    ])
      expect(saveNameOk(name), name).toBe(false)
  })
})
