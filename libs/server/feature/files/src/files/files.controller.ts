// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import type { RequestAuth } from '@front-burner/server-core-security';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type { EntryPath, EntrySummary, FolderListing, IgnoreResult } from '@front-burner/shared-contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { EntryActions } from '../actions/entry-actions';
import { EntryDelete } from '../actions/entry-delete';
import { FolderLister } from '../listing/folder-lister';
import { OpenableRepository } from '../repository/openable-repository';
import { EntrySummaries } from '../summary/entry-summaries';
import { toFilesError } from './files-errors';
import {
  CreateEntryRequestDto,
  EntryPathDto,
  EntryQueryDto,
  EntrySummaryDto,
  FolderListingDto,
  FolderQueryDto,
  IgnoreQueryDto,
  IgnoreResultDto,
  RenameEntryRequestDto
} from './files.dto';

/** The logged-in user and session; the global auth guard has checked `req.auth`. */
function authOf(req: Request): RequestAuth {
  if (req.auth === undefined) {
    throw new Error('FilesController reached without req.auth');
  }
  return req.auth;
}

/** The files of the logged-in user's working copies (REQ-FILE-001). */
@ApiTags('files')
@Controller('repositories/:id')
export class FilesController {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly lister: FolderLister,
    private readonly actions: EntryActions,
    private readonly deletes: EntryDelete,
    private readonly summaries: EntrySummaries
  ) {}

  /** One folder of the working copy (FB-15 to FB-20b). */
  @Get('folder')
  @ApiOkResponse({ type: FolderListingDto })
  @ZodSerializerDto(FolderListingDto)
  listFolder(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: FolderQueryDto
  ): Promise<FolderListing> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return this.lister.list(root, query.path).catch(toFilesError);
  }

  /** **New file** or **New folder** (FB-29 to FB-34). */
  @Post('entries')
  @ApiCreatedResponse({ type: EntryPathDto })
  @ZodSerializerDto(EntryPathDto)
  createEntry(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: CreateEntryRequestDto
  ): Promise<EntryPath> {
    return this.actions.create(authOf(req).userId, params.id, body);
  }

  /** **Rename** in place (FB-35). */
  @Post('entries/rename')
  @HttpCode(200)
  @ApiOkResponse({ type: EntryPathDto })
  @ZodSerializerDto(EntryPathDto)
  renameEntry(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: RenameEntryRequestDto
  ): Promise<EntryPath> {
    return this.actions.rename(authOf(req).userId, params.id, body);
  }

  /** **Delete** a file, a symbolic link or a folder (FB-37, FB-40). */
  @Delete('entries')
  @HttpCode(204)
  @ApiNoContentResponse()
  deleteEntry(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: EntryQueryDto
  ): Promise<void> {
    return this.deletes.delete(authOf(req).userId, params.id, query.path);
  }

  /** What an entry holds, for the rename and delete confirmations (FB-35, FB-38). */
  @Get('entries/summary')
  @ApiOkResponse({ type: EntrySummaryDto })
  @ZodSerializerDto(EntrySummaryDto)
  entrySummary(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: EntryQueryDto
  ): Promise<EntrySummary> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return this.summaries.summary(root, query.path).catch(toFilesError);
  }

  /** Whether a new entry would be ignored by `.gitignore` (FB-31, FB-34). */
  @Get('entries/ignored')
  @ApiOkResponse({ type: IgnoreResultDto })
  @ZodSerializerDto(IgnoreResultDto)
  async isIgnored(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: IgnoreQueryDto
  ): Promise<IgnoreResult> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return { ignored: await this.summaries.ignored(root, query.path, query.kind).catch(toFilesError) };
  }
}
