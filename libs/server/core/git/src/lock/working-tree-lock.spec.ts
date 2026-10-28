import { WorkingTreeLock } from './working-tree-lock';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('WorkingTreeLock', () => {
  let lock: WorkingTreeLock;

  beforeEach(() => {
    lock = new WorkingTreeLock();
  });

  it('runs tasks for one repository one at a time in order', async () => {
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await delay(ms);
      events.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([
      lock.run(1, task('1', 30)),
      lock.run(1, task('2', 10)),
      lock.run(1, task('3', 0))
    ]);

    expect(results).toEqual([ '1', '2', '3' ]);
    expect(events).toEqual([ 'start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3' ]);
  });

  it('does not make other repositories wait', async () => {
    const events: string[] = [];
    let release!: () => void;
    const blocked = lock.run(1, () => new Promise<void>(resolve => (release = resolve)));

    await lock.run(2, async () => {
      events.push('other repository');
    });

    expect(events).toEqual([ 'other repository' ]);
    release();
    await blocked;
  });

  it('releases the lock when a task throws', async () => {
    const failing = lock.run(1, async () => {
      throw new Error('boom');
    });
    const next = lock.run(1, async () => 'next');
    const throwingSync = lock.run(1, () => {
      throw new Error('sync boom');
    });
    const last = lock.run(1, async () => 'last');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
    await expect(throwingSync).rejects.toThrow('sync boom');
    await expect(last).resolves.toBe('last');
  });

  it('forgets idle repositories', async () => {
    const first = lock.run(1, () => delay(5));
    const second = lock.run(2, async () => {
      throw new Error('boom');
    });

    expect(lock.size).toBe(2);
    await first;
    await expect(second).rejects.toThrow('boom');
    expect(lock.size).toBe(0);
  });
});
