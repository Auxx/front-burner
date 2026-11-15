import type { Repository } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { authOf, RateLimitGroup } from '@front-burner/server-core-security';
import type {
  AccessCheckResult,
  RecentRepositories,
  RepositoryDetails,
  RepositoryIndex,
  RepositoryList,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { AddRepositoryService } from '../add/add-repository.service';
import {
  AccessCheckRequestDto,
  AccessCheckResultDto,
  AddRepositoryRequestDto,
  RecentQueryDto,
  RecentRepositoriesDto,
  RepositoryDetailsDto,
  RepositoryIndexDto,
  RepositoryListDto,
  RepositoryParamsDto,
  RepositorySummaryDto
} from './repositories.dto';
import { RepositoryQueries, toDetails, toSummary } from './repository-queries';

/** The user's row, or `404 not-found`, also for another user's (FB-2, RM-1). */
function ownRow(row: Repository | undefined): Repository {
  if (row === undefined) {
    throw new ApiErrorException(404, 'not-found');
  }
  return row;
}

/** The repository as clients see it, or `404 not-found`. */
function found(row: Repository | undefined): RepositorySummary {
  return toSummary(ownRow(row));
}

/** The logged-in user's repositories; never another user's (DS-3, AR-56). */
@ApiTags('repositories')
@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly queries: RepositoryQueries, private readonly adding: AddRepositoryService) {}

  /** The dashboard's recent list (DS-16, DS-17); the switcher's without the current repository (NV-10). */
  @Get('recent')
  @ApiOkResponse({ type: RecentRepositoriesDto })
  @ZodSerializerDto(RecentRepositoriesDto)
  recent(@Req() req: Request, @Query() query: RecentQueryDto): RecentRepositories {
    return { repositories: this.queries.recent(authOf(req).userId, 10, query.exclude).map(toSummary) };
  }

  /** Every repository's name and remote, for the Add repository form (AR-12, AR-15). */
  @Get('index')
  @ApiOkResponse({ type: RepositoryIndexDto })
  @ZodSerializerDto(RepositoryIndexDto)
  index(@Req() req: Request): RepositoryIndex {
    return this.queries.index(authOf(req).userId);
  }

  /** Every repository, in any status, by name ignoring case, for the repository management page (RM-5). */
  @Get()
  @ApiOkResponse({ type: RepositoryListDto })
  @ZodSerializerDto(RepositoryListDto)
  list(@Req() req: Request): RepositoryList {
    return { repositories: this.queries.all(authOf(req).userId).map(toSummary) };
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
    return this.adding.add({ id: userId, sessionId, requestId: String(req.id) }, body);
  }

  /** One repository; another user's is answered like a missing one (FB-2). */
  @Get(':id')
  @ApiOkResponse({ type: RepositorySummaryDto })
  @ZodSerializerDto(RepositorySummaryDto)
  get(@Req() req: Request, @Param() params: RepositoryParamsDto): RepositorySummary {
    return found(this.queries.find(authOf(req).userId, params.id));
  }

  /**
   * What the settings page shows beyond the summary: clone mode, branch, level,
   * date added and a failed clone's error record (RM-9, RM-10, RM-16).
   */
  @Get(':id/details')
  @ApiOkResponse({ type: RepositoryDetailsDto })
  @ZodSerializerDto(RepositoryDetailsDto)
  repositoryDetails(@Req() req: Request, @Param() params: RepositoryParamsDto): RepositoryDetails {
    return toDetails(ownRow(this.queries.find(authOf(req).userId, params.id)));
  }

  /**
   * Opens the repository in the editor: sets its last access time when it is
   * `ready` (DS-8, FB-11), and answers its status either way (FB-3).
   */
  @Post(':id/open')
  @HttpCode(200)
  @ApiOkResponse({ type: RepositorySummaryDto })
  @ZodSerializerDto(RepositorySummaryDto)
  open(@Req() req: Request, @Param() params: RepositoryParamsDto): RepositorySummary {
    return found(this.queries.markOpened(authOf(req).userId, params.id, new Date()));
  }
}
