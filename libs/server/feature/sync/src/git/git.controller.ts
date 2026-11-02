import { GitEngine } from '@front-burner/server-core-git';
import { authOf } from '@front-burner/server-core-security';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type { GitStatus } from '@front-burner/shared-contracts';
import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { GitStatusDto } from './git.dto';

/** Git in the logged-in user's working copies (REQ-GIT-002). */
@ApiTags('git')
@Controller('repositories/:id/git')
export class GitController {
  constructor(private readonly repositories: OpenableRepository, private readonly engine: GitEngine) {}

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
}
