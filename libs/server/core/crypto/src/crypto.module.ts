import type { Config } from '@front-burner/server-core-config';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { SecretBox } from './secret-box/secret-box';

/** Injection token for the instance {@link SecretBox}. */
export const SECRET_BOX = 'FRONT_BURNER_SECRET_BOX';

@Global()
@Module({})
export class CryptoModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: CryptoModule,
      providers: [ { provide: SECRET_BOX, useValue: new SecretBox(config.encryptionKey) } ],
      exports: [ SECRET_BOX ]
    };
  }
}
