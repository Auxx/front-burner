import { GitMerge, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { MergeGuard } from './merge-guard';

const REPOSITORY = 7;

describe('MergeGuard', () => {
  const task = vi.fn(async () => 'done');
  let inProgress: boolean;
  let lock: WorkingTreeLock;
  let guard: MergeGuard;

  beforeEach(() => {
    task.mockClear();
    inProgress = true;
    lock = new WorkingTreeLock();
    guard = new MergeGuard(lock, { mergeInProgress: async () => inProgress } as unknown as GitMerge);
  });

  it('runs the task during a merge, and gives its result', async () => {
    await expect(guard.change(REPOSITORY, '/work', task)).resolves.toBe('done');
    expect(task).toHaveBeenCalledOnce();
  });

  it('refuses the task when there is no merge', async () => {
    inProgress = false;

    const refusal = await guard.change(REPOSITORY, '/work', task).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiErrorException);
    expect(refusal).toMatchObject({ status: 409, code: 'no-merge-in-progress' });
    expect(task).not.toHaveBeenCalled();
  });

  it('checks inside the lock, so that a merge ended by the one before it counts', async () => {
    const first = lock.run(REPOSITORY, async () => {
      inProgress = false;
    });

    const refusal = await guard.change(REPOSITORY, '/work', task).catch((error: unknown) => error);
    await first;

    expect(refusal).toMatchObject({ code: 'no-merge-in-progress' });
    expect(task).not.toHaveBeenCalled();
  });
});
