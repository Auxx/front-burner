import { Global, Module } from '@nestjs/common';
import { EventsHub } from './events/events-hub';
import { EventsController } from './events/events.controller';

/** The push channel (A-3.10). Global, so that any feature can publish to it. */
@Global()
@Module({
  controllers: [ EventsController ],
  providers: [ EventsHub ],
  exports: [ EventsHub ]
})
export class EventsModule {}
