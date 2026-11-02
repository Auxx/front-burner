import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { authOf } from '@front-burner/server-core-security';
import { PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { OpenableRepository, toFilesError, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type { CommitResult, GitStatus } from '@front-burner/shared-contracts';
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { toGitApiError } from './git-api-errors';
import { CommitRequestDto, CommitResultDto, GitStatusDto } from './git.dto';

/** How many paths are checked at once: enough to hide the file system's latency, few enough for its handles. */
const PATH_CHECKS_AT_ONCE = 32;

/**
 * Refuses a path that is malformed, inside `.git` or through a symbolic link
 * (A-7.6). A missing path is fine: a deleted file, or a file of a deleted
 * folder, is a change too, and the engine ignores paths that are not changes.
 */
async function checkPath(root: string, path: string): Promise<void> {
  try {
    await resolveInWorkingCopy(root, path, { symlinkLeaf: true, mayBeMissing: true });
  } catch (error) {
    if (!(error instanceof PathRefusedError && error.reason === 'not-found')) {
      toFilesError(error);
    }
  }
}

async function checkPaths(root: string, paths: string[]): Promise<void> {
  for (let start = 0; start < paths.length; start += PATH_CHECKS_AT_ONCE) {
    await Promise.all(paths.slice(start, start + PATH_CHECKS_AT_ONCE).map(path => checkPath(root, path)));
  }
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
