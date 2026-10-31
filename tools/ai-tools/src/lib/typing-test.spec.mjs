import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSite, createSiteServer, isBuilt } from './typing-test-site.mjs';
import {
  formatResults,
  generateMarkdown,
  keystrokeTimings,
  parseSetup,
  setupQuery,
  SETUPS,
  summarise,
  SWITCHES,
  TYPING_TEST_FILES,
  typingSpeed
} from './typing-test.mjs';
import { OutsideWorkspaceError, WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

/** A raw GET, so that `..` in the path reaches the server as it is. */
function get(port, path, method = 'GET') {
  return new Promise((done, fail) => {
    request({ hostname: '127.0.0.1', port, path, method }, response => {
      let body = '';
      response.on('data', chunk => (body += chunk));
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', fail).end();
  });
}

describe('generateMarkdown', () => {
  it('stays at or below the size and close to it', () => {
    for (const maxBytes of Object.values(TYPING_TEST_FILES)) {
      const size = Buffer.byteLength(generateMarkdown(maxBytes));
      expect(size).toBeLessThanOrEqual(maxBytes);
      expect(size).toBeGreaterThan(maxBytes - 4096);
    }
  });

  it('makes the same file every time', () => {
    expect(generateMarkdown(50_000)).toBe(generateMarkdown(50_000));
  });

  it('looks like documentation', () => {
    const text = generateMarkdown(100_000);
    expect(text.startsWith('---\ntitle: Typing test\n')).toBe(true);
    expect(text).toMatch(/^## Section 1: /m);
    expect(text).toMatch(/^```ts$/m);
    expect(text).toMatch(/^\| Name \| Value \| Note \|$/m);
    expect(text).toMatch(/^> /m);
    expect(text).toMatch(/[؀-ۿ]/);
  });
});

describe('summarise', () => {
  it('reports nothing for no keystrokes', () => {
    expect(summarise([])).toEqual({ count: 0, median: null, p95: null, max: null, over: 0 });
  });

  it('reports the median, nearest-rank p95, max and keystrokes over 50 ms', () => {
    const durations = Array.from({ length: 20 }, (_, index) => index + 1);
    durations[19] = 50.4;
    durations[18] = 61;
    expect(summarise(durations)).toEqual({ count: 20, median: 10, p95: 50, max: 61, over: 2 });
  });
});

describe('typingSpeed', () => {
  it('counts keystrokes per second between the first and the last', () => {
    expect(typingSpeed([ 0, 200, 400, 600, 800 ])).toBe(5);
    expect(typingSpeed([ 800, 0, 300 ])).toBe(2.5);
  });

  it('gives null for fewer than two keystrokes', () => {
    expect(typingSpeed([])).toBeNull();
    expect(typingSpeed([ 5 ])).toBeNull();
  });
});

describe('keystrokeTimings', () => {
  it('joins the events of one frame into one keystroke, from its first event to the frame', () => {
    const entries = [
      { startTime: 1000, duration: 64 }, // keydown
      { startTime: 1003, duration: 56 }, // beforeinput, rounded to 8 ms
      { startTime: 1004, duration: 64 }, // input
      { startTime: 1200, duration: 24 }
    ];
    expect(keystrokeTimings(entries)).toEqual([ 68, 24 ]);
  });

  it('keeps keystrokes in frames 11 ms apart apart', () => {
    expect(keystrokeTimings([ { startTime: 0, duration: 40 }, { startTime: 11, duration: 40 } ])).toEqual([ 40, 40 ]);
  });

  it('gives nothing for no entries', () => {
    expect(keystrokeTimings([])).toEqual([]);
  });
});

describe('switches', () => {
  it('has line numbers and the wrap marker gutter, and a setup that turns both off', () => {
    expect(Object.keys(SWITCHES)).toEqual(expect.arrayContaining([ 'linenumbers', 'wrapmarker' ]));
    expect(SETUPS).toContainEqual([ 'linenumbers', 'wrapmarker' ]);
  });
});

describe('parseSetup', () => {
  it('defaults to the first file with everything on', () => {
    expect(parseSetup('')).toEqual({ file: '2kb.md', off: [], unknown: [] });
  });

  it('reads the file and the switches, in the order of SWITCHES', () => {
    expect(parseSetup('?file=1mb.md&off=spellcheck, wrap')).toEqual({
      file: '1mb.md',
      off: [ 'wrap', 'spellcheck' ],
      unknown: []
    });
  });

  it('falls back to the first file for an unknown one', () => {
    expect(parseSetup('?file=../package.json').file).toBe('2kb.md');
  });

  it('returns unknown switches apart', () => {
    expect(parseSetup('?off=wrap,highlight').unknown).toEqual([ 'highlight' ]);
  });

  it('round-trips every setup of the menu through the address', () => {
    for (const off of SETUPS) {
      expect(off.every(name => name in SWITCHES)).toBe(true);
      expect(parseSetup(setupQuery({ file: '1mb.md', off }))).toEqual({ file: '1mb.md', off, unknown: [] });
    }
  });
});

describe('formatResults', () => {
  const run = {
    file: '1mb.md',
    bytes: 1_048_000,
    position: 50,
    off: [ 'wrap', 'spellcheck' ],
    durations: [ 12, 20, 55.6 ],
    starts: [ 1000, 1250, 1500 ],
    eventTiming: [
      { startTime: 100, duration: 24 },
      { startTime: 101, duration: 24 },
      { startTime: 500, duration: 56 }
    ],
    userAgent: 'TestPhone',
    screen: '412×915 @2.625x'
  };

  it('gives every number the report needs', () => {
    expect(formatResults(run)).toBe([
      'file: 1mb.md (1,048,000 bytes)',
      'switched off: wrap, spellcheck',
      'typed at: 50 % of the file',
      'keystrokes: 3',
      'typing speed: 4 keys/s',
      'median: 20 ms · p95: 56 ms · max: 56 ms · over 50 ms: 1',
      'slowest: 56, 20, 12',
      'browser timing: 2 keystrokes of 16 ms or more · max: 56 ms · over 50 ms: 1',
      'browser: TestPhone',
      'screen: 412×915 @2.625x'
    ].join('\n'));
  });

  it('says when event timing is not supported and nothing was typed', () => {
    const text = formatResults({ ...run, off: [], position: null, durations: [], starts: [], eventTiming: null });
    expect(text).toContain('typing speed: — keys/s');
    expect(text).toContain('switched off: nothing');
    expect(text).toContain('typed at: n/a');
    expect(text).toContain('no keystrokes measured');
    expect(text).toContain('browser timing: not supported by this browser');
  });
});

describe('typing test site', () => {
  let out;
  let server;
  let port;

  beforeAll(async () => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    out = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-typing-test-'));
    await buildSite(workspacePath(out));
    server = createSiteServer(out);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  }, 60_000);

  afterAll(() => {
    server?.close();
    rmSync(out, { recursive: true, force: true });
  });

  it('builds the page and the test files', () => {
    expect(isBuilt(out)).toBe(true);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('src="./app.js"');
    expect(readFileSync(join(out, 'app.js'), 'utf8')).toContain('cm-editor');
  });

  it('refuses an output folder outside the workspace', async () => {
    await expect(buildSite('../outside')).rejects.toThrow(OutsideWorkspaceError);
  });

  it('serves the page at / and the test files uncached', async () => {
    const page = await get(port, '/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    const file = await get(port, '/1mb.md');
    expect(file.status).toBe(200);
    expect(file.headers['cache-control']).toBe('no-store');
    expect(Buffer.byteLength(file.body)).toBeLessThanOrEqual(TYPING_TEST_FILES['1mb.md']);
  });

  it('serves nothing else', async () => {
    for (const path of [ '/../package.json', '/%2e%2e/package.json', '/page.mjs', '/app.js.map' ]) {
      expect((await get(port, path)).status).toBe(404);
    }
    expect((await get(port, '/index.html', 'POST')).status).toBe(404);
  });
});
