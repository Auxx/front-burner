import { GitEngine, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { WorkingTreeGuard } from './working-tree-guard';

describe('WorkingTreeGuard', () => {
  let merging: boolean;
  let lock: WorkingTreeLock;
  let guard: WorkingTreeGuard;

  beforeEach(() => {
    merging = false;
    lock = new WorkingTreeLock();
    const git = { mergeInProgress: vi.fn(async () => merging) } as unknown as GitEngine;
    guard = new WorkingTreeGuard(lock, git);
  });

  it('runs the change inside the lock', async () => {
    const order: string[] = [];
    let release = () => undefined as void;
    const held = lock.run(7, () => new Promise<void>(resolve => (release = () => resolve())));
    const change = guard.change(7, '/root', async () => {
      order.push('change');
      return 'done';
    });
    await Promise.resolve();
    order.push('released');
    release();
    await held;

    expect(await change).toBe('done');
    expect(order).toEqual([ 'released', 'change' ]);
  });

  it('refuses a change during a merge without running it', async () => {
    merging = true;
    const task = vi.fn();

    const error = await guard.change(7, '/root', task).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiErrorException);
    expect((error as ApiErrorException).getStatus()).toBe(409);
    expect((error as ApiErrorException).code).toBe('merge-in-progress');
    expect(task).not.toHaveBeenCalled();
    expect(lock.size).toBe(0);
  });

  it('checks for a merge only once it holds the lock', async () => {
    let release = () => undefined as void;
    const held = lock.run(7, () => new Promise<void>(resolve => (release = () => resolve())));
    const change = guard.change(7, '/root', async () => 'done').catch((thrown: unknown) => thrown);
    await Promise.resolve();
    // A merge queued ahead of the change starts it.
    merging = true;
    release();
    await held;

    expect(await change).toBeInstanceOf(ApiErrorException);
  });
});
