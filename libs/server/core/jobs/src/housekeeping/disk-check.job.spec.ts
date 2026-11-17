import type { DiskMonitor } from '@front-burner/server-core-storage';
import type { JobRunner } from '../runner/job-runner';
import { JobTypeDefinition, RunningJob } from '../runner/job-types';
import { DiskCheckJob } from './disk-check.job';

describe('DiskCheckJob', () => {
  it('registers storage.disk-check every minute, which checks the disks', async () => {
    const register = vi.fn();
    const disks = { check: vi.fn().mockResolvedValue(undefined) };
    new DiskCheckJob(disks as unknown as DiskMonitor, { register } as unknown as JobRunner).onModuleInit();

    const definition = register.mock.calls[0][0] as JobTypeDefinition<unknown, void>;
    expect(definition).toMatchObject({
      type: 'storage.disk-check',
      pool: 'housekeeping',
      onInterrupted: 'requeue',
      repeatEveryMs: 60_000
    });
    expect(definition.spreadOnStart).toBeFalsy();

    await definition.handler({ payload: {} } as RunningJob);
    expect(disks.check).toHaveBeenCalledTimes(1);
  });

  it('registers nothing without the storage module, so that a test module needs no data directory', () => {
    const register = vi.fn();
    new DiskCheckJob(undefined, { register } as unknown as JobRunner).onModuleInit();
    expect(register).not.toHaveBeenCalled();
  });
});
