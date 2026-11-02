import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { readText, resolveInWorkspace, workspacePath } from './workspace.mjs';

/** The files that define or read `--ui-*` custom properties. */
const EXTENSIONS = new Set([ '.scss', '.ts', '.html' ]);

/**
 * Reads every SCSS, TypeScript and HTML file under the given workspace
 * folders as `{ path, text }`, with workspace paths. Skips `node_modules` and
 * does not follow symbolic links.
 */
export function readSources(folders) {
  const sources = [];
  const walk = absolute => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(path);
      } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
        sources.push({ path: workspacePath(path), text: readText(path) });
      }
    }
  };
  for (const folder of folders) {
    const absolute = resolveInWorkspace(folder);
    if (!statSync(absolute).isDirectory()) {
      throw new Error(`${workspacePath(absolute)} is not a folder`);
    }
    walk(absolute);
  }
  return sources;
}

/** Specs and stories may write any token for their fixtures; they define nothing. */
const NOT_DEFINING = /\.(spec|stories)\.ts$/;

/** The text without comments; `//` after a colon, as in `https://`, is not a comment. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The keys of a `$tokens: (name: (…), …);` map; each becomes `--ui-<name>`. */
function mapKeys(text, path) {
  const start = text.indexOf('$tokens: (');
  if (start < 0) {
    return [];
  }
  const keys = [];
  for (const raw of text.slice(start).split('\n').slice(1)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === ');') {
      return keys;
    }
    const key = line.match(/^([a-z0-9-]+)\s*:/);
    if (key) {
      keys.push(`--ui-${key[1]}`);
    }
  }
  throw new Error(`${path}: the $tokens map is not closed`);
}

/**
 * Every `--ui-*` custom property the sources define: declarations (also as a
 * quoted key in TypeScript), `[style.--ui-*]` bindings, `setProperty` calls
 * and the keys of the token maps, which the token files emit as declarations.
 * Specs, stories and comments define nothing.
 */
export function definedTokens(sources) {
  const defined = new Set();
  for (const { path, text: source } of sources) {
    if (NOT_DEFINING.test(path)) {
      continue;
    }
    const text = withoutComments(source);
    for (const [ , name ] of text.matchAll(/(--ui-[a-z0-9-]+)['"]?\s*:/g)) {
      defined.add(name);
    }
    for (const [ , name ] of text.matchAll(/\[style\.(--ui-[a-z0-9-]+)\]/g)) {
      defined.add(name);
    }
    for (const [ , name ] of text.matchAll(/setProperty\(\s*['"`](--ui-[a-z0-9-]+)['"`]/g)) {
      defined.add(name);
    }
    for (const name of mapKeys(text, path)) {
      defined.add(name);
    }
  }
  return defined;
}

/**
 * The `var(--ui-*)` references without a fallback whose token is not in
 * `defined`, as `{ file, line, name }`. Such a reference resolves to nothing
 * and silently falls back to the inherited value. Names built by
 * interpolation are not checked.
 */
export function unknownTokens(sources, defined) {
  const found = [];
  for (const { path, text } of sources) {
    for (const match of text.matchAll(/var\(\s*(--ui-[a-z0-9-]+)\s*\)/g)) {
      if (!defined.has(match[1])) {
        found.push({ file: path, line: text.slice(0, match.index).split('\n').length, name: match[1] });
      }
    }
  }
  return found;
}
