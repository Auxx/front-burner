import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRandom,
  fileContent,
  headOf,
  MAX_DEPTH,
  parseSizeOption,
  planRepo,
  shapeOf,
  shapeOfPlan,
  textPool,
  writeRepo
} from './large-repo.mjs';
import { WORKSPACE_ROOT } from './workspace.mjs';

describe('createRandom', () => {
  it('gives the same numbers for the same seed, in [0, 1)', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const numbers = Array.from({ length: 1000 }, () => a());
    expect(numbers).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(numbers.every(n => n >= 0 && n < 1)).toBe(true);
    expect(createRandom(8)()).not.toBe(numbers[0]);
  });
});

describe('planRepo', () => {
  it('has the shape of the plan: one folder per 22 files, 5 levels, 4 KB median, the total asked for', () => {
    const plan = planRepo({ seed: 1, files: 20_000, size: 240_000_000 });
    const shape = shapeOfPlan(plan);

    expect(shape.files).toBe(20_000);
    expect(shape.folders).toBe(900);
    expect(shape.maxDepth).toBe(MAX_DEPTH);
    expect(Math.abs(shape.totalBytes - 240_000_000) / 240_000_000).toBeLessThan(0.02);
    expect(shape.medianBytes).toBeGreaterThan(3000);
    expect(shape.medianBytes).toBeLessThan(5500);
    expect(new Set(plan.files.map(f => f.size)).size).toBeGreaterThan(5000);
    expect(shape.extensions.map(e => e.extension).slice(0, 3)).toEqual([ 'c', 'h', 'md' ]);
    const binary = plan.files.filter(f => f.binary).length;
    expect(binary).toBeGreaterThan(100);
    expect(binary).toBeLessThan(300);
  });

  it('is the same for the same seed and differs for another', () => {
    const options = { files: 500, size: 5_000_000 };
    expect(planRepo({ ...options, seed: 3 })).toEqual(planRepo({ ...options, seed: 3 }));
    expect(planRepo({ ...options, seed: 4 })).not.toEqual(planRepo({ ...options, seed: 3 }));
  });

  it('puts every folder under its parent, parents first, and every file in a folder', () => {
    const plan = planRepo({ seed: 2, files: 2000, size: 1_000_000 });
    const seen = new Set([ '' ]);
    for (const folder of plan.folders) {
      expect(seen.has(folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '')).toBe(true);
      seen.add(folder);
    }
    for (const file of plan.files) {
      expect(seen.has(file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '')).toBe(true);
    }
    expect(new Set(plan.files.map(f => f.path)).size).toBe(plan.files.length);
  });

  it('refuses no files or less than a byte each', () => {
    expect(() => planRepo({ files: 0 })).toThrow(/files/);
    expect(() => planRepo({ files: 10, size: 5 })).toThrow(/size/);
  });
});

describe('fileContent', () => {
  it('has the planned size and starts with the path, so that no two files are the same', () => {
    const pool = textPool(1, 10_000);
    const random = createRandom(1);
    const a = fileContent({ path: 'd1/f1.c', size: 30_000, binary: false }, 0, pool, random);
    const b = fileContent({ path: 'd1/f2.c', size: 30_000, binary: false }, 1, pool, random);
    const tiny = fileContent({ path: 'd1/f3.c', size: 3, binary: false }, 2, pool, random);
    const binary = fileContent({ path: 'f4.bin', size: 500, binary: true }, 3, pool, random);

    expect(a.length).toBe(30_000);
    expect(a.toString('utf8', 0, 12)).toBe('/* d1/f1.c *');
    expect(a.equals(b)).toBe(false);
    expect(tiny.length).toBe(3);
    expect(binary.length).toBe(500);
    expect(binary.toString('latin1', 0, 6)).toBe('f4.bin');
  });
});

describe('parseSizeOption', () => {
  it('reads bytes and 1000-based units', () => {
    expect(parseSizeOption('1000')).toBe(1000);
    expect(parseSizeOption('1.2GB')).toBe(1_200_000_000);
    expect(parseSizeOption('500 mb')).toBe(500_000_000);
    expect(parseSizeOption('3KB')).toBe(3000);
    expect(parseSizeOption('1.2TB')).toBeUndefined();
    expect(parseSizeOption('-1')).toBeUndefined();
  });
});

describe('writeRepo and shapeOf', () => {
  let dir;

  beforeEach(() => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    dir = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'large-repo-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the plan with one commit whose ID depends on the seed alone', () => {
    const plan = planRepo({ seed: 5, files: 300, size: 600_000 });
    const first = writeRepo(join(dir, 'a'), plan, { seed: 5 });
    const second = writeRepo(join(dir, 'b'), plan, { seed: 5 });

    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(second).toBe(first);
    expect(headOf(join(dir, 'a'))).toBe(first);
    const shape = shapeOf(join(dir, 'a'));
    expect(shape.files).toBeGreaterThanOrEqual(300);
    expect(shape.folders).toBe(plan.folders.length);
    expect(shape.totalBytes).toBeGreaterThanOrEqual(shapeOfPlan(plan).totalBytes);
  });

  it('refuses a folder that is not empty', () => {
    writeFileSync(join(dir, 'kept.txt'), 'mine');
    expect(() => writeRepo(dir, planRepo({ files: 10, size: 100 }))).toThrow(/not empty/);
  });

  it('leaves out .git and does not follow symbolic links', () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'a.md'), '12345');
    symlinkSync(WORKSPACE_ROOT, join(dir, 'link'));

    expect(shapeOf(dir)).toMatchObject({ files: 1, folders: 1, maxDepth: 1, totalBytes: 5 });
    expect(headOf(dir)).toBeUndefined();
  });
});
