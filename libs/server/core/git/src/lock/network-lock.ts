import { Injectable } from '@nestjs/common';
import { RepositoryQueue } from './repository-queue';

/**
 * One network operation per repository at a time: push, fetch and a pull's
 * fetch (A-5.3). Separate from the WorkingTreeLock, so that a save never waits
 * behind a slow remote.
 */
@Injectable()
export class NetworkLock extends RepositoryQueue {}
