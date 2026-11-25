import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkGroups, chunkMap, FORBIDDEN, GROUPS, writeChunkMap } from './chunk-map.mjs';
import { initialScripts } from './size-check.mjs';

const output = (entryPoint, imports = [], dynamic = []) => ({
  ...(entryPoint ? { entryPoint } : {}),
  imports: [
    ...imports.map(path => ({ path, kind: 'import-statement' })),
    ...dynamic.map(path => ({ path, kind: 'dynamic-import' }))
  ]
});

/** main → shared; dashboard → dash-dep → deep, and main; editor only dynamically. */
const METAFILE = {
  inputs: {},
  outputs: {
    'main-AAAAAAAA.js': output('apps/web/src/main.ts', [ 'chunk-shared00.js' ], [ 'chunk-dashbrd0.js' ]),
    'chunk-shared00.js': output(undefined),
    'chunk-dashbrd0.js': output('libs/web/feature-dashboard/src/index.ts', [
      'chunk-dashdep0.js',
      'main-AAAAAAAA.js'
    ], [ 'chunk-editor00.js' ]),
    'chunk-dashdep0.js': output(undefined, [ 'chunk-deep0000.js', 'chunk-shared00.js' ]),
    'chunk-deep0000.js': output(undefined),
    'chunk-editor00.js': output('libs/web/editor.ts', [ 'chunk-cm000000.js' ]),
    'chunk-cm000000.js': output(undefined),
    'styles-AAAAAAAA.css': output(undefined)
  }
};
const INITIAL = [ 'main-AAAAAAAA.js', 'chunk-shared00.js' ];

describe('chunkMap', () => {
  it('lists a group\'s chunk and its static imports, transitively', () => {
    const map = chunkMap(METAFILE, INITIAL, { dashboard: 'libs/web/feature-dashboard/src/index.ts' });
    expect(map).toEqual({ dashboard: [ 'chunk-dashbrd0.js', 'chunk-dashdep0.js', 'chunk-deep0000.js' ] });
  });

  it('leaves out dynamic imports', () => {
    const map = chunkMap(METAFILE, INITIAL, { dashboard: 'libs/web/feature-dashboard/src/index.ts' });
    expect(map.dashboard).not.toContain('chunk-editor00.js');
    expect(chunkMap(METAFILE, INITIAL, { editor: 'libs/web/editor.ts' })).toEqual({
      editor: [ 'chunk-cm000000.js', 'chunk-editor00.js' ]
    });
  });

  it('leaves out files index.html already loads', () => {
    const map = chunkMap(METAFILE, INITIAL, { dashboard: 'libs/web/feature-dashboard/src/index.ts' });
    expect(map.dashboard).not.toContain('main-AAAAAAAA.js');
    expect(map.dashboard).not.toContain('chunk-shared00.js');
  });

  it('strips the output directory from the metafile\'s paths', () => {
    const prefixed = {
      outputs: Object.fromEntries(
        Object.entries(METAFILE.outputs).map(([ path, value ]) => [
          `dist/apps/web/browser/${path}`,
          { ...value, imports: value.imports.map(i => ({ ...i, path: `dist/apps/web/browser/${i.path}` })) }
        ])
      )
    };
    expect(chunkMap(prefixed, INITIAL, { editor: 'libs/web/editor.ts' })).toEqual({
      editor: [ 'chunk-cm000000.js', 'chunk-editor00.js' ]
    });
  });

  it('fails when a group\'s source file is no output\'s entryPoint', () => {
    expect(() => chunkMap(METAFILE, INITIAL, { shell: 'libs/web/shell/src/index.ts' })).toThrow(
      /shell: libs\/web\/shell\/src\/index\.ts is no output's entryPoint/
    );
  });
});

describe('checkGroups', () => {
  const withInputs = (base, inputs) => ({
    ...base,
    inputs: Object.fromEntries(inputs.map(path => [ path, { bytesInOutput: 1 } ]))
  });
  const forbidden = { editor: [ 'node_modules/hast-util-raw/', 'libs/web/markdown/render-safe-html.ts' ] };
  /** The fixture, with `hast-util-raw` in `holder` if given. */
  const metafile = holder => ({
    outputs: {
      ...METAFILE.outputs,
      'chunk-editor00.js': withInputs(METAFILE.outputs['chunk-editor00.js'], [ 'libs/web/editor.ts' ]),
      'chunk-cm000000.js': withInputs(METAFILE.outputs['chunk-cm000000.js'], [
        'node_modules/@codemirror/view/dist/index.js',
        ...(holder === 'chunk-cm000000.js' ? [ 'node_modules/hast-util-raw/lib/index.js' ] : [])
      ]),
      'chunk-dashdep0.js': withInputs(
        METAFILE.outputs['chunk-dashdep0.js'],
        holder === 'chunk-dashdep0.js' ? [ 'node_modules/hast-util-raw/lib/index.js' ] : []
      )
    }
  });
  const check = holder =>
    checkGroups(metafile(holder), chunkMap(metafile(holder), INITIAL, { editor: 'libs/web/editor.ts' }), forbidden);

  it('fails when the editor\'s chunks hold a forbidden input, naming the chunk and the input', () => {
    expect(() => check('chunk-cm000000.js')).toThrow(
      'editor: chunk-cm000000.js holds node_modules/hast-util-raw/lib/index.js'
    );
  });

  it('passes when the forbidden input is only in a chunk outside the group', () => {
    expect(() => check('chunk-dashdep0.js')).not.toThrow();
    expect(() => check(undefined)).not.toThrow();
  });

  it('forbids the preview pipeline in the editor\'s chunks', () => {
    expect(FORBIDDEN.editor).toContain('node_modules/hast-util-raw/');
    expect(FORBIDDEN.editor).toContain('libs/web/markdown/src/markdown/pipeline/render-safe-html.ts');
  });
});

describe('writeChunkMap', () => {
  let dist;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'chunk-map-'));
    mkdirSync(join(dist, 'browser'));
    writeFileSync(join(dist, 'browser-stats.json'), JSON.stringify(METAFILE));
    writeFileSync(
      join(dist, 'browser', 'index.html'),
      '<link rel="modulepreload" href="chunk-shared00.js"><script src="main-AAAAAAAA.js" type="module"></script>'
    );
    for (const file of Object.keys(METAFILE.outputs)) {
      writeFileSync(join(dist, 'browser', file), `// ${file}\n`);
    }
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it('writes chunk-map.json next to browser/, not in it', () => {
    writeChunkMap(dist, { editor: 'libs/web/editor.ts' });

    expect(existsSync(join(dist, 'browser', 'chunk-map.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dist, 'chunk-map.json'), 'utf8'))).toEqual({
      version: 1,
      groups: { editor: [ 'chunk-cm000000.js', 'chunk-editor00.js' ] }
    });
  });

  it('fails when a listed file is not in browser/', () => {
    rmSync(join(dist, 'browser', 'chunk-cm000000.js'));
    expect(() => writeChunkMap(dist, { editor: 'libs/web/editor.ts' })).toThrow(
      /editor: chunk-cm000000\.js is not in .*browser/
    );
  });
});

const BUILD = join(import.meta.dirname, '..', '..', '..', 'dist', 'apps', 'web');

describe.skipIf(!existsSync(join(BUILD, 'browser-stats.json')))('the production build', () => {
  it('finds every group in the production build', () => {
    const metafile = JSON.parse(readFileSync(join(BUILD, 'browser-stats.json'), 'utf8'));
    const initial = initialScripts(readFileSync(join(BUILD, 'browser', 'index.html'), 'utf8'));
    const map = chunkMap(metafile, initial);

    expect(Object.keys(map)).toEqual(Object.keys(GROUPS));
    for (const files of Object.values(map)) {
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(initial).not.toContain(file);
        expect(existsSync(join(BUILD, 'browser', file))).toBe(true);
      }
    }
  });

  it('keeps the preview pipeline out of the editor\'s chunks', () => {
    const metafile = JSON.parse(readFileSync(join(BUILD, 'browser-stats.json'), 'utf8'));
    const initial = initialScripts(readFileSync(join(BUILD, 'browser', 'index.html'), 'utf8'));

    expect(() => checkGroups(metafile, chunkMap(metafile, initial))).not.toThrow();
  });
});
