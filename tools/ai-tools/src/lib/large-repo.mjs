import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The defaults: about the size of spike 4's shallow Linux clone (A-5.14). */
export const DEFAULT_FILES = 100_000;
export const DEFAULT_SIZE = 1.2 * 1000 ** 3;
export const DEFAULT_SEED = 1;
export const DEFAULT_OUT = 'tmp/ai-tools/large-repo';
/** About 22 files per folder, as in a Linux tree: 4,500 folders for 100,000 files. */
const FILES_PER_FOLDER = 22.2;
export const MAX_DEPTH = 5;
/** A median of 4 KB and a mean three times as large give spike 4's 1.2 GB for 100,000 files. */
const MEDIAN_SIZE = 4096;
const MEAN_TO_MEDIAN = 3;
const MAX_FILE_SIZE = 8 * 1024 ** 2;
/** The share of binary files and the text extensions, by weight. */
const BINARY_SHARE = 0.01;
const TEXT_KINDS = [ [ 'c', 0.45 ], [ 'h', 0.3 ], [ 'md', 0.2 ], [ 'txt', 0.05 ] ];
const BINARY_KINDS = [ 'png', 'bin' ];
/** Fixed author, committer and dates, so that one seed always gives one commit ID. */
const COMMIT_ENV = {
  GIT_AUTHOR_NAME: 'Front Burner perf',
  GIT_AUTHOR_EMAIL: 'perf@example.invalid',
  GIT_COMMITTER_NAME: 'Front Burner perf',
  GIT_COMMITTER_EMAIL: 'perf@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
};
const GIT_CONFIG = [ '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main' ];

/** A seeded random number generator (mulberry32): numbers in [0, 1). */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal number from two uniform ones (Box–Muller). */
function normal(random) {
  const u = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function pick(random, weighted) {
  let r = random();
  for (const [ value, weight ] of weighted) {
    r -= weight;
    if (r < 0) {
      return value;
    }
  }
  return weighted.at(-1)[0];
}

/**
 * The repository to write: its folders (paths relative to its root, parents
 * first) and files (path, size in bytes, binary or not), from the seed alone.
 * Each new folder goes under a random folder less than `MAX_DEPTH` deep, so
 * the tree is bushy near the top and about five levels deep. File sizes are
 * log-normal with a median of 4 KB, scaled so that their mean is `size / files`.
 */
export function planRepo({ seed = DEFAULT_SEED, files = DEFAULT_FILES, size = DEFAULT_SIZE } = {}) {
  if (!Number.isInteger(files) || files < 1) {
    throw new Error(`files must be a whole number of at least 1: ${files}`);
  }
  if (!Number.isFinite(size) || size < files) {
    throw new Error(`size must be at least one byte per file: ${size}`);
  }
  const random = createRandom(seed);
  const folders = [ { path: '', depth: 0 } ];
  const open = [ folders[0] ];
  const folderCount = Math.max(1, Math.round(files / FILES_PER_FOLDER));
  for (let i = 1; i < folderCount; i++) {
    const parent = open[Math.floor(random() * open.length)];
    const name = `d${i.toString(36)}`;
    const folder = { path: parent.path === '' ? name : `${parent.path}/${name}`, depth: parent.depth + 1 };
    folders.push(folder);
    if (folder.depth < MAX_DEPTH) {
      open.push(folder);
    }
  }

  // The mean of a log-normal is its median times exp(σ²/2).
  const sigma = Math.sqrt(2 * Math.log(MEAN_TO_MEDIAN));
  const mu = Math.log(size / files / (MEDIAN_SIZE * MEAN_TO_MEDIAN));
  const raw = [];
  for (let i = 0; i < files; i++) {
    const folder = folders[Math.floor(random() * folders.length)];
    const binary = random() < BINARY_SHARE;
    const extension = binary ? BINARY_KINDS[Math.floor(random() * BINARY_KINDS.length)] : pick(random, TEXT_KINDS);
    const name = `f${i.toString(36)}.${extension}`;
    raw.push({
      path: folder.path === '' ? name : `${folder.path}/${name}`,
      size: Math.exp(Math.log(MEDIAN_SIZE) + mu + sigma * normal(random)),
      binary
    });
  }
  // Scale to the total asked for, since the sample's mean is only near the distribution's.
  const scale = size / raw.reduce((sum, file) => sum + file.size, 0);
  const planned = raw.map(file => ({
    ...file,
    size: Math.min(MAX_FILE_SIZE, Math.max(1, Math.round(file.size * scale)))
  }));
  return { folders: folders.slice(1).map(folder => folder.path), files: planned };
}

const WORDS = (
  'static int void struct return const unsigned long char if else for while size buffer page node list lock '
  + 'device driver memory error value count index offset table entry flags state queue read write open close '
  + 'the a of to and in is that it with as for on this be are by'
).split(' ');

/**
 * Text to cut file contents from: seeded lines of words, so that git
 * compresses them about as it compresses source code.
 */
export function textPool(seed, bytes = 1024 ** 2) {
  const random = createRandom(seed ^ 0x5eed);
  const lines = [];
  let length = 0;
  while (length < bytes) {
    const words = [];
    const count = 3 + Math.floor(random() * 10);
    for (let i = 0; i < count; i++) {
      words.push(WORDS[Math.floor(random() * WORDS.length)]);
    }
    const line = `${'\t'.repeat(Math.floor(random() * 3))}${words.join(' ')};\n`;
    lines.push(line);
    length += line.length;
  }
  return Buffer.from(lines.join(''), 'utf8');
}

/**
 * A file's content: its path first, so that no two files are the same, then
 * text from the pool or, for a binary file, seeded random bytes.
 */
export function fileContent(file, index, pool, random) {
  const header = Buffer.from(file.binary ? '' : `/* ${file.path} */\n`, 'utf8');
  const content = Buffer.alloc(file.size);
  if (file.binary) {
    for (let i = 0; i < content.length; i++) {
      content[i] = Math.floor(random() * 256);
    }
    content.write(file.path, 0, 'latin1');
    return content;
  }
  header.copy(content, 0, 0, Math.min(header.length, content.length));
  let at = header.length;
  let from = (index * 7919) % pool.length;
  while (at < content.length) {
    const n = Math.min(content.length - at, pool.length - from);
    pool.copy(content, at, from, from + n);
    at += n;
    from = 0;
  }
  return content;
}

function git(cwd, args, env = {}) {
  return execFileSync('git', [ ...GIT_CONFIG, ...args ], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    maxBuffer: 64 * 1024 ** 2
  }).trim();
}

/**
 * Writes the planned repository to `out` (absolute, missing or empty), adds
 * every file and makes one commit. Returns the commit ID.
 */
export function writeRepo(out, plan, { seed = DEFAULT_SEED, onProgress = () => undefined } = {}) {
  if (existsSync(out) && readdirSync(out).length > 0) {
    throw new Error(`The output folder is not empty: ${out}. Delete it or name another with --out.`);
  }
  mkdirSync(out, { recursive: true });
  git(out, [ 'init', '-q' ]);
  for (const folder of plan.folders) {
    mkdirSync(join(out, folder));
  }
  const pool = textPool(seed);
  const random = createRandom(seed ^ 0xb1a5);
  plan.files.forEach((file, index) => {
    writeFileSync(join(out, file.path), fileContent(file, index, pool, random), { mode: 0o644 });
    if ((index + 1) % 10_000 === 0) {
      onProgress(index + 1);
    }
  });
  // An empty folder is not in a commit: give it a file, as a real tree has none.
  for (const folder of plan.folders) {
    if (readdirSync(join(out, folder)).length === 0) {
      writeFileSync(join(out, folder, 'README.md'), `# ${folder}\n`, { mode: 0o644 });
    }
  }
  git(out, [ 'add', '-A' ]);
  git(out, [ 'commit', '-q', '-m', `Generated repository (seed ${seed})` ], COMMIT_ENV);
  return git(out, [ 'rev-parse', 'HEAD' ]);
}

/**
 * The shape of a repository on disk, `.git` left out and symbolic links not
 * followed: files, folders, depth, sizes and the most common extensions.
 */
export function shapeOf(root) {
  const sizes = [];
  const extensions = new Map();
  let folders = 0;
  let maxDepth = 0;
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (depth === 0 && entry.name === '.git') {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        folders++;
        maxDepth = Math.max(maxDepth, depth + 1);
        walk(path, depth + 1);
      } else if (entry.isFile()) {
        sizes.push(lstatSync(path).size);
        const dot = entry.name.lastIndexOf('.');
        const extension = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '(none)';
        extensions.set(extension, (extensions.get(extension) ?? 0) + 1);
      }
    }
  };
  walk(root, 0);
  return summarise(sizes, folders, maxDepth, extensions);
}

/** The shape of a plan, as `shapeOf` reports a repository on disk. */
export function shapeOfPlan(plan) {
  const extensions = new Map();
  for (const file of plan.files) {
    const extension = file.path.slice(file.path.lastIndexOf('.') + 1);
    extensions.set(extension, (extensions.get(extension) ?? 0) + 1);
  }
  const maxDepth = Math.max(0, ...plan.folders.map(folder => folder.split('/').length));
  return summarise(plan.files.map(file => file.size), plan.folders.length, maxDepth, extensions);
}

function summarise(sizes, folders, maxDepth, extensions) {
  const sorted = [ ...sizes ].sort((a, b) => a - b);
  const total = sorted.reduce((sum, size) => sum + size, 0);
  return {
    files: sorted.length,
    folders,
    maxDepth,
    totalBytes: total,
    medianBytes: sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)],
    meanBytes: sorted.length === 0 ? 0 : Math.round(total / sorted.length),
    maxBytes: sorted.at(-1) ?? 0,
    extensions: [ ...extensions ].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([ extension, count ]) => ({ extension, count }))
  };
}

/** The commit ID of a repository's `HEAD`, or undefined when it has none; never a parent folder's repository. */
export function headOf(root) {
  try {
    return git(root, [ 'rev-parse', '--verify', '-q', 'HEAD' ], { GIT_DIR: join(root, '.git') }) || undefined;
  } catch {
    return undefined;
  }
}

/** A size such as `1.2GB`, `500MB` or `1000000`, in bytes (1000-based, as git and `du --si` print). */
export function parseSizeOption(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB)?$/i.exec(String(value).trim());
  if (!match) {
    return undefined;
  }
  const unit = { KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 }[match[2]?.toUpperCase()] ?? 1;
  return Math.round(Number(match[1]) * unit);
}
