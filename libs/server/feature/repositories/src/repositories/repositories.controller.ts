// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import { RateLimitGroup, type RequestAuth } from '@front-burner/server-core-security';
import type {
  AccessCheckResult,
  RecentRepositories,
  RepositoryIndex,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { AddRepositoryService } from '../add/add-repository.service';
import {
  AccessCheckRequestDto,
  AccessCheckResultDto,
  AddRepositoryRequestDto,
  RecentRepositoriesDto,
  RepositoryIndexDto,
  RepositorySummaryDto
} from './repositories.dto';
import { RepositoryQueries, toSummary } from './repository-queries';

/** The logged-in user and session; the global auth guard has checked `req.auth`. */
function authOf(req: Request): RequestAuth {
  if (req.auth === undefined) {
    throw new Error('RepositoriesController reached without req.auth');
  }
  return req.auth;
}

/** The logged-in user's repositories; never another user's (DS-3, AR-56). */
@ApiTags('repositories')
@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly queries: RepositoryQueries, private readonly adding: AddRepositoryService) {}

  /** The dashboard's recent list (DS-16, DS-17). */
  @Get('recent')
  @ApiOkResponse({ type: RecentRepositoriesDto })
  @ZodSerializerDto(RecentRepositoriesDto)
  recent(@Req() req: Request): RecentRepositories {
    return { repositories: this.queries.recent(authOf(req).userId).map(toSummary) };
  }

  /** Every repository's name and remote, for the Add repository form (AR-12, AR-15). */
  @Get('index')
  @ApiOkResponse({ type: RepositoryIndexDto })
  @ZodSerializerDto(RepositoryIndexDto)
  index(@Req() req: Request): RepositoryIndex {
    return this.queries.index(authOf(req).userId);
  }

  /** The remote's branches for the form (AR-35); limited with the submit (AR-55). */
  @Post('access-check')
  @HttpCode(200)
  @RateLimitGroup('access-check')
  @ApiOkResponse({ type: AccessCheckResultDto })
  @ZodSerializerDto(AccessCheckResultDto)
  accessCheck(@Req() req: Request, @Body() body: AccessCheckRequestDto): Promise<AccessCheckResult> {
    const { userId, sessionId } = authOf(req);
    return this.adding.accessCheck({ id: userId, sessionId }, body);
  }

  /** Adds a repository and starts its clone in the background (AR-41, AR-44). */
  @Post()
  @RateLimitGroup('access-check')
  @ApiCreatedResponse({ type: RepositorySummaryDto })
  @ZodSerializerDto(RepositorySummaryDto)
  add(@Req() req: Request, @Body() body: AddRepositoryRequestDto): Promise<RepositorySummary> {
    const { userId, sessionId } = authOf(req);
    return this.adding.add({ id: userId, sessionId }, body);
  }
}
