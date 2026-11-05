import { Injectable } from '@nestjs/common';
import { RepositoryQueue } from './repository-queue';

/**
 * Serialises everything that reads or changes a working tree or index, per repository (A-5.3).
 * Network steps do not take it; they take the NetworkLock.
 */
@Injectable()
export class WorkingTreeLock extends RepositoryQueue {}
