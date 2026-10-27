import type { GeneratedSshKey, SavedCredentials } from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { authOf, parseId } from '../request-user';
import {
  GeneratedSshKeyDto,
  GenerateSshKeyRequestDto,
  SavedCredentialsDto,
  UnlockSshKeyRequestDto
} from './credentials.dto';
import { SavedCredentialsService } from './saved-credentials.service';

/** The logged-in user's saved credentials, never with their secrets (AR-17, AR-56). */
@ApiTags('credentials')
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentials: SavedCredentialsService) {}

  /** HTTPS credentials and SSH keys; `unlocked` in this session (AR-24, AR-25). Does not keep a key unlocked. */
  @Get()
  @ApiOkResponse({ type: SavedCredentialsDto })
  @ZodSerializerDto(SavedCredentialsDto)
  list(@Req() req: Request): SavedCredentials {
    const { userId, sessionId } = authOf(req);
    return this.credentials.list(userId, sessionId);
  }

  /** Generates an Ed25519 key and saves it at once (AR-29); the comment names the instance's host. */
  @Post('ssh-keys/generate')
  @ApiCreatedResponse({ type: GeneratedSshKeyDto })
  @ZodSerializerDto(GeneratedSshKeyDto)
  generateSshKey(@Body() body: GenerateSshKeyRequestDto, @Req() req: Request): GeneratedSshKey {
    // Express's `hostname` has no port and honours the trusted proxies.
    return this.credentials.generateKey(authOf(req).userId, body.name, `front-burner@${req.hostname}`);
  }

  /** Unlocks a passphrase-protected key for this session (AR-31). */
  @Post('ssh-keys/:id/unlock')
  @ApiParam({ name: 'id', type: 'integer' })
  @HttpCode(204)
  @ApiNoContentResponse()
  unlockSshKey(@Param('id') id: string, @Body() body: UnlockSshKeyRequestDto, @Req() req: Request): void {
    const { userId, sessionId } = authOf(req);
    this.credentials.unlock(userId, sessionId, parseId(id), body.passphrase);
  }
}
