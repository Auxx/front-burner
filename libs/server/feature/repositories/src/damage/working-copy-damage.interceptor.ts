import { WORKING_COPY_FOLDER_GONE } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout, PathRefusedError } from '@front-burner/server-core-storage';
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { stat } from 'node:fs/promises';
import { catchError, from, Observable, switchMap } from 'rxjs';
import { isWorkingCopyMissing, WorkingCopyDamage } from './working-copy-damage';

/** What a file request that looked for an entry says when it found nothing. */
function isNotFound(error: unknown): boolean {
  return (error instanceof ApiErrorException && error.code === 'entry-not-found')
    || (error instanceof PathRefusedError && error.reason === 'not-found')
    || (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * For the endpoints of a working copy (`repositories/:id/...`): a request that
 * finds it missing or damaged reports it (RM-6) and answers `409
 * working-copy-missing`. That is git saying so, or a file request that found
 * nothing because the working copy folder itself is gone; a missing file inside
 * it is still `404 entry-not-found`. Checked only when the request failed, so
 * that one that works pays nothing _(plan 109's call)_.
 */
@Injectable()
export class WorkingCopyDamageInterceptor implements NestInterceptor {
  constructor(
    private readonly damage: WorkingCopyDamage,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(catchError((error: unknown) =>
      from(this.answer(request, error)).pipe(switchMap(() => {
        throw error;
      }))
    ));
  }

  /** Throws `409 working-copy-missing` when the failure is the working copy's; returns otherwise. */
  private async answer(request: Request, error: unknown): Promise<void> {
    const userId = request.auth?.userId;
    const repositoryId = Number(request.params['id']);
    if (userId === undefined || !Number.isInteger(repositoryId)) {
      return;
    }
    if (isWorkingCopyMissing(error)) {
      this.damage.report(userId, repositoryId, error.detail);
      throw new ApiErrorException(409, 'working-copy-missing');
    }
    if (isNotFound(error) && !(await isFolder(this.layout.workingCopy(userId, repositoryId)))) {
      this.damage.report(userId, repositoryId, WORKING_COPY_FOLDER_GONE);
      throw new ApiErrorException(409, 'working-copy-missing');
    }
  }
}
