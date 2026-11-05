import { EventsHub } from '@front-burner/server-core-events';
import { authOf } from '@front-burner/server-core-security';
import { RepositoryParamsDto } from '@front-burner/server-feature-repositories';
import type { CommitAuthorPreference, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { CommitAuthorDto, CommitAuthorPreferenceDto, RepositoryCommitAuthorDto } from './commit-author.dto';
import { CommitAuthors } from './commit-authors';

@ApiTags('preferences')
@Controller()
export class CommitAuthorController {
  constructor(
    private readonly commitAuthors: CommitAuthors,
    private readonly events: EventsHub
  ) {}

  @Get('preferences/commit-author')
  @ApiOkResponse({ type: CommitAuthorPreferenceDto })
  @ZodSerializerDto(CommitAuthorPreferenceDto)
  commitAuthor(@Req() req: Request): CommitAuthorPreference {
    return this.commitAuthors.preference(authOf(req).userId);
  }

  @Put('preferences/commit-author')
  @ApiOkResponse({ type: CommitAuthorPreferenceDto })
  @ZodSerializerDto(CommitAuthorPreferenceDto)
  setCommitAuthor(
    @Req() req: Request,
    @Body() body: CommitAuthorDto
  ): CommitAuthorPreference {
    const { userId } = authOf(req);
    const preference = this.commitAuthors.setDefault(userId, body);
    this.published(userId);
    return preference;
  }

  @Post('preferences/commit-author/confirm')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The default commit author is confirmed' })
  confirmCommitAuthor(@Req() req: Request): void {
    const { userId } = authOf(req);
    this.commitAuthors.confirm(userId);
    this.published(userId);
  }

  @Get('repositories/:id/commit-author')
  @ApiOkResponse({ type: RepositoryCommitAuthorDto })
  @ZodSerializerDto(RepositoryCommitAuthorDto)
  repositoryCommitAuthor(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto
  ): RepositoryCommitAuthor {
    return this.commitAuthors.forRepository(authOf(req).userId, params.id);
  }

  @Put('repositories/:id/commit-author')
  @ApiOkResponse({ type: RepositoryCommitAuthorDto })
  @ZodSerializerDto(RepositoryCommitAuthorDto)
  setRepositoryCommitAuthor(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: CommitAuthorDto
  ): RepositoryCommitAuthor {
    const { userId } = authOf(req);
    const author = this.commitAuthors.setOverride(userId, params.id, body);
    this.published(userId);
    return author;
  }

  @Delete('repositories/:id/commit-author')
  @ApiOkResponse({ type: RepositoryCommitAuthorDto })
  @ZodSerializerDto(RepositoryCommitAuthorDto)
  removeRepositoryCommitAuthor(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto
  ): RepositoryCommitAuthor {
    const { userId } = authOf(req);
    const author = this.commitAuthors.removeOverride(userId, params.id);
    this.published(userId);
    return author;
  }

  /** Every tab of the user reads the author again, as a change of the default concerns all their repositories. */
  private published(userId: number): void {
    this.events.publish(userId, { type: 'commit-author.changed' });
  }
}
