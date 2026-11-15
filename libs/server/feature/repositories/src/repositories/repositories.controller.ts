import type { Repository } from '@front-burner/server-core-database';
import { authOf, RateLimitGroup } from '@front-burner/server-core-security';
import type {
  AccessCheckResult,
  RecentRepositories,
  RemovalCheckResult,
  RepositoryDetails,
  RepositoryIndex,
  RepositoryList,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { AddRepositoryService } from '../add/add-repository.service';
import { CloneAgainService } from '../clone/clone-again.service';
import { RemovalCheck } from '../remove/removal-check';
import { RemoveRepositoryService } from '../remove/remove-repository.service';
import { RepositoryWarnings, WarningsViewer } from '../warnings/repository-warnings';
import {
  AccessCheckRequestDto,
  AccessCheckResultDto,
  AddRepositoryRequestDto,
  RecentQueryDto,
  RecentRepositoriesDto,
  RemovalCheckResultDto,
  RemoveRepositoryQueryDto,
  RepositoryDetailsDto,
  RepositoryIndexDto,
  RepositoryListDto,
  RepositoryParamsDto,
  RepositorySummaryDto
} from './repositories.dto';
import { ownRow, RepositoryQueries, toDetails, toSummary } from './repository-queries';

/** The logged-in user's repositories; never another user's (DS-3, AR-56). */
@ApiTags('repositories')
@Controller('repositories')
export class RepositoriesController {
  constructor(
    private readonly queries: RepositoryQueries,
    private readonly adding: AddRepositoryService,
    private readonly warnings: RepositoryWarnings,
    private readonly removal: RemovalCheck,
    private readonly removing: RemoveRepositoryService,
    private readonly cloning: CloneAgainService
  ) {}

  /** The dashboard's recent list (DS-16, DS-17); the switcher's without the current repository (NV-10). */
  @Get('recent')
  @ApiOkResponse({ type: RecentRepositoriesDto })
  @ZodSerializerDto(RecentRepositoriesDto)
  recent(@Req() req: Request, @Query() query: RecentQueryDto): RecentRepositories {
    const auth = authOf(req);
    return { repositories: this.summaries(auth, this.queries.recent(auth.userId, 10, query.exclude)) };
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
    const auth = authOf(req);
    return { repositories: this.summaries(auth, this.queries.all(auth.userId)) };
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
    const auth = authOf(req);
    return this.summary(auth, this.queries.find(auth.userId, params.id));
  }

  /**
   * What the settings page shows beyond the summary: clone mode, branch, level,
   * date added and a failed clone's error record (RM-9, RM-10, RM-16).
   */
  @Get(':id/details')
  @ApiOkResponse({ type: RepositoryDetailsDto })
  @ZodSerializerDto(RepositoryDetailsDto)
  repositoryDetails(@Req() req: Request, @Param() params: RepositoryParamsDto): RepositoryDetails {
    const auth = authOf(req);
    const row = ownRow(this.queries.find(auth.userId, params.id));
    return toDetails(row, this.warnings.forRow(auth, row), this.queries.clones([ row ]).get(row.id));
  }

  /**
   * What removing the repository would lose, for the remove dialog: uncommitted
   * files, commits not pushed, a merge in progress, or a working copy that git
   * cannot read (RM-18). Changes nothing.
   */
  @Get(':id/removal')
  @ApiOkResponse({ type: RemovalCheckResultDto })
  @ZodSerializerDto(RemovalCheckResultDto)
  removalCheck(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<RemovalCheckResult> {
    return this.removal.of(authOf(req).userId, params.id);
  }

  /**
   * Removes the repository in any status (RM-17 to RM-21): its jobs are
   * cancelled, its rows deleted and its working copy moved out at once, then
   * deleted by a job. When removing would lose work, `confirmName` must be the
   * repository's name, else `409 removal-needs-confirmation` and nothing changes (RM-18).
   */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: RemoveRepositoryQueryDto
  ): Promise<void> {
    return this.removing.remove(authOf(req).userId, params.id, query.confirmName);
  }

  /**
   * **Retry clone** and **Clone again** (RM-11, RM-12): clones a repository in
   * the status Error again, with its current credentials, and answers it
   * `cloning`. Limited as adding is (RM-13); a locked key answers `409 key-locked` (RC-16).
   */
  @Post(':id/clone')
  @HttpCode(200)
  @RateLimitGroup('access-check')
  @ApiOkResponse({ type: RepositorySummaryDto })
  @ZodSerializerDto(RepositorySummaryDto)
  cloneAgain(@Req() req: Request, @Param() params: RepositoryParamsDto): Promise<RepositorySummary> {
    const { userId, sessionId } = authOf(req);
    return this.cloning.cloneAgain({ id: userId, sessionId, requestId: String(req.id) }, params.id);
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
    const auth = authOf(req);
    return this.summary(auth, this.queries.markOpened(auth.userId, params.id, new Date()));
  }

  /** The rows as clients see them, with the session's warnings and the clones, each read once for all (NF-2). */
  private summaries(viewer: WarningsViewer, rows: Repository[]): RepositorySummary[] {
    const warnings = this.warnings.forRows(viewer, rows);
    const clones = this.queries.clones(rows);
    return rows.map((row, i) => toSummary(row, warnings[i], clones.get(row.id)));
  }

  /** The repository as clients see it, or `404 not-found`. */
  private summary(viewer: WarningsViewer, row: Repository | undefined): RepositorySummary {
    const own = ownRow(row);
    return toSummary(own, this.warnings.forRow(viewer, own), this.queries.clones([ own ]).get(own.id));
  }
}
