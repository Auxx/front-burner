import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { authOf } from '@front-burner/server-core-security';
import { inBatches, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { OpenableRepository, toFilesError, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type { CommitResult, GitDiff, GitStatus } from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { toGitApiError } from './git-api-errors';
import { CommitRequestDto, CommitResultDto, GitDiffDto, GitDiffQueryDto, GitPathsDto, GitStatusDto } from './git.dto';

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

/** Git in the logged-in user's working copies (REQ-GIT-002). */
@ApiTags('git')
@Controller('repositories/:id/git')
export class GitController {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly engine: GitEngine,
    private readonly guard: WorkingTreeGuard,
    private readonly commitAuthors: CommitAuthors,
    private readonly events: EventsHub
  ) {}

  /** The branch, its counts against the upstream, and every changed file (GA-7, GA-11, GA-42). */
  @Get('status')
  @ApiOkResponse({ type: GitStatusDto })
  @ZodSerializerDto(GitStatusDto)
  async gitStatus(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<GitStatus> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    const [ status, mergeInProgress ] = await Promise.all([
      this.engine.status(root),
      this.engine.mergeInProgress(root)
    ]);
    return { ...status, mergeInProgress };
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
   * detached `HEAD`.
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
      return this.engine.commit(root, { paths, message: body.message, author }).catch(toGitApiError);
    });
    this.events.publish(userId, { type: 'git.changed', repositoryId: params.id });
    return result;
  }
}
