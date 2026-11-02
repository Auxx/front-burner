import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOperationError } from '@front-burner/server-core-git';
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
import { CommitRequestDto, CommitResultDto, GitStatusDto } from './git.dto';

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
   * not confirmed their commit author (CA-13) and during a merge (GA-4).
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
    for (const path of body.paths) {
      await checkPath(root, path);
    }
    const result = await this.guard.change(params.id, root, async () => {
      try {
        return await this.engine.commit(root, { paths: body.paths, message: body.message, author });
      } catch (error) {
        if (error instanceof GitOperationError && error.code === 'nothing-to-commit') {
          throw new ApiErrorException(409, 'nothing-to-commit');
        }
        throw error;
      }
    });
    this.events.publish(userId, { type: 'git.changed', repositoryId: params.id });
    return result;
  }
}
