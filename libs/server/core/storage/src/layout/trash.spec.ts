import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataLayout } from './data-layout';
import { emptyTrashOf, isRemovedName, isTrashName, newRemovedName, newTrashName } from './trash';

describe('trash', () => {
  let dataDir: string;
  let layout: DataLayout;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fb-trash-spec-'));
    layout = new DataLayout(dataDir);
    mkdirSync(layout.tmpDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('names a trashed folder after its repository and a random UUID', () => {
    const name = newTrashName(7);

    expect(name).toMatch(/^delete-7-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newTrashName(7)).not.toBe(name);
    expect(isTrashName(name)).toBe(true);
  });

  it('recognises only the names it makes', () => {
    for (
      const name of [ '', '..', 'clone-1', 'delete-x', 'delete-7', `${newTrashName(7)}/..`, `../${newTrashName(7)}` ]
    ) {
      expect(isTrashName(name), name).toBe(false);
    }
  });

  it('names a removed working copy after its repository and a random UUID', () => {
    const name = newRemovedName(7);

    expect(name).toMatch(/^remove-7-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newRemovedName(7)).not.toBe(name);
    expect(isRemovedName(name)).toBe(true);
    expect(isTrashName(name)).toBe(false);
    expect(isRemovedName(newTrashName(7))).toBe(false);
  });

  it('recognises only the removed names it makes', () => {
    for (
      const name of [ '', '..', 'remove-x', 'remove-7', `${newRemovedName(7)}/..`, `../${newRemovedName(7)}` ]
    ) {
      expect(isRemovedName(name), name).toBe(false);
    }
  });

  it('empties the trash of one repository only', async () => {
    const [ first, second, other ] = [ newTrashName(7), newTrashName(7), newTrashName(71) ];
    for (const name of [ first, second, other ]) {
      mkdirSync(join(layout.tmpDir, name as string, 'deep'), { recursive: true });
      writeFileSync(join(layout.tmpDir, name as string, 'deep', 'a.md'), 'a\n');
    }
    mkdirSync(join(layout.tmpDir, 'clone-7'));

    await emptyTrashOf(layout, 7);

    expect(readdirSync(layout.tmpDir).sort()).toEqual([ 'clone-7', other ].sort());
  });

  it('does nothing when tmp/ is missing', async () => {
    rmSync(layout.tmpDir, { recursive: true });

    await expect(emptyTrashOf(layout, 7)).resolves.toBeUndefined();
  });
});
