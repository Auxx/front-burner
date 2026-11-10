import { GitEngine, GitMerge, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { WorkingTreeGuard } from './working-tree-guard';

describe('WorkingTreeGuard', () => {
  let merging: boolean;
  let mergingOnly: boolean;
  let unresolved: boolean;
  let lock: WorkingTreeLock;
  let guard: WorkingTreeGuard;

  beforeEach(() => {
    merging = false;
    mergingOnly = false;
    unresolved = false;
    lock = new WorkingTreeLock();
    const git = {
      mergeInProgress: vi.fn(async () => merging),
      isUnresolved: vi.fn(async () => unresolved)
    } as unknown as GitEngine;
    const merge = { mergeInProgress: vi.fn(async () => mergingOnly) } as unknown as GitMerge;
    guard = new WorkingTreeGuard(lock, git, merge);
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

  it('allows changeFile for an unresolved conflicting file during a merge', async () => {
    merging = true;
    mergingOnly = true;
    unresolved = true;
    const task = vi.fn().mockResolvedValue('saved');

    const result = await guard.changeFile(7, '/root', 'conflict.md', task);

    expect(result).toBe('saved');
    expect(task).toHaveBeenCalled();
  });

  it('refuses changeFile for a non-conflicting file during a merge', async () => {
    merging = true;
    mergingOnly = true;
    unresolved = false;
    const task = vi.fn();

    const error = await guard.changeFile(7, '/root', 'clean.md', task).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiErrorException);
    expect((error as ApiErrorException).getStatus()).toBe(409);
    expect((error as ApiErrorException).code).toBe('merge-in-progress');
    expect(task).not.toHaveBeenCalled();
  });

  it('allows changeFile during a rebase (GitEngine says merging, GitMerge does not)', async () => {
    // A rebase sets GitEngine.mergeInProgress (MERGE_HEAD + REBASE_HEAD),
    // but GitMerge.mergeInProgress checks only MERGE_HEAD — it returns false
    // when there's no actual merge. changeFile uses GitMerge, so it allows the save.
    merging = true;
    mergingOnly = false;
    const task = vi.fn().mockResolvedValue('saved');

    const result = await guard.changeFile(7, '/root', 'any.md', task);

    expect(result).toBe('saved');
    expect(task).toHaveBeenCalled();
  });

  it('allows changeFile when there is no merge in progress', async () => {
    merging = false;
    mergingOnly = false;
    const task = vi.fn().mockResolvedValue('saved');
    const isUnresolved = vi.fn().mockResolvedValue(false);
    const git = { mergeInProgress: vi.fn().mockResolvedValue(merging), isUnresolved } as unknown as GitEngine;
    const merge = { mergeInProgress: vi.fn().mockResolvedValue(mergingOnly) } as unknown as GitMerge;
    const guardWithMock = new WorkingTreeGuard(new WorkingTreeLock(), git, merge);

    const result = await guardWithMock.changeFile(7, '/root', 'any.md', task);

    expect(result).toBe('saved');
    expect(task).toHaveBeenCalled();
    // isUnresolved is not called when not merging
    expect(isUnresolved).not.toHaveBeenCalled();
  });

  it('refuses changeFile for a file resolved on another device', async () => {
    merging = true;
    mergingOnly = true;
    // File was unresolved when the client read it, but is now resolved.
    unresolved = false;
    const task = vi.fn();

    const error = await guard.changeFile(7, '/root', 'conflict.md', task).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiErrorException);
    expect((error as ApiErrorException).getStatus()).toBe(409);
    expect((error as ApiErrorException).code).toBe('merge-in-progress');
    expect(task).not.toHaveBeenCalled();
  });

  it('checks for a merge inside the lock, not before', async () => {
    let release = () => undefined as void;
    const held = lock.run(7, () => new Promise<void>(resolve => (release = () => resolve())));
    const changeFile = guard.changeFile(7, '/root', 'conflict.md', async () => 'done').catch((thrown: unknown) =>
      thrown
    );
    await Promise.resolve();
    // A merge starts while changeFile is waiting for the lock.
    merging = true;
    mergingOnly = true;
    unresolved = false;
    release();
    await held;

    // Because the check runs inside the lock (after release), it sees the merge
    // and refuses the save. If it ran before the lock, mergingOnly would still be
    // false and the save would go through.
    expect(await changeFile).toBeInstanceOf(ApiErrorException);
  });
});
