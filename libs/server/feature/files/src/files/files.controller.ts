// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type {
  EntryPath,
  EntrySummary,
  FileContent,
  FileState,
  FolderListing,
  IgnoreResult
} from '@front-burner/shared-contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { EntryActions } from '../actions/entry-actions';
import { EntryDelete } from '../actions/entry-delete';
import { FileContents } from '../content/file-contents';
import { FolderLister } from '../listing/folder-lister';
import { OpenableRepository } from '../repository/openable-repository';
import { EntrySummaries } from '../summary/entry-summaries';
import { authOf } from './auth-of';
import { toFilesError } from './files-errors';
import {
  CreateEntryRequestDto,
  EntryPathDto,
  EntryQueryDto,
  EntrySummaryDto,
  FileContentDto,
  FileQueryDto,
  FileStateDto,
  FolderListingDto,
  FolderQueryDto,
  IgnoreQueryDto,
  IgnoreResultDto,
  RenameEntryRequestDto,
  SaveFileRequestDto
} from './files.dto';

/** The files of the logged-in user's working copies (REQ-FILE-001). */
@ApiTags('files')
@Controller('repositories/:id')
export class FilesController {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly lister: FolderLister,
    private readonly actions: EntryActions,
    private readonly deletes: EntryDelete,
    private readonly summaries: EntrySummaries,
    private readonly contents: FileContents
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

  /** A Markdown file opened in the editor (ED-2, ED-6, FB-21). */
  @Get('file')
  @ApiOkResponse({ type: FileContentDto })
  @ZodSerializerDto(FileContentDto)
  readFile(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: FileQueryDto
  ): Promise<FileContent> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return this.contents.read(root, query.path).catch(toFilesError);
  }

  /** The hash and size of a Markdown file as it is on disk now (ED-24). */
  @Get('file/state')
  @ApiOkResponse({ type: FileStateDto })
  @ZodSerializerDto(FileStateDto)
  fileState(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: FileQueryDto
  ): Promise<FileState> {
    const root = this.repositories.root(authOf(req).userId, params.id);
    return this.contents.state(root, query.path).catch(toFilesError);
  }

  /** Saves an existing Markdown file (ED-12, ED-19, ED-21). */
  @Put('file')
  @ApiOkResponse({ type: FileStateDto })
  @ZodSerializerDto(FileStateDto)
  saveFile(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: SaveFileRequestDto
  ): Promise<FileState> {
    return this.contents.save(authOf(req).userId, params.id, body);
  }

  /** **Recreate it**: creates a file deleted or renamed elsewhere (ED-21). */
  @Post('file/recreate')
  @ApiCreatedResponse({ type: FileStateDto })
  @ZodSerializerDto(FileStateDto)
  recreateFile(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: SaveFileRequestDto
  ): Promise<FileState> {
    return this.contents.recreate(authOf(req).userId, params.id, body);
  }
}
