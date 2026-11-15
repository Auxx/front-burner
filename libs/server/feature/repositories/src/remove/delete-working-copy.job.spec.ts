import type { JobRunner, JobTypeDefinition, RunningJob } from '@front-burner/server-core-jobs';
import { DataLayout, newRemovedName, newTrashName } from '@front-burner/server-core-storage';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DELETE_WORKING_COPY_JOB_TYPE,
  DeleteWorkingCopyJob,
  DeleteWorkingCopyJobPayload
} from './delete-working-copy.job';

describe('DeleteWorkingCopyJob', () => {
  let dataDir: string;
  let layout: DataLayout;
  let definition: JobTypeDefinition<DeleteWorkingCopyJobPayload, void>;

  const run = (payload: DeleteWorkingCopyJobPayload) =>
    definition.handler(
      {
        id: 41,
        userId: null,
        repositoryId: null,
        payload,
        attempt: 1,
        signal: new AbortController().signal,
        reportProgress: vi.fn()
      } satisfies RunningJob<DeleteWorkingCopyJobPayload>
    );

  /** A folder with a file in `tmp/`. */
  const trash = (name: string) => {
    mkdirSync(join(layout.tmpDir, name, 'deep'), { recursive: true });
    writeFileSync(join(layout.tmpDir, name, 'deep', 'a.md'), 'a\n');
    return name;
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fb-delete-working-copy-'));
    layout = new DataLayout(dataDir);
    mkdirSync(layout.tmpDir, { recursive: true });
    const register = vi.fn();
    new DeleteWorkingCopyJob({ register } as unknown as JobRunner, layout).onModuleInit();
    definition = register.mock.calls[0]?.[0] as JobTypeDefinition<DeleteWorkingCopyJobPayload, void>;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('registers a housekeeping type that fails when interrupted', () => {
    expect(definition).toMatchObject({
      type: DELETE_WORKING_COPY_JOB_TYPE,
      pool: 'housekeeping',
      onInterrupted: 'fail'
    });
  });

  it('deletes the moved working copy and the repository\'s trashed folders', async () => {
    const removed = trash(newRemovedName(7));
    trash(newTrashName(7));
    const other = trash(newTrashName(8));

    await run({ repositoryId: 7, name: removed });

    expect(readdirSync(layout.tmpDir)).toEqual([ other ]);
  });

  it('empties the trash of a repository that had no working copy', async () => {
    trash(newTrashName(7));

    await run({ repositoryId: 7, name: null });

    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('refuses a name it did not make', async () => {
    mkdirSync(join(dataDir, 'repos', '3', '7'), { recursive: true });
    const kept = trash(newRemovedName(8));

    for (const name of [ '', '..', '../repos', newTrashName(7), `${newRemovedName(7)}/..`, kept ]) {
      await expect(run({ repositoryId: 7, name })).rejects.toThrow();
    }
    expect(readdirSync(layout.tmpDir)).toEqual([ kept ]);
    expect(readdirSync(join(dataDir, 'repos', '3'))).toEqual([ '7' ]);
  });
});
