import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/** A group of lazy chunks in the build's chunk map (`apps/web/scripts/chunk-map.mjs`, A-8.18). */
export type ChunkGroup =
  | 'auth'
  | 'shell'
  | 'dashboard'
  | 'repositories'
  | 'preferences'
  | 'repository-screen'
  | 'editor';

/** The groups the web client preloads itself, handed to it in `#fb-chunk-map` (A-8.18). */
const CLIENT_GROUPS: readonly ChunkGroup[] = [ 'editor' ];

/** The chunk map's format that this server reads. */
const CHUNK_MAP_VERSION = 1;

/** The translations every page asks for first: the only language is English (NF-14). */
const TRANSLATIONS = 'i18n/en.json';

/** A file of a Markdown file's route, as the web client tells one (`.md`, `.markdown`, `.mdx`, any case). */
const MARKDOWN = /\.(?:md|markdown|mdx)$/;

/** The files of each group, relative to the web root. */
export type ChunkMap = Partial<Record<ChunkGroup, readonly string[]>>;

/**
 * The groups whose chunks the page at `path` loads first (A-7.9): the route
 * the web client's router will pick for it, matched on the decoded and
 * normalised path, ignoring case as Express's routing does. A wrong guess
 * costs bytes only, so a path that cannot be decoded, or matches no route,
 * gets none.
 */
export function preloadGroups(path: string): ChunkGroup[] {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return [];
  }
  const normalised = posix.normalize(decoded).toLowerCase().replace(/(?<=.)\/+$/, '');
  const segments = normalised.split('/').slice(1);
  switch (normalised) {
    case '/':
      return [ 'shell', 'dashboard' ];
    case '/repositories':
      return [ 'shell', 'repositories' ];
    case '/preferences':
      return [ 'shell', 'preferences' ];
    case '/onboarding':
      return [ 'auth' ];
  }
  if (segments[0] === 'login') {
    return [ 'auth' ];
  }
  if (segments[0] === 'repositories' && isRepositoryId(segments[1] ?? '')) {
    const isMarkdownFile = segments[2] === 'files' && segments.length > 3 && MARKDOWN.test(segments.at(-1) ?? '');
    return isMarkdownFile ? [ 'repository-screen', 'editor' ] : [ 'repository-screen' ];
  }
  return [];
}

/** A repository's ID in a route, as the web client's router tells one (`isRepositoryId` of `web/core`). */
function isRepositoryId(segment: string): boolean {
  return /^[1-9]\d*$/.test(segment) && Number.isSafeInteger(Number(segment));
}

/**
 * Reads `chunk-map.json` next to `webRoot` (written at build), keeping only
 * the files that are in the web root: a map from another build must not make
 * a preload point at a 404. `warn` is called once when files are dropped, or
 * when the map cannot be read. `undefined` when there is no map, or it cannot
 * be read: the page then gets no preloads, as before the map (a development
 * build writes none).
 */
export function loadChunkMap(webRoot: string, warn: (message: string) => void): ChunkMap | undefined {
  const file = join(webRoot, '..', 'chunk-map.json');
  if (!existsSync(file)) {
    return undefined;
  }
  let groups: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; groups?: unknown; };
    if (parsed.version !== CHUNK_MAP_VERSION || typeof parsed.groups !== 'object' || parsed.groups === null) {
      throw new Error(`not version ${CHUNK_MAP_VERSION}`);
    }
    groups = parsed.groups as Record<string, unknown>;
  } catch (error) {
    warn(`The chunk map cannot be read (${(error as Error).message}); no chunks are preloaded.`);
    return undefined;
  }
  const map: ChunkMap = {};
  const missing = new Set<string>();
  for (const [ group, files ] of Object.entries(groups)) {
    if (!Array.isArray(files)) {
      continue;
    }
    map[group as ChunkGroup] = files.filter((name): name is string => {
      const kept = typeof name === 'string' && isPlainFile(name) && existsSync(join(webRoot, name));
      if (!kept) {
        missing.add(String(name));
      }
      return kept;
    });
  }
  if (missing.size > 0) {
    warn(`The chunk map names ${missing.size} files the web client does not have; they are not preloaded.`);
  }
  return map;
}

/** A root-level file name that is safe in an attribute: the build's hashed chunks are. */
function isPlainFile(name: string): boolean {
  return /^[A-Za-z0-9_.-]+\.js$/.test(name);
}

/**
 * The tags to add before `</head>` for the page at `path`: a
 * `modulepreload` per file of its groups, the translations' preload, and the
 * groups the web client preloads itself as JSON. Each carries `nonce`
 * (NF-11.1).
 */
export function preloadTags(map: ChunkMap, path: string, nonce: string): string {
  const files = new Set(preloadGroups(path).flatMap(group => map[group] ?? []));
  const tags = [ ...files ].map(file => `<link rel="modulepreload" href="${file}" nonce="${nonce}">`);
  tags.push(`<link rel="preload" href="${TRANSLATIONS}" as="fetch" crossorigin="anonymous" nonce="${nonce}">`);
  const clientGroups = Object.fromEntries(CLIENT_GROUPS.map(group => [ group, map[group] ?? [] ]));
  // The file names are plain (`isPlainFile`), but `<` is escaped all the same: nothing may end the script early.
  const json = JSON.stringify(clientGroups).replace(/</g, '\\u003c');
  tags.push(`<script type="application/json" id="fb-chunk-map" nonce="${nonce}">${json}</script>`);
  return tags.join('');
}
