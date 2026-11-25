// Writes the chunk map (plan 162; NF-2.2, NF-2.7, A-8.18): for each group of
// lazy code, the files the browser can be told to preload, so that a route's
// or the editor's chunks arrive in one round trip instead of one per level of
// imports. A group's files are the output chunk whose `entryPoint` is the
// group's source file, plus every chunk it imports statically, transitively,
// less the files index.html already loads.
//
// The build is the only place that knows which file holds which lazy import:
// it reads esbuild's metafile, which the production build writes as
// `browser-stats.json` (`statsJson`). The map goes to `chunk-map.json` next to
// `browser/`, not in it, so the server reads it without serving it (A-7.9).
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { initialScripts } from './size-check.mjs';

/** The groups, by the source file of the lazy import that starts each. */
export const GROUPS = Object.freeze({
  auth: 'libs/web/feature-auth/src/index.ts',
  shell: 'libs/web/shell/src/index.ts',
  dashboard: 'libs/web/feature-dashboard/src/index.ts',
  repositories: 'libs/web/feature-repositories/src/index.ts',
  preferences: 'libs/web/feature-preferences/src/index.ts',
  'repository-screen': 'libs/web/feature-repository-screen/src/index.ts',
  editor: 'libs/web/feature-repository-screen/src/repository-screen/components/editor-pane/editor-pane.component.ts'
});

/**
 * The inputs, by path prefix, that a group's files must not hold (plan 163;
 * NF-2.2, A-8.18). The preview's Markdown pipeline runs in the preview worker
 * (A-8.13); it reaches the editor's chunks only when an entry point that the
 * editor imports exports it, since the module builds its pipeline at its top
 * level and so is never dropped as unused.
 */
export const FORBIDDEN = Object.freeze({
  editor: Object.freeze([
    'node_modules/hast-util-raw/',
    'libs/web/markdown/src/markdown/pipeline/render-safe-html.ts',
    // The HTML language with its CSS and JavaScript ones and their grammars: loaded after the
    // editor is ready (A-8.11), each named so that none comes back by another import.
    'node_modules/@codemirror/lang-html/',
    'node_modules/@codemirror/lang-css/',
    'node_modules/@codemirror/lang-javascript/',
    'node_modules/@lezer/html/',
    'node_modules/@lezer/css/',
    'node_modules/@lezer/javascript/'
  ])
});

/**
 * The most that the editor's own files (`editorOwnFiles`) may weigh, gzipped
 * (plan 163; NF-2.2). On slow 4G, NF-2.2's 2 s less one round trip of
 * 562.5 ms and about 150 ms to render leaves about 230 KB of Brotli at
 * 180 KB/s; gzip, which this script can compute before `precompress`, is the
 * larger of the two, so the budget has a margin.
 */
export const EDITOR_LIMIT_BYTES = 230 * 1024;

/** The version of `chunk-map.json`'s format, which the server checks. */
export const VERSION = 1;

/** An output path of the metafile relative to `browser/`: the build may write them from the workspace. */
function relativeToBrowser(path) {
  return path.replace(/^(?:.*\/)?browser\//, '');
}

/** The metafile's outputs by their path relative to `browser/`. */
function outputsOf(metafile) {
  return new Map(
    Object.entries(metafile.outputs).map(([ path, output ]) => [ relativeToBrowser(path), output ])
  );
}

/**
 * The files of each group, relative to `browser/`, sorted: the output whose
 * `entryPoint` is the group's source file and its static imports,
 * transitively, less `initialFiles`. Throws when a group's source file is no
 * output's `entryPoint`.
 */
export function chunkMap(metafile, initialFiles, groups = GROUPS) {
  const outputs = outputsOf(metafile);
  const initial = new Set(initialFiles.map(relativeToBrowser));
  const map = {};
  for (const [ group, source ] of Object.entries(groups)) {
    const start = [ ...outputs ].find(([ , output ]) => output.entryPoint === source)?.[0];
    if (start === undefined) {
      throw new Error(`${group}: ${source} is no output's entryPoint`);
    }
    const files = new Set();
    const queue = [ start ];
    while (queue.length > 0) {
      const file = queue.pop();
      if (files.has(file) || initial.has(file)) {
        continue;
      }
      files.add(file);
      for (const imported of outputs.get(file)?.imports ?? []) {
        if (imported.kind === 'import-statement') {
          queue.push(relativeToBrowser(imported.path));
        }
      }
    }
    map[group] = [ ...files ].sort();
  }
  return map;
}

/**
 * Throws when a file of a group in `map` holds an input that starts with one
 * of the group's prefixes in `forbidden`, naming the group, the file and the
 * input.
 */
export function checkGroups(metafile, map, forbidden = FORBIDDEN) {
  const outputs = outputsOf(metafile);
  for (const [ group, prefixes ] of Object.entries(forbidden)) {
    for (const file of map[group] ?? []) {
      const input = Object.keys(outputs.get(file)?.inputs ?? {}).find(path =>
        prefixes.some(prefix => path.startsWith(prefix))
      );
      if (input !== undefined) {
        throw new Error(`${group}: ${file} holds ${input}`);
      }
    }
  }
}

/**
 * The files of the `editor` group less those of the `repository-screen`
 * group, which are loaded before any file can be chosen.
 */
export function editorOwnFiles(map) {
  const screen = new Set(map['repository-screen'] ?? []);
  return (map.editor ?? []).filter(file => !screen.has(file));
}

/** The gzipped size of `files` in `browser`, in bytes. */
export function gzipSize(browser, files) {
  return files.reduce((sum, file) => sum + gzipSync(readFileSync(join(browser, file))).length, 0);
}

/**
 * Reads `<dist>/browser-stats.json` and `<dist>/browser/index.html`, writes
 * `<dist>/chunk-map.json` and returns its groups. Throws when a listed file is
 * not in `browser/`, when a group holds a forbidden input (`checkGroups`), or
 * when the editor's own files are over `limit` bytes gzipped.
 */
export function writeChunkMap(dist, groups = GROUPS, limit = EDITOR_LIMIT_BYTES) {
  const browser = join(dist, 'browser');
  const metafile = JSON.parse(readFileSync(join(dist, 'browser-stats.json'), 'utf8'));
  const initial = initialScripts(readFileSync(join(browser, 'index.html'), 'utf8'));
  const map = chunkMap(metafile, initial, groups);
  checkGroups(metafile, map);
  for (const [ group, files ] of Object.entries(map)) {
    for (const file of files) {
      if (!existsSync(join(browser, file))) {
        throw new Error(`${group}: ${file} is not in ${browser}`);
      }
    }
  }
  const editorBytes = gzipSize(browser, editorOwnFiles(map));
  if (editorBytes > limit) {
    throw new Error(
      `editor: ${(editorBytes / 1024).toFixed(1)} KB gzipped, over the ${limit / 1024} KB budget (NF-2.2)`
    );
  }
  writeFileSync(join(dist, 'chunk-map.json'), `${JSON.stringify({ version: VERSION, groups: map }, null, 2)}\n`);
  return map;
}

// Run as a script, wherever the workspace is (see size-check.mjs).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dist = process.argv[2] ?? 'dist/apps/web';
  try {
    const map = writeChunkMap(dist);
    const line = (bytes, name) => console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB gzip  ${name}`);
    for (const [ group, files ] of Object.entries(map)) {
      line(gzipSize(join(dist, 'browser'), files), `${group} (${files.length} files)`);
    }
    const own = editorOwnFiles(map);
    line(
      gzipSize(join(dist, 'browser'), own),
      `editor's own (${own.length} files; budget ${EDITOR_LIMIT_BYTES / 1024} KB)`
    );
    console.log(`Wrote ${join(dist, 'chunk-map.json')}`);
  } catch (error) {
    console.error(`chunk-map: ${error.message}`);
    process.exit(1);
  }
}
