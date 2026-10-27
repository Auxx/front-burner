import { Global, Module } from '@nestjs/common';
import { EgressHttpClient } from './egress-http-client';

/** Provides the shared outbound HTTP client (A-7.8) everywhere. */
@Global()
@Module({
  providers: [ EgressHttpClient ],
  exports: [ EgressHttpClient ]
})
export class EgressModule {}
