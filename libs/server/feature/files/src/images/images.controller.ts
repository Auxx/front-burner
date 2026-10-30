import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import { Controller, Get, Logger, Param, Query, Req, Res } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream';
import { authOf } from '../files/auth-of';
import { toFilesError } from '../files/files-errors';
import { ImageQueryDto } from '../files/files.dto';
import { OpenableRepository } from '../repository/openable-repository';
import { IMAGE_TYPES, ImageFiles } from './image-files';

/** Keeps an SVG opened on its own in a tab from running anything (NF-11.3, IM-26). */
export const IMAGE_CSP = 'default-src \'none\'; sandbox';

const binary = { schema: { type: 'string', format: 'binary' } };

/** Whether `If-None-Match` names `etag`, weak or strong, or is `*`. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  return ifNoneMatch !== undefined
    && ifNoneMatch.split(',').some(tag => {
      const trimmed = tag.trim();
      return trimmed === '*' || trimmed.replace(/^W\//, '') === etag;
    });
}

/**
 * Repository images as raw bytes, for the preview (IM-7, A-3.14). The web
 * client loads them with `fetch`, so the generated client has no method for
 * this route.
 */
@ApiTags('files')
@Controller('repositories/:id')
export class ImagesController {
  private readonly logger = new Logger(ImagesController.name);

  constructor(
    private readonly repositories: OpenableRepository,
    private readonly images: ImageFiles
  ) {}

  /** One image of the working copy, as it is on disk (IM-4, IM-7, IM-9). */
  @Get('image')
  @ApiOkResponse({
    content: Object.fromEntries([ ...new Set(Object.values(IMAGE_TYPES)) ].map(type => [ type, binary ]))
  })
  @ApiResponse({ status: 304, description: 'The image matches `If-None-Match`.' })
  @ApiResponse({ status: 400, description: '`path-refused`: outside the working copy, in `.git` or through a link.' })
  @ApiNotFoundResponse({ description: '`entry-not-found`, or `not-found` for the repository.' })
  @ApiResponse({ status: 413, description: '`image-too-large`: over the limit; params `{ limit }` in bytes.' })
  @ApiUnsupportedMediaTypeResponse({ description: '`image-format-unsupported`.' })
  async image(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Query() query: ImageQueryDto,
    @Res() res: Response
  ): Promise<void> {
    // On every answer, refusals and 304 included.
    res.setHeader('Content-Security-Policy', IMAGE_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const root = this.repositories.root(authOf(req).userId, params.id);
    const image = await this.images.open(root, query.path).catch(toFilesError);
    res.setHeader('ETag', image.etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (matches(req.header('If-None-Match'), image.etag)) {
      await image.handle.close();
      res.status(304).end();
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Length', image.size);
    if (image.size === 0) {
      await image.handle.close();
      res.end();
      return;
    }
    // From the opened descriptor, never reopened by path (A-7.6), and no more than was measured.
    const stream = image.handle.createReadStream({ start: 0, end: image.size - 1 });
    // Closes the descriptor when the client goes away too; a failure mid-stream can only cut the answer short.
    pipeline(stream, res, error => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        this.logger.warn(`Streaming an image failed: ${error.message}`);
      }
    });
  }
}
