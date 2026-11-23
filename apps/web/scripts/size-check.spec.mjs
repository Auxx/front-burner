import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialScripts } from './size-check.mjs';

describe('size-check', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'size-check-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the scripts and module preloads that index.html loads', () => {
    const html = '<script src="main-A.js" type="module"></script><link rel="modulepreload" href="chunk-B.js">'
      + '<link rel="stylesheet" href="styles-C.css"><script src="https://cdn.example/x.js"></script>';
    expect(initialScripts(html)).toEqual([ 'main-A.js', 'chunk-B.js' ]);
  });

  it('runs as a script from a path with a space and through a symbolic link', () => {
    const real = join(dir, 'a workspace');
    mkdirSync(real);
    copyFileSync(join(import.meta.dirname, 'size-check.mjs'), join(real, 'size-check.mjs'));
    symlinkSync(real, join(dir, 'linked'));
    const out = join(dir, 'out');
    mkdirSync(out);
    writeFileSync(join(out, 'index.html'), '<script src="main-A.js" type="module"></script>');
    writeFileSync(join(out, 'main-A.js'), 'console.log(1);');

    const output = execFileSync(process.execPath, [ join(dir, 'linked', 'size-check.mjs'), out ], { encoding: 'utf8' });

    expect(output).toContain('initial total');
  });
});
