import { GitMerge } from '@front-burner/server-core-git';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { InstanceRepositories } from '@front-burner/server-feature-repositories';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';

/**
 * On start, each working copy returns to a known state (A-5.15, NF-9.4, NF-9.5):
 * stale locks go, a merge that was cut short is undone, a merge waiting for the
 * user stays, the index is refreshed, and the record's ref matches the database.
 *
 * `merge_applying` tells the two kinds of merge apart. With the flag still set,
 * nothing was resolved yet, even if git got as far as a `MERGE_HEAD`, so the
 * merge is undone and the user can pull again. A repository cannot be used while
 * the flag is set: when an undo fails, it gets the status Error (RM-6) until an
 * undo works, here at a later start. So the files a reset would replace can't
 * be the user's. As a last check, a `HEAD` that no merge of the recorded commit
 * explains is left alone, since a reset would drop those commits.
 *
 * Runs in `onModuleInit`, which Nest awaits before any `onApplicationBootstrap`:
 * the job runner starts in that hook, and until then no git command runs, so the
 * locks really are stale and no job sees a working copy halfway through this.
 */
@Injectable()
export class WorkingCopyRecovery implements OnModuleInit {
  private readonly logger = new Logger(WorkingCopyRecovery.name);

  constructor(
    private readonly instance: InstanceRepositories,
    private readonly merges: GitMerge,
    private readonly syncState: SyncStateStore,
    private readonly mergeRecord: MergeRecord,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /** One working copy at a time; one that fails is logged, and stops neither the others nor the start. */
  async onModuleInit(): Promise<void> {
    const undoFailedEarlier = this.instance.damaged().filter(({ id }) => this.syncState.record(id).applying);
    for (const { id, userId } of [ ...this.instance.ready(), ...undoFailedEarlier ]) {
      const workingCopy = this.layout.workingCopy(userId, id);
      // `WorkingCopyCheck` reports one that is gone (RM-6).
      if (!existsSync(join(workingCopy, '.git'))) {
        continue;
      }
      try {
        await this.recover(id, workingCopy);
      } catch (error) {
        this.logger.warn(`Recovery of repository ${id} failed: ${String(error)}`);
        if (this.syncState.record(id).applying) {
          this.instance.markDamaged(id);
        }
      }
    }
  }

  private async recover(repositoryId: number, workingCopy: string): Promise<void> {
    await this.merges.removeStaleLocks(workingCopy);
    await this.endMergeCutShort(repositoryId, workingCopy);
    await this.merges.refreshIndex(workingCopy);
    await this.mergeRecord.matchRef(repositoryId, workingCopy);
  }

  /**
   * The status changes before the flag: a crash between the two only repeats this
   * at the next start, where the other order would leave the repository blocked.
   */
  private async endMergeCutShort(repositoryId: number, workingCopy: string): Promise<void> {
    const { applying, recordedCommit } = this.syncState.record(repositoryId);
    if (!applying || recordedCommit === null) {
      return;
    }
    if (await this.merges.isCutShort(workingCopy, recordedCommit)) {
      await this.merges.undoCutShort(workingCopy, recordedCommit);
      this.instance.markRepaired(repositoryId);
      await this.mergeRecord.restoreEarlier(repositoryId, workingCopy);
      this.logger.log({ repositoryId, commit: recordedCommit }, 'A merge that was cut short was undone');
    } else {
      // A fast-forward that finished, as moving the branch is its last step, or
      // something this code does not know about. Either way, the branch has moved on.
      this.instance.markRepaired(repositoryId);
      await this.mergeRecord.forget(repositoryId, workingCopy);
      this.logger.warn(`Repository ${repositoryId} has moved past its recorded commit; nothing was undone`);
    }
  }
}
