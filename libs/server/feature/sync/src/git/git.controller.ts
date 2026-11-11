import { EventsHub } from '@front-burner/server-core-events';
import { GitBranches, GitEngine, GitMerge, GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { authOf } from '@front-burner/server-core-security';
import { inBatches, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { OpenableRepository, toFilesError, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type {
  CommitResult,
  GitBranchList,
  GitDiff,
  GitIncoming,
  GitJobStarted,
  GitJobState,
  GitMergeState,
  GitMergeVersion,
  GitStatus
} from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { FetchScheduler } from '../fetch/fetch-scheduler';
import { FetchService } from '../fetch/fetch.service';
import { GitJobs } from '../jobs/git-jobs.service';
import { MergeActions } from '../merge/merge-actions.service';
import { MergeStateService } from '../merge/merge-state.service';
import { PullService } from '../pull/pull.service';
import { sameNameRemote } from '../pull/same-name-remote';
import { PushService } from '../push/push.service';
import { SyncStateStore } from '../state/sync-state.store';
import { toGitApiError } from './git-api-errors';
import {
  CommitRequestDto,
  CommitResultDto,
  GitBranchListDto,
  GitConflictPathDto,
  GitDiffDto,
  GitDiffQueryDto,
  GitIncomingDto,
  GitIncomingQueryDto,
  GitJobParamsDto,
  GitJobStartedDto,
  GitJobStateDto,
  GitMergeCommitRequestDto,
  GitMergeStateDto,
  GitMergeVersionDto,
  GitMergeVersionQueryDto,
  GitNewBranchRequestDto,
  GitPathsDto,
  GitResolveRequestDto,
  GitStatusDto,
  GitSwitchRequestDto
} from './git.dto';

/**
 * Refuses a path that is malformed, inside `.git` or through a symbolic link
 * (A-7.6). A missing path is fine: a deleted file, or a file of a deleted
 * folder, is a change too, and the engine ignores paths that are not changes.
 */
async function checkPath(root: string, path: string, linkOnTheWay = false): Promise<void> {
  try {
    await resolveInWorkingCopy(root, path, { symlinkLeaf: true, mayBeMissing: true });
  } catch (error) {
    const allowed = error instanceof PathRefusedError
      && (error.reason === 'not-found' || (linkOnTheWay && error.reason === 'symlink'));
    if (!allowed) {
      toFilesError(error);
    }
  }
}

const checkPaths = (root: string, paths: string[]) => inBatches(paths, path => checkPath(root, path));

/**
 * As `checkPaths`, for a discard: a path through a symbolic link is fine when a
 * folder on the way is in the list too. That is how a new link stands where a
 * deleted file's folder was. The engine acts only on changes that status lists,
 * which never reach through a link, and deletes the link first; a link that is
 * not in the list blocks the discard.
 */
function checkDiscardPaths(root: string, paths: string[]): Promise<void> {
  const listed = new Set(paths);
  const hasListedFolder = (path: string) => {
    const segments = path.split('/');
    return segments.some((_, depth) => depth > 0 && listed.has(segments.slice(0, depth).join('/')));
  };
  return inBatches(paths, path => checkPath(root, path, hasListedFolder(path)));
}

/**
 * Answers a failed branch action. Git refuses before it changes anything, except
 * when it was killed at its timeout: then `onChange` runs, as it may have.
 */
const mayHaveChanged = (onChange: () => void) => (error: unknown): never => {
  if (error instanceof GitOperationError && error.code === 'timeout') {
    onChange();
  }
  return toGitApiError(error);
};

/** Git in the logged-in user's working copies (REQ-GIT-002). */
@ApiTags('git')
@Controller('repositories/:id/git')
export class GitController {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly engine: GitEngine,
    private readonly guard: WorkingTreeGuard,
    private readonly commitAuthors: CommitAuthors,
    private readonly events: EventsHub,
    private readonly merge: GitMerge,
    private readonly branches: GitBranches,
    private readonly pushes: PushService,
    private readonly pulls: PullService,
    private readonly fetches: FetchService,
    private readonly fetchScheduler: FetchScheduler,
    private readonly gitJobs: GitJobs,
    private readonly syncState: SyncStateStore,
    private readonly mergeState: MergeStateService,
    private readonly mergeActions: MergeActions
  ) {}

  /**
   * The branch, its counts against the upstream, whether an unpublished branch
   * has a remote branch of its name to pull, every changed file, whether the
   * last commit can be amended, the push, fetch or pull under way, and why the
   * last fetch failed (GA-7 to GA-9, GA-11, GA-22, GA-35, GA-42).
   */
  @Get('status')
  @ApiOkResponse({ type: GitStatusDto })
  @ZodSerializerDto(GitStatusDto)
  async gitStatus(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<GitStatus> {
    const { userId } = authOf(req);
    const root = this.repositories.root(userId, params.id);
    const [ status, mergeInProgress, lastCommit ] = await Promise.all([
      this.engine.status(root),
      this.engine.mergeInProgress(root),
      this.engine.lastCommit(root)
    ]);
    return {
      ...status,
      sameNameRemote: await sameNameRemote(this.merge, root, status),
      mergeInProgress,
      lastCommit,
      networkJob: this.gitJobs.networkJob(userId, params.id),
      fetchProblem: this.syncState.fetchProblem(params.id)
    };
  }

  /**
   * The local branches with the current one, and the remote branches that no
   * local branch has the name of or tracks, as of the last fetch (GA-36). Before
   * the first commit, the current branch is `main` (GA-42). `singleBranch` says
   * that other remote branches aren't available (GA-41).
   */
  @Get('branches')
  @ApiOkResponse({ type: GitBranchListDto })
  @ZodSerializerDto(GitBranchListDto)
  async gitBranches(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<GitBranchList> {
    const { row, root } = this.repositories.open(authOf(req).userId, params.id);
    const list = await this.branches.list(root).catch(toGitApiError);
    return { ...list, singleBranch: row.cloneMode === 'single-branch' };
  }

  /**
   * Makes a branch from the current commit and switches to it, keeping any
   * uncommitted changes; unpublished until its first push (GA-38). Refused during
   * a merge (GA-4), without commits, as the first commit makes `main` whatever the
   * branch is called (GA-42), and with `branch-name-invalid`, `branch-exists`,
   * `branch-name-conflict` or `git-busy`. Clients are told also after `git-timeout`,
   * as the branch may have been made and be current.
   */
  @Post('branches')
  @HttpCode(204)
  @ApiNoContentResponse()
  async createBranch(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: GitNewBranchRequestDto
  ): Promise<void> {
    const { userId } = authOf(req);
    const root = this.repositories.root(userId, params.id);
    let changed = false;
    try {
      await this.guard.change(params.id, root, async () => {
        await this.branches.create(root, body.name).catch(mayHaveChanged(() => (changed = true)));
        changed = true;
      });
    } finally {
      if (changed) {
        // No file changed.
        this.events.publish(userId, { type: 'git.changed', repositoryId: params.id });
      }
    }
  }

  /**
   * Switches to a local branch, or with `remote`, makes a local branch that tracks
   * a branch of `origin` and switches to it (GA-37). Refused during a merge (GA-4),
   * with `switch-uncommitted-changes` while anything is uncommitted, as nothing is
   * stashed (GA-39), and with `branch-not-found`, `switch-blocked` or `git-busy`;
   * with `remote`, also `branch-name-invalid` (`400`), `branch-exists` or
   * `branch-name-conflict`. A refusal leaves everything as it was (GA-43). After
   * `git-timeout`, the files are put back and clients are told, as a killed git may
   * have changed them.
   */
  @Post('switch')
  @HttpCode(204)
  @ApiNoContentResponse()
  async switchBranch(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: GitSwitchRequestDto
  ): Promise<void> {
    const { userId } = authOf(req);
    const root = this.repositories.root(userId, params.id);
    let changed = false;
    try {
      // Inside the lock: until then, a save can make a clean working copy dirty.
      await this.guard.change(params.id, root, async () => {
        const { changes } = await this.engine.status(root).catch(toGitApiError);
        if (changes.length > 0) {
          throw new ApiErrorException(409, 'switch-uncommitted-changes');
        }
        const switching = body.remote
          ? this.branches.trackRemote(root, body.name)
          : this.branches.switchTo(root, body.name);
        await switching.catch(mayHaveChanged(() => (changed = true)));
        changed = true;
      });
    } finally {
      if (changed) {
        this.events.publish(userId, { type: 'files.changed', repositoryId: params.id, folders: 'all' });
        this.events.publish(userId, { type: 'git.changed', repositoryId: params.id });
      }
    }
  }

  /**
   * How many commits the current branch's upstream has that the branch does
   * not, as of the last fetch, and whether they change `path` (GA-34). A
   * client reads it when `behind` changes. The path is refused like any other
   * (A-7.6), and read literally, never as a pattern; it may be missing, as a
   * file the user deleted.
   */
  @Get('incoming')
  @ApiOkResponse({ type: GitIncomingDto })
  @ZodSerializerDto(GitIncomingDto)
  async incoming(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: GitIncomingQueryDto
  ): Promise<GitIncoming> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    if (query.path !== undefined) {
      await checkPath(root, query.path);
    }
    return { incoming: await this.engine.incoming(root, query.path).catch(toGitApiError) };
  }

  /**
   * The merge in progress: what merges into what, which files conflict, how and
   * whether they are resolved, what merged by itself, and the merge commit's
   * message (GC-6, GC-7, GC-17, GC-20). Read from git, so any device can carry on
   * (A-4.5). Refused with `no-merge-in-progress` when there is none.
   */
  @Get('merge')
  @ApiOkResponse({ type: GitMergeStateDto })
  @ZodSerializerDto(GitMergeStateDto)
  gitMerge(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<GitMergeState> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return this.mergeState.read(root).catch(toGitApiError);
  }

  /**
   * One version of a conflicting file for the user to compare before choosing
   * (GC-17). `side` is `ours` or `theirs`. Refused with `no-merge-in-progress`,
   * `not-conflicting` (the path is not a conflicting file), and `version-not-readable`
   * (not Markdown, not a regular file, over the limit, not valid UTF-8, or that side deleted it).
   */
  @Get('merge/version')
  @ApiOkResponse({ type: GitMergeVersionDto })
  @ZodSerializerDto(GitMergeVersionDto)
  async gitMergeVersion(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: GitMergeVersionQueryDto
  ): Promise<GitMergeVersion> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return this.mergeState.readVersion(root, query.path, query.side).catch(toGitApiError);
  }

  /**
   * Aborts the merge in progress: the branch, the files and the index go back to
   * how they were before the pull, and the upstream's commits show as to pull
   * again (GC-24). Refused with `no-merge-in-progress` when there is none, also
   * for the second of two aborts.
   */
  @Post('merge/abort')
  @HttpCode(204)
  @ApiNoContentResponse()
  abortMerge(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<void> {
    return this.mergeActions.abort(authOf(req).userId, params.id);
  }

  /**
   * Resolves one conflicting file, at once on disk and in the index (GC-4):
   * `mark-resolved` as saved, for an editable file (GC-14); `ours` or `theirs`,
   * the whole version, for a file both changed or added (GC-15); `keep` or
   * `delete`, for a file one side deleted (GC-16). Waits for a save in progress.
   * Refused with `no-merge-in-progress`; `not-conflicting` for a file already
   * resolved or not in the merge; `resolution-not-allowed` when the file's kind
   * does not offer it, or the path is a folder on disk; `conflict-markers-left`
   * when the file still has lines that look like markers and `force` is not set;
   * `path-refused` for a path through a symbolic link; and, for `mark-resolved`,
   * what keeps the editor from the file (`file-too-large`, `file-not-utf8`,
   * `entry-not-found`). Nothing changes when it is refused or git fails (GC-27).
   */
  @Post('merge/resolve')
  @HttpCode(204)
  @ApiNoContentResponse()
  resolveConflict(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: GitResolveRequestDto
  ): Promise<void> {
    return this.mergeActions.resolve(authOf(req).userId, params.id, body);
  }

  /**
   * Puts a resolved file back as it was when the merge stopped, with its conflict
   * markers, and marks it unresolved (GC-18); `edited` in `GET …/git/merge` says
   * whether to ask first. Waits for a save in progress, and touches no other file
   * (GC-19). Refused with `no-merge-in-progress`; `not-conflicting` for a file not
   * in the merge; `not-resolved` for one that is not resolved;
   * `resolution-not-allowed` when the path is a folder on disk; and `path-refused`
   * for a path through a symbolic link. Nothing changes when it is refused or git
   * fails (GC-27).
   */
  @Post('merge/start-over')
  @HttpCode(204)
  @ApiNoContentResponse()
  startConflictOver(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: GitConflictPathDto
  ): Promise<void> {
    return this.mergeActions.startOver(authOf(req).userId, params.id, body.path);
  }

  /**
   * Commits the merge with the message, as the repository's commit author, with
   * the resolved files and what merged by itself (GC-20, CA-1, CA-2), and the
   * merge ends (GC-21). Waits for a save in progress. Refused, in this order,
   * with `commit-author-not-confirmed` (CA-13), `no-merge-in-progress`, and
   * `merge-unresolved` while git has any path unresolved; then with
   * `detached-head`, as a commit on no branch is lost at the next switch, and
   * `git-busy`. A failure leaves the merge as it was (GC-27); a git killed at its
   * timeout that committed all the same answers with that commit.
   */
  @Post('merge/commit')
  @ApiCreatedResponse({ type: CommitResultDto })
  @ZodSerializerDto(CommitResultDto)
  commitMerge(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: GitMergeCommitRequestDto
  ): Promise<CommitResult> {
    return this.mergeActions.commit(authOf(req).userId, params.id, body.message);
  }

  /**
   * One changed file's difference from the last commit, or that it is binary
   * or too large (GA-14 to GA-16). A deleted file has no entry on disk, so the
   * path may be missing; a symbolic link is shown as the link itself.
   */
  @Get('diff')
  @ApiOkResponse({ type: GitDiffDto })
  @ZodSerializerDto(GitDiffDto)
  async diff(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: GitDiffQueryDto
  ): Promise<GitDiff> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    await checkPath(root, query.path);
    return this.engine.diff(root, query.path).catch(toGitApiError);
  }

  /**
   * Discards the changes to the listed files (GA-23), which are the ones the
   * client showed. Refused during a merge (GA-4), and with `discard-blocked` when
   * a deleted file cannot come back without replacing something else. Clients are
   * told only when something changed, which a failure partway also did.
   */
  @Post('discard')
  @HttpCode(204)
  @ApiNoContentResponse()
  async discard(@Req() req: Request, @Param() params: RepositoryParamsDto, @Body() body: GitPathsDto): Promise<void> {
    const { userId } = authOf(req);
    const root = this.repositories.root(userId, params.id);
    const paths = [ ...new Set(body.paths) ];
    let changed = false;
    try {
      // Inside the lock: no file action of ours runs between the checks and the discard.
      await this.guard.change(params.id, root, async () => {
        await checkDiscardPaths(root, paths);
        await this.engine.discard(root, paths, () => {
          changed = true;
        }).catch((error: unknown) => {
          if (error instanceof PathRefusedError) {
            toFilesError(error);
          }
          toGitApiError(error);
        });
      });
    } finally {
      // Also after a failure: a discard that fails partway has already changed files.
      if (changed) {
        this.events.publish(userId, { type: 'files.changed', repositoryId: params.id, folders: 'all' });
        this.events.publish(userId, { type: 'git.changed', repositoryId: params.id });
      }
    }
  }

  /**
   * Commits exactly the listed changes with the message, as the repository's
   * commit author (GA-19, GA-21, CA-1, CA-2, CA-6). Refused while the user has
   * not confirmed their commit author (CA-13), during a merge (GA-4) and on a
   * detached `HEAD`. With `amend`, replaces the last commit, and needs no paths;
   * refused when that commit cannot be amended (GA-22).
   */
  @Post('commits')
  @ApiCreatedResponse({ type: CommitResultDto })
  @ZodSerializerDto(CommitResultDto)
  async commit(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: CommitRequestDto
  ): Promise<CommitResult> {
    const { userId } = authOf(req);
    const root = this.repositories.root(userId, params.id);
    const { author, confirmed } = this.commitAuthors.forRepository(userId, params.id);
    if (!confirmed) {
      throw new ApiErrorException(409, 'commit-author-not-confirmed');
    }
    const paths = [ ...new Set(body.paths) ];
    // Inside the lock and after its merge check: no file action of ours runs between the check and the commit.
    const result = await this.guard.change(params.id, root, async () => {
      await checkPaths(root, paths);
      return this.engine.commit(root, { paths, message: body.message, author, amend: body.amend }).catch(toGitApiError);
    });
    this.events.publish(userId, { type: 'git.changed', repositoryId: params.id });
    return result;
  }

  /**
   * Pushes the current branch to its upstream, or publishes it, as a job
   * (GA-3, GA-29). A second request while it waits or runs gets the same job.
   * Refused during a merge (GA-4), on a detached `HEAD`, without commits, with
   * nothing to push, and for a key that is not unlocked in this session (RC-4).
   * Follow the job with `job.finished`, then read it with `gitJob`.
   */
  @Post('push')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: GitJobStartedDto })
  @ZodSerializerDto(GitJobStartedDto)
  async push(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<GitJobStarted> {
    return { jobId: await this.pushes.start(authOf(req), params.id) };
  }

  /**
   * Fetches, then merges the current branch's upstream into it, as a job
   * (GA-3, GA-25 to GA-28): a fast-forward, a merge commit as the commit
   * author, or a merge that conflicts and stays in progress. An unpublished
   * branch with a remote branch of its name pulls that, and makes it its
   * upstream (GA-8). A second request while it waits or runs gets the same job.
   * Refused during a merge (GA-4), on a detached `HEAD`, without an upstream,
   * with uncommitted changes (GA-26), and for a key that is not unlocked in
   * this session (RC-4). Follow the job with `job.finished`, then read it with
   * `gitJob`; a commit author that is not confirmed yet is asked for there
   * (CA-14), and the client pulls again.
   */
  @Post('pull')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: GitJobStartedDto })
  @ZodSerializerDto(GitJobStartedDto)
  async pull(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<GitJobStarted> {
    return { jobId: await this.pulls.start(authOf(req), params.id) };
  }

  /**
   * Fetches the remote as a job (GA-3, GA-33): remote branches only, also
   * during a merge (GC-3). A second request while it waits or runs gets the
   * same job. Refused only for a key that is not unlocked in this session and
   * for credentials that are gone (RC-4). Follow the job with `job.finished`,
   * then read it with `gitJob`, and the status for `behind` and `fetchProblem`.
   */
  @Post('fetch')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: GitJobStartedDto })
  @ZodSerializerDto(GitJobStartedDto)
  fetch(@Req() req: Request, @Param() params: RepositoryParamsDto): GitJobStarted {
    return { jobId: this.fetches.start(authOf(req), params.id) };
  }

  /**
   * Says that a file of the repository was opened, so that the backend
   * fetches, at most once every 30 seconds per repository for every client
   * (GA-33). It decides whether it fetches: nobody waits for this fetch, so it
   * is never refused for a locked key, and a key it cannot use skips it
   * (GA-35, RC-15). How it ends shows as a background fetch does.
   */
  @Post('fetch/file-opened')
  @HttpCode(204)
  @ApiNoContentResponse()
  fetchOnFileOpened(@Req() req: Request, @Param() params: RepositoryParamsDto): void {
    const { userId, sessionId } = authOf(req);
    this.repositories.root(userId, params.id);
    this.fetchScheduler.fileOpened(userId, sessionId, params.id);
  }

  /**
   * How one of the repository's git jobs stands, and how it ended: a push's
   * commits and upstream (GA-32), whether a fetch moved a remote branch, a
   * pull's result and commits (GA-28), or why it failed (GA-30, GA-31, RC-4).
   */
  @Get('jobs/:jobId')
  @ApiOkResponse({ type: GitJobStateDto })
  @ZodSerializerDto(GitJobStateDto)
  gitJob(@Req() req: Request, @Param() params: GitJobParamsDto): GitJobState {
    return this.gitJobs.state(authOf(req).userId, params.id, params.jobId);
  }
}
