import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { resolveInWorkspace, workspacePath } from './workspace.mjs';

/** Where IDs are looked for by default: the docs, the code and the root's Markdown files. */
export const DEFAULT_ROOTS = [ 'docs', 'libs', 'apps', 'tools', 'CLAUDE.md', 'README.md' ];

/**
 * Never scanned: build output, dependencies, and this tool's own specs and
 * fixtures. Plans under `docs/superpowers` are dated snapshots that keep the
 * numbers they were written with; `includePlans` scans them too.
 */
const SKIPPED = [ 'node_modules', 'dist', 'tmp', 'coverage', '.nx', '.git', '.angular', 'tools/ai-tools' ];
const PLANS = 'docs/superpowers';
const EXTENSIONS = new Set([ '.md', '.ts', '.mjs', '.js', '.scss', '.html' ]);

/**
 * An ID: an upper-case prefix of one or more words (`A`, `NF`, `REQ-EDIT`)
 * and dot-separated numbers (`10.38`). Not part of a longer word or number.
 */
const ID = /(?<![\w-])([A-Z]+(?:-[A-Z]+)*)-(\d+(?:\.\d+)*)(?![\w-]|\.\d)/g;
const LIST_DEFINITION = /^\s*[-*]\s+\*\*([A-Z][\w.-]*)\*\*/;
const HEADING_DEFINITION = /^(#+)\s+([A-Z][\w.-]*):/;
const ROW_DEFINITION = /^\|\s*(?:\*\*)?([A-Z][\w.-]*?)(?:\*\*)?\s*\|/;

/** Splits `A-10.38` into `{ prefix: 'A', numbers: ['10', '38'] }`; null if it is not an ID. */
export function parseId(text) {
  const match = new RegExp(`^${ID.source}$`).exec(text);
  return match && { prefix: match[1], numbers: match[2].split('.') };
}

export const formatId = ({ prefix, numbers }) => (numbers.length ? `${prefix}-${numbers.join('.')}` : prefix);

/** The family of an ID, without its last number: `A-10` for `A-10.38`, `LG` for `LG-12`. */
export function familyOf(id) {
  const { prefix, numbers } = parseId(id);
  return formatId({ prefix, numbers: numbers.slice(0, -1) });
}

/**
 * Every ID in a text, with its line (1-based), column and how that line
 * defines it: `item` (`- **ID** …`), `row` (the first cell of a table row),
 * `title` (`# ID: …`), `heading` (`## ID: …`, a group such as `A-10`), or
 * null for a reference.
 */
export function findIds(text) {
  const found = [];
  for (const [ index, line ] of text.split('\n').entries()) {
    const list = LIST_DEFINITION.exec(line)?.[1];
    const heading = HEADING_DEFINITION.exec(line);
    const row = ROW_DEFINITION.exec(line)?.[1];
    for (const match of line.matchAll(ID)) {
      const id = match[0];
      const definition = list === id
        ? 'item'
        : row === id
        ? 'row'
        : heading?.[2] === id
        ? (heading[1] === '#' ? 'title' : 'heading')
        : null;
      found.push({
        id,
        prefix: match[1],
        numbers: match[2].split('.'),
        line: index + 1,
        column: match.index,
        definition
      });
    }
  }
  return found;
}

/** Whether a folder or file found while walking is skipped; roots given explicitly never are. */
function skipped(absolute, includePlans) {
  const rel = workspacePath(absolute);
  const under = folder => rel === folder || rel.startsWith(`${folder}/`);
  const name = rel.split('/').at(-1);
  return SKIPPED.some(skip => (skip.includes('/') ? under(skip) : name === skip)) || (!includePlans && under(PLANS));
}

function walk(absolute, files, includePlans, root = false) {
  if (!root && skipped(absolute, includePlans)) {
    return;
  }
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOTDIR') {
      if (EXTENSIONS.has(extname(absolute))) {
        files.push(absolute);
      }
      return;
    }
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    // Symbolic links are not followed, so a scan cannot leave the workspace.
    if (entry.isDirectory() || entry.isFile()) {
      walk(join(absolute, entry.name), files, includePlans);
    }
  }
}

/** Reads the files under `roots` (workspace paths), as `{ path, text }`. */
export function scan({ roots = DEFAULT_ROOTS, includePlans = false } = {}) {
  const files = [];
  for (const root of roots) {
    walk(resolveInWorkspace(root), files, includePlans, true);
  }
  return [ ...new Set(files) ].sort().map(file => ({
    path: workspacePath(file),
    file,
    text: readFileSync(file, 'utf8')
  }));
}

/**
 * Checks the IDs of the scanned files:
 * - `duplicates`: an ID defined by more than one list item or title;
 * - `dangling`: a reference to an ID that is never defined, for prefixes that
 *   have definitions (so `UTF-8` and `CC-BY-4.0` are ignored). A reference to
 *   a group such as `D-9` is fine when any `D-9.x` is defined;
 * - `gaps`: numbers missing from a family of defined IDs, such as `A-10.12`
 *   between `A-10.11` and `A-10.13`.
 */
export function checkIds(files) {
  const found = files.flatMap(({ path, text }) => findIds(text).map(id => ({ ...id, path })));

  // A family's home is the file with most of its definitions. A definition
  // elsewhere of an ID that its home also defines is a bold reference, such as
  // `- **AR-31** says …` in a list of follow-ups.
  const counts = new Map();
  for (const { id, path, definition } of found) {
    if (definition && definition !== 'heading') {
      const key = `${familyOf(id)}\n${path}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const homes = new Map();
  for (const [ key, count ] of counts) {
    const [ family, path ] = key.split('\n');
    if (count > (homes.get(family)?.count ?? 0)) {
      homes.set(family, { path, count });
    }
  }
  const definedAtHome = new Set(
    found.filter(f => f.definition && homes.get(familyOf(f.id))?.path === f.path).map(f => f.id)
  );

  // A table row defines an ID only when no list item or title does: a table
  // can also list rules defined above it.
  const definedByText = new Set(found.filter(f => f.definition === 'item' || f.definition === 'title').map(f => f.id));

  const definitions = new Map();
  const references = [];
  for (const { path, line, definition, ...id } of found) {
    const home = homes.get(familyOf(id.id))?.path;
    const defines = definition && !(definition === 'row' && definedByText.has(id.id));
    if (defines && (definition === 'heading' || path === home || !definedAtHome.has(id.id))) {
      if (!definitions.has(id.id)) {
        definitions.set(id.id, []);
      }
      definitions.get(id.id).push({ path, line, kind: definition });
    } else {
      references.push({ ...id, path, line });
    }
  }

  const duplicates = [ ...definitions ]
    .map(([ id, places ]) => ({ id, places: places.filter(place => place.kind !== 'heading') }))
    .filter(({ places }) => places.length > 1);

  const prefixes = new Set([ ...definitions.keys() ].map(id => parseId(id).prefix));
  const groups = new Set();
  for (const id of definitions.keys()) {
    const { prefix, numbers } = parseId(id);
    for (let i = 1; i < numbers.length; i++) {
      groups.add(formatId({ prefix, numbers: numbers.slice(0, i) }));
    }
  }
  const dangling = references
    .filter(ref => prefixes.has(ref.prefix) && !definitions.has(ref.id) && !groups.has(ref.id))
    .map(({ id, path, line }) => ({ id, path, line }));

  const families = new Map();
  for (const [ id, places ] of definitions) {
    if (places.every(place => place.kind === 'heading')) {
      continue;
    }
    const family = familyOf(id);
    if (!families.has(family)) {
      families.set(family, new Set());
    }
    families.get(family).add(Number(parseId(id).numbers.at(-1)));
  }
  const gaps = [];
  for (const [ family, numbers ] of families) {
    const max = Math.max(...numbers);
    const missing = [];
    for (let n = 1; n <= max; n++) {
      if (!numbers.has(n)) {
        missing.push(n);
      }
    }
    if (missing.length) {
      gaps.push({ family, missing });
    }
  }

  return { definitions: definitions.size, references: references.length, duplicates, dangling, gaps };
}

/**
 * Builds the renaming for `renumber`: in the family `A-10` (or `LG`, `NF-1`,
 * `REQ-EDIT`), every ID whose next number is at least `from` moves by `by`,
 * together with its sub-IDs. Zero padding (`REQ-EDIT-003`) is kept.
 */
export function shiftMapping(ids, family, from, by) {
  const target = parseFamily(family);
  const depth = target.numbers.length;
  const mapping = new Map();
  for (const id of ids) {
    const { prefix, numbers } = parseId(id);
    const inFamily = prefix === target.prefix && numbers.length > depth
      && target.numbers.every((n, i) => Number(n) === Number(numbers[i]));
    if (!inFamily || Number(numbers[depth]) < from) {
      continue;
    }
    const shifted = Number(numbers[depth]) + by;
    if (shifted < 1) {
      throw new Error(`${id} would become number ${shifted}`);
    }
    const next = [ ...numbers ];
    next[depth] = String(shifted).padStart(numbers[depth].length, '0');
    mapping.set(id, formatId({ prefix, numbers: next }));
  }
  return mapping;
}

/** The renaming for `rename`: one ID, together with its sub-IDs (`A-10.42.1`). */
export function renameMapping(ids, from, to) {
  const source = parseId(from);
  const target = parseId(to);
  if (!source || !target) {
    throw new Error(`Not an ID: ${source ? to : from}`);
  }
  const mapping = new Map();
  for (const id of ids) {
    if (id === from || id.startsWith(`${from}.`)) {
      mapping.set(id, to + id.slice(from.length));
    }
  }
  return mapping;
}

function parseFamily(family) {
  const id = parseId(family);
  if (id) {
    return id;
  }
  if (/^[A-Z]+(-[A-Z]+)*$/.test(family)) {
    return { prefix: family, numbers: [] };
  }
  throw new Error(`Not an ID family (such as A-10, LG or REQ-EDIT): ${family}`);
}

/**
 * Applies a renaming to the scanned files in one pass, so that `A-10.21 →
 * A-10.22` and `A-10.22 → A-10.23` do not chain. Throws when a new ID is
 * already used by an ID that is not renamed. Returns the changed files with
 * their new text and every change as `{ path, line, from, to }`; writes the
 * files only when `write` is set.
 */
export function applyMapping(files, mapping, { write = false } = {}) {
  const used = new Set(files.flatMap(({ text }) => findIds(text).map(found => found.id)));
  const clashes = [ ...mapping.values() ].filter(id => used.has(id) && !mapping.has(id));
  if (clashes.length) {
    throw new Error(`Already in use, so the renaming would merge IDs: ${clashes.join(', ')}`);
  }
  const changes = [];
  const changed = [];
  for (const { path, file, text } of files) {
    const lines = text.split('\n').map((line, index) =>
      line.replace(ID, id => {
        const to = mapping.get(id);
        if (!to) {
          return id;
        }
        changes.push({ path, line: index + 1, from: id, to });
        return to;
      })
    );
    const next = lines.join('\n');
    if (next !== text) {
      changed.push({ path, file, text: next });
      if (write) {
        writeFileSync(file, next);
      }
    }
  }
  return { changed, changes };
}
