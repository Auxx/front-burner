import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { authOf } from '../request-user';
import { TrustHostRequestDto } from '../saved/credentials.dto';
import { KnownHostsService } from './known-hosts.service';

/** The logged-in user's trusted SSH host keys (AR-32). */
@ApiTags('known-hosts')
@Controller('known-hosts')
export class KnownHostsController {
  constructor(private readonly knownHosts: KnownHostsService) {}

  /** Trusts a host key the access check reported as unknown; a changed key is refused. */
  @Post()
  @HttpCode(204)
  @ApiNoContentResponse()
  trust(@Body() body: TrustHostRequestDto, @Req() req: Request): void {
    this.knownHosts.trust(authOf(req).userId, body);
  }
}
