import { NetworkLock } from './network-lock';
import { WorkingTreeLock } from './working-tree-lock';

describe('NetworkLock', () => {
  let lock: NetworkLock;

  beforeEach(() => {
    lock = new NetworkLock();
  });

  it('runs one network task per repository at a time', async () => {
    const events: string[] = [];
    let release!: () => void;
    const first = lock.run(1, async () => {
      events.push('start push');
      await new Promise<void>(resolve => (release = resolve));
      events.push('end push');
    });
    const second = lock.run(1, async () => {
      events.push('fetch');
    });
    const other = lock.run(2, async () => {
      events.push('other repository');
    });

    await other;
    expect(events).toEqual([ 'start push', 'other repository' ]);
    release();
    await Promise.all([ first, second ]);
    expect(events).toEqual([ 'start push', 'other repository', 'end push', 'fetch' ]);
  });

  it('releases the lock when a task fails', async () => {
    const failing = lock.run(1, async () => {
      throw new Error('refused');
    });

    await expect(failing).rejects.toThrow('refused');
    await expect(lock.run(1, async () => 'next')).resolves.toBe('next');
    expect(lock.size).toBe(0);
  });

  it('does not wait for the working-tree lock (A-5.3)', async () => {
    const workingTree = new WorkingTreeLock();
    let release!: () => void;
    const save = workingTree.run(1, () => new Promise<void>(resolve => (release = resolve)));

    await expect(lock.run(1, async () => 'pushed')).resolves.toBe('pushed');
    release();
    await save;
  });
});
