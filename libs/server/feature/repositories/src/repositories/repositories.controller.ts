// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import type { RecentRepositories } from '@front-burner/shared-contracts';
import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { RecentRepositoriesDto } from './repositories.dto';
import { RepositoryQueries, toSummary } from './repository-queries';

/** The logged-in user's repositories; never another user's (DS-3). */
@ApiTags('repositories')
@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly queries: RepositoryQueries) {}

  /** The dashboard's recent list (DS-16, DS-17). The global auth guard has checked `req.auth`. */
  @Get('recent')
  @ApiOkResponse({ type: RecentRepositoriesDto })
  @ZodSerializerDto(RecentRepositoriesDto)
  recent(@Req() req: Request): RecentRepositories {
    const userId = req.auth?.userId;
    if (userId === undefined) {
      throw new Error('RepositoriesController reached without req.auth');
    }
    return { repositories: this.queries.recent(userId).map(toSummary) };
  }
}
