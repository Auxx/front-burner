import { authOf } from '@front-burner/server-core-security';
import { Body, Controller, HttpCode, Post, Put, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
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

  /**
   * Replaces the trusted key of a host and port whose key changed, for the
   * logged-in user only (RC-22, RC-23); `409 host-key-unknown` for a host and
   * port that no key is trusted for yet.
   */
  @Put()
  @HttpCode(204)
  @ApiNoContentResponse()
  replace(@Body() body: TrustHostRequestDto, @Req() req: Request): void {
    this.knownHosts.replace(authOf(req).userId, body);
  }
}
