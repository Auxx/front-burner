import type { JobRunner, JobTypeDefinition, RunningJob } from '@front-burner/server-core-jobs';
import { DataLayout } from '@front-burner/server-core-storage';
import { Logger } from '@nestjs/common';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteFolderJob } from './delete-folder.job';
import { DELETE_FOLDER_JOB_TYPE, DeleteFolderJobPayload } from './entry-delete';

const TRASH = 'delete-7-0b6f4f3c-6d1e-4f7a-9c2b-1d2e3f4a5b6c';

describe('DeleteFolderJob', () => {
  let dataDir: string;
  let layout: DataLayout;
  let definition: JobTypeDefinition<DeleteFolderJobPayload, void>;

  const run = (name: string) =>
    definition.handler(
      {
        id: 41,
        userId: null,
        payload: { name },
        attempt: 1,
        signal: new AbortController().signal,
        reportProgress: vi.fn()
      } satisfies RunningJob<DeleteFolderJobPayload>
    );

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fb-delete-job-spec-'));
    layout = new DataLayout(dataDir);
    mkdirSync(join(layout.tmpDir, TRASH, 'deep'), { recursive: true });
    writeFileSync(join(layout.tmpDir, TRASH, 'deep', 'a.md'), 'a\n');
    const register = vi.fn();
    new DeleteFolderJob({ register } as unknown as JobRunner, layout).onModuleInit();
    definition = register.mock.calls[0]?.[0] as JobTypeDefinition<DeleteFolderJobPayload, void>;
  });

  afterEach(() => {
    chmodSync(join(layout.tmpDir), 0o755);
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('registers a housekeeping type that fails when interrupted', () => {
    expect(definition).toMatchObject({ type: DELETE_FOLDER_JOB_TYPE, pool: 'housekeeping', onInterrupted: 'fail' });
  });

  it('removes the trashed folder', async () => {
    await run(TRASH);

    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('refuses a payload name that is not a trash name', async () => {
    mkdirSync(join(dataDir, 'repos', '3', '7'), { recursive: true });

    for (
      const name of [
        '',
        '..',
        '../repos',
        'clone-1',
        `${TRASH}/deep`,
        `${TRASH}/..`,
        'delete-x',
        'delete-0b6f4f3c-6d1e-4f7a-9c2b-1d2e3f4a5b6c'
      ]
    ) {
      await expect(run(name)).rejects.toThrow();
    }
    expect(readdirSync(layout.tmpDir)).toEqual([ TRASH ]);
    expect(readdirSync(join(dataDir, 'repos', '3'))).toEqual([ '7' ]);
  });

  it('logs a failed removal without failing the delete', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // An unwritable tmp/ keeps the trashed folder from being unlinked from it.
    chmodSync(layout.tmpDir, 0o555);

    await expect(run(TRASH)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith('Delete folder job 41 could not remove its folder');
    expect(readdirSync(layout.tmpDir)).toEqual([ TRASH ]);
  });
});
