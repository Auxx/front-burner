import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { precompress } from './precompress.mjs';

/** Text that compresses well, `bytes` long. */
const text = bytes => 'const answer = 42;\n'.repeat(Math.ceil(bytes / 19)).slice(0, bytes);

/** Bytes that do not compress: a xorshift sequence, the same on every run. */
function noise(bytes) {
  const data = Buffer.alloc(bytes);
  let x = 2463534242;
  for (let i = 0; i < bytes; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = x & 0xff;
  }
  return data;
}

describe('precompress', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'precompress-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(file, content) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }

  const files = () => readdirSync(dir, { recursive: true }).map(String).map(f => f.split('\\').join('/')).sort();

  it('writes .br and .gz next to each compressible file of 1 KB or more', () => {
    const js = text(4096);
    write('main-ABCD1234.js', js);
    write('styles-ABCD1234.css', text(2048));
    write('i18n/en.json', text(1024));
    write('assets/icons.svg', text(1500));
    write('chunk-SMALL123.js', text(1023));

    precompress(dir);

    expect(files()).toEqual([
      'assets',
      'assets/icons.svg',
      'assets/icons.svg.br',
      'assets/icons.svg.gz',
      'chunk-SMALL123.js',
      'i18n',
      'i18n/en.json',
      'i18n/en.json.br',
      'i18n/en.json.gz',
      'main-ABCD1234.js',
      'main-ABCD1234.js.br',
      'main-ABCD1234.js.gz',
      'styles-ABCD1234.css',
      'styles-ABCD1234.css.br',
      'styles-ABCD1234.css.gz'
    ]);
    expect(brotliDecompressSync(readFileSync(join(dir, 'main-ABCD1234.js.br'))).toString()).toBe(js);
    expect(gunzipSync(readFileSync(join(dir, 'main-ABCD1234.js.gz'))).toString()).toBe(js);
  });

  it('keeps a variant only when it is smaller', () => {
    write('chunk-NOISE123.js', noise(4096));
    write('chunk-NOISE123.js.gz', 'stale');

    const [ result ] = precompress(dir);

    expect(result).toEqual({ file: 'chunk-NOISE123.js', bytes: 4096 });
    expect(files()).toEqual([ 'chunk-NOISE123.js' ]);
  });

  it('leaves out index.html, images and fonts', () => {
    write('index.html', text(4096));
    write('assets/logo.png', text(4096));
    write('media/font-ABCD1234.woff2', text(4096));

    expect(precompress(dir)).toEqual([]);
    expect(files()).toEqual([
      'assets',
      'assets/logo.png',
      'index.html',
      'media',
      'media/font-ABCD1234.woff2'
    ]);
  });

  it('is the same on a second run', () => {
    write('main-ABCD1234.js', text(4096));
    const first = precompress(dir);
    const br = readFileSync(join(dir, 'main-ABCD1234.js.br'));

    expect(precompress(dir)).toEqual(first);
    expect(files()).toEqual([ 'main-ABCD1234.js', 'main-ABCD1234.js.br', 'main-ABCD1234.js.gz' ]);
    expect(readFileSync(join(dir, 'main-ABCD1234.js.br'))).toEqual(br);
  });

  it('removes a variant from an earlier run when the file is now under 1 KB, or left out', () => {
    write('i18n/en.json', text(900));
    write('i18n/en.json.br', 'stale');
    write('i18n/en.json.gz', 'stale');
    write('index.html', text(4096));
    write('index.html.gz', 'stale');

    precompress(dir);

    expect(files()).toEqual([ 'i18n', 'i18n/en.json', 'index.html' ]);
  });

  it('runs as a script from a path with a space and through a symbolic link', () => {
    const real = join(dir, 'a workspace');
    mkdirSync(real);
    copyFileSync(join(import.meta.dirname, 'precompress.mjs'), join(real, 'precompress.mjs'));
    symlinkSync(real, join(dir, 'linked'));
    const out = join(dir, 'out');
    mkdirSync(out);
    writeFileSync(join(out, 'main-ABCD1234.js'), text(4096));

    execFileSync(process.execPath, [ join(dir, 'linked', 'precompress.mjs'), out ]);

    expect(existsSync(join(out, 'main-ABCD1234.js.br'))).toBe(true);
    expect(existsSync(join(out, 'main-ABCD1234.js.gz'))).toBe(true);
  });

  it('fails when a root-level .js or .css file has no hash in its name', () => {
    write('main.js', text(4096));
    write('styles.css', text(4096));
    write('chunk-AB_-1234.js', text(4096));

    expect(() => precompress(dir)).toThrow(/main\.js, styles\.css$/);
    expect(existsSync(join(dir, 'chunk-AB_-1234.js.br'))).toBe(false);
  });

  it('fails when a file in media/ has no hash in its name', () => {
    write('media/font.woff2', 'x');
    write('assets/icons.svg', 'x');

    expect(() => precompress(dir)).toThrow(/media\/font\.woff2$/);
  });
});
