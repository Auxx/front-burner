// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import type { RequestAuth } from '@front-burner/server-core-security';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type { FolderListing } from '@front-burner/shared-contracts';
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { FolderLister } from '../listing/folder-lister';
import { OpenableRepository } from '../repository/openable-repository';
import { FolderListingDto, FolderQueryDto } from './files.dto';
import { toFilesError } from './files-errors';

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
  constructor(private readonly repositories: OpenableRepository, private readonly lister: FolderLister) {}

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
}
