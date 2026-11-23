// Compresses the web client's files once, at build (plan 159; NF-2.2, NF-2.7):
// writes `<file>.br` (Brotli, quality 11) and `<file>.gz` (gzip, level 9) next
// to every compressible file of 1 KB or more, kept only when smaller than the
// original. The server sends the best variant the request accepts (A-7.9).
// index.html is left out: the server fills it with a nonce per request.
//
// It also checks the server's cache rule (A-7.9): every root-level `.js` and
// `.css` file and every file in `media/` is cached for good, so each must have
// a content hash in its name. It fails when one has none, so that a change of
// Angular's naming is caught before an unhashed file is cached for a year.
import { readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** The extensions worth compressing. */
export const COMPRESSIBLE = [ '.js', '.css', '.json', '.svg', '.txt', '.webmanifest', '.map' ];

/** Smaller files gain too little to be worth a variant. */
export const MIN_BYTES = 1024;

/** The template the server fills with a nonce: never precompressed. */
const TEMPLATE = 'index.html';

/** The variants, by extension, and how each is made. */
const VARIANTS = [
  {
    ext: '.br',
    compress: data =>
      brotliCompressSync(data, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: data.length
        }
      })
  },
  { ext: '.gz', compress: data => gzipSync(data, { level: 9 }) }
];

/** A content hash before the extension, as Angular writes it: `main-AB12cd_-.js`. */
const HASH = /-[A-Za-z0-9_-]{8}\.[^./]+$/;

/** Whether the server caches the file at `path` (relative, with `/`) for good: the places the build hashes. */
export function isHashedPlace(path) {
  const segments = path.split('/');
  if (segments.length === 1) {
    return [ '.js', '.css' ].includes(extname(path));
  }
  return segments[0] === 'media';
}

/** Every file under `dir`, relative to it, with `/` as the separator. */
function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** The files of a hashed place without a hash in their name. */
export function unhashedFiles(files) {
  return files.filter(file => isHashedPlace(file) && !HASH.test(file.split('/').at(-1)));
}

/**
 * Writes the variants of every file of `dir` worth compressing, and removes
 * every variant from an earlier run that is no longer worth it (the file is
 * now smaller than 1 KB, or the variant no smaller than the file). Throws, writing
 * nothing, when a file of a hashed place has no hash. Returns the files
 * compressed with the size of each variant written (`undefined` when not kept).
 */
export function precompress(dir) {
  const files = listFiles(dir).filter(file => !VARIANTS.some(({ ext }) => file.endsWith(ext)));
  const unhashed = unhashedFiles(files);
  if (unhashed.length > 0) {
    throw new Error(
      `These files are cached for good (A-7.9) but have no hash in their name: ${unhashed.join(', ')}`
    );
  }
  const results = [];
  for (const file of files) {
    const path = join(dir, file);
    const data = file === TEMPLATE || !COMPRESSIBLE.includes(extname(file).toLowerCase())
      ? undefined
      : readFileSync(path);
    if (data === undefined || data.length < MIN_BYTES) {
      // A variant from an earlier run would be sent in place of the file as it is now.
      for (const { ext } of VARIANTS) {
        rmSync(path + ext, { force: true });
      }
      continue;
    }
    const result = { file, bytes: data.length };
    for (const { ext, compress } of VARIANTS) {
      const compressed = compress(data);
      if (compressed.length < data.length) {
        writeFileSync(path + ext, compressed);
        result[ext.slice(1)] = compressed.length;
      } else {
        rmSync(path + ext, { force: true });
      }
    }
    results.push(result);
  }
  return results;
}

// Run as a script, wherever the workspace is: `import.meta.url` is percent-encoded
// and has its symbolic links resolved, `process.argv[1]` neither.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const dir = process.argv[2] ?? 'dist/apps/web/browser';
  try {
    const kb = bytes => (bytes === undefined ? '-' : (bytes / 1024).toFixed(1)).padStart(8);
    console.log(`${'file KB'.padStart(8)} ${'br KB'.padStart(8)} ${'gz KB'.padStart(8)}  file`);
    for (const { file, bytes, br, gz } of precompress(dir)) {
      console.log(`${kb(bytes)} ${kb(br)} ${kb(gz)}  ${file}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
