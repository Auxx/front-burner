import { HttpClient, HttpErrorResponse, HttpHeaders, type HttpResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

/** Why a repository image is not shown (IM-18). */
export type ImageFailure = 'not-found' | 'too-large' | 'unsupported' | 'refused' | 'error';

/** A repository image as a `blob:` URL, or why it could not be loaded. */
export type ImageResult = { kind: 'loaded'; url: string; } | { kind: 'failed'; reason: ImageFailure; };

/** A cached image whose bytes changed, or that is gone, after a revalidation. */
export interface ImageChange {
  repositoryId: number;
  path: string;
  result: ImageResult;
}

/** At most this many image requests are in flight at once (IM-8). */
export const IMAGE_REQUEST_LIMIT = 4;

/** At most this many loaded images that no image of the preview uses are kept (IM-10). _(Plan's call.)_ */
export const UNUSED_IMAGE_LIMIT = 100;

interface Entry {
  repositoryId: number;
  path: string;
  url: string;
  etag: string | null;
  users: number;
}

interface Task {
  key: string;
  repositoryId: number;
  path: string;
  /** Whether the task revalidates a cached image, with its `ETag` as `If-None-Match`. */
  revalidation: boolean;
  etag: string | null;
  started: boolean;
  /** How many loads still wait for this task; one that drops to 0 before it starts leaves the queue. */
  waiters: number;
  done: Promise<ImageResult>;
  finish(result: ImageResult): void;
}

type Fetched = { kind: 'loaded'; blob: Blob; etag: string | null; } | { kind: 'same'; } | {
  kind: 'failed';
  reason: ImageFailure;
};

const REASONS: Readonly<Record<number, ImageFailure>> = {
  400: 'refused',
  404: 'not-found',
  413: 'too-large',
  415: 'unsupported'
};

function keyOf(repositoryId: number, path: string): string {
  return `${repositoryId}/${path}`;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * The repository images loaded while the repository screen is open (IM-6,
 * IM-8, IM-10, A-8.16), provided by its page, so one per screen and tab.
 *
 * Images are loaded from the image endpoint (A-3.14) through `HttpClient`,
 * so the auth interceptor adds the token and refreshes it like for every
 * other request; no token ever appears in an image's address. At most four
 * requests run at once; the rest wait in a queue, from which a load whose
 * images all scrolled away leaves before its turn. Images of the same path
 * share one request and one `blob:` URL.
 *
 * A cached image is revalidated with `If-None-Match` when asked to (its file
 * opened again, its folder changed on disk): `304` keeps it, new bytes or a
 * refusal are reported on `changed`. Failures are not cached, so an image
 * that failed is tried again on the next load (IM-19).
 *
 * Images count their users (`use`); the URLs of at most 100 unused ones are
 * kept, and older ones are revoked.
 */
@Injectable()
export class ImageCache {
  private readonly http = inject(HttpClient);
  private readonly entries = new Map<string, Entry>();
  private readonly loads = new Map<string, Task>();
  private readonly revalidations = new Map<string, Task>();
  private readonly queue: Task[] = [];
  private running = 0;
  /** Keys of loaded images that nothing uses, oldest first. */
  private readonly unused = new Set<string>();
  private readonly changes = new Subject<ImageChange>();
  private destroyed = false;

  /** Cached images whose bytes changed, or that are gone, after a revalidation. */
  readonly changed = this.changes.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroy());
  }

  /** The `blob:` URL of a cached image, without any request. */
  peek(repositoryId: number, path: string): string | null {
    return this.entries.get(keyOf(repositoryId, path))?.url ?? null;
  }

  /**
   * Loads an image, from the cache when it is there. An `AbortSignal` that
   * fires before the request starts rejects the load with an `AbortError`,
   * and drops the request when no other load waits for it; once started, a
   * request always finishes, and its image is cached.
   */
  load(repositoryId: number, path: string, signal?: AbortSignal): Promise<ImageResult> {
    const key = keyOf(repositoryId, path);
    const entry = this.entries.get(key);
    if (entry) {
      return Promise.resolve({ kind: 'loaded', url: entry.url });
    }
    let task = this.loads.get(key);
    if (!task) {
      task = this.schedule(key, repositoryId, path, false, null);
      this.loads.set(key, task);
    }
    return this.wait(task, signal);
  }

  /**
   * Counts a user of a loaded image; the returned function releases it, once.
   * An image with no users is kept among the 100 most recently unused.
   */
  use(repositoryId: number, path: string): () => void {
    const key = keyOf(repositoryId, path);
    const entry = this.entries.get(key);
    if (!entry) {
      return () => undefined;
    }
    entry.users++;
    this.unused.delete(key);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      entry.users--;
      if (entry.users === 0 && this.entries.get(key) === entry) {
        this.unused.add(key);
        this.trim();
      }
    };
  }

  /** Revalidates the cached images of these paths, or all of the repository's. */
  revalidate(repositoryId: number, paths: readonly string[] | 'all'): void {
    this.revalidateWhere(repositoryId, entry => paths === 'all' || paths.includes(entry.path));
  }

  /** Revalidates the cached images directly in these folders, or all of the repository's. */
  revalidateFolders(repositoryId: number, folders: readonly string[] | 'all'): void {
    this.revalidateWhere(repositoryId, entry => folders === 'all' || folders.includes(parentOf(entry.path)));
  }

  /** Revokes every URL and forgets every image; nothing loads afterwards. */
  destroy(): void {
    this.destroyed = true;
    for (const entry of this.entries.values()) {
      URL.revokeObjectURL(entry.url);
    }
    this.entries.clear();
    this.unused.clear();
    this.queue.length = 0;
  }

  private revalidateWhere(repositoryId: number, matches: (entry: Entry) => boolean): void {
    for (const [ key, entry ] of this.entries) {
      if (entry.repositoryId === repositoryId && matches(entry) && !this.revalidations.has(key)) {
        const task = this.schedule(key, repositoryId, entry.path, true, entry.etag);
        this.revalidations.set(key, task);
      }
    }
  }

  private schedule(key: string, repositoryId: number, path: string, revalidation: boolean, etag: string | null): Task {
    let finish: (result: ImageResult) => void = () => undefined;
    const done = new Promise<ImageResult>(resolve => (finish = resolve));
    const task: Task = { key, repositoryId, path, revalidation, etag, started: false, waiters: 0, done, finish };
    this.queue.push(task);
    queueMicrotask(() => this.pump());
    return task;
  }

  private wait(task: Task, signal: AbortSignal | undefined): Promise<ImageResult> {
    task.waiters++;
    if (!signal) {
      return task.done;
    }
    return new Promise<ImageResult>((resolve, reject) => {
      const abort = () => {
        if (task.started) {
          return;
        }
        task.waiters--;
        if (task.waiters === 0) {
          this.queue.splice(this.queue.indexOf(task), 1);
          this.loads.delete(task.key);
        }
        reject(new DOMException('The image scrolled away before its turn.', 'AbortError'));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      void task.done.then(result => {
        signal.removeEventListener('abort', abort);
        resolve(result);
      });
    });
  }

  private pump(): void {
    while (!this.destroyed && this.running < IMAGE_REQUEST_LIMIT && this.queue.length > 0) {
      const task = this.queue.shift() as Task;
      task.started = true;
      this.running++;
      void this.fetch(task)
        .then(fetched => this.settle(task, fetched))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private async fetch(task: Task): Promise<Fetched> {
    const headers = task.etag === null ? undefined : new HttpHeaders({ 'If-None-Match': task.etag });
    try {
      const response: HttpResponse<Blob> = await firstValueFrom(
        this.http.get(`/api/v1/repositories/${encodeURIComponent(task.repositoryId)}/image`, {
          params: { path: task.path },
          headers,
          responseType: 'blob',
          observe: 'response'
        })
      );
      if (response.status === 304) {
        return { kind: 'same' };
      }
      return response.body
        ? { kind: 'loaded', blob: response.body, etag: response.headers.get('ETag') }
        : { kind: 'failed', reason: 'error' };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 304) {
        return { kind: 'same' };
      }
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      return { kind: 'failed', reason: REASONS[status] ?? 'error' };
    }
  }

  private settle(task: Task, fetched: Fetched): void {
    (task.revalidation ? this.revalidations : this.loads).delete(task.key);
    if (this.destroyed) {
      task.finish({ kind: 'failed', reason: 'error' });
      return;
    }
    if (!task.revalidation) {
      task.finish(fetched.kind === 'loaded' ? this.store(task, fetched) : failure(fetched));
      return;
    }
    const entry = this.entries.get(task.key);
    // A network failure keeps the image shown; only an answer about the file itself changes it.
    if (!entry || fetched.kind === 'same' || (fetched.kind === 'failed' && fetched.reason === 'error')) {
      task.finish(entry ? { kind: 'loaded', url: entry.url } : { kind: 'failed', reason: 'error' });
      return;
    }
    const previous = entry.url;
    let result: ImageResult;
    if (fetched.kind === 'loaded') {
      // The same entry, so that its users stay counted.
      entry.url = URL.createObjectURL(fetched.blob);
      entry.etag = fetched.etag;
      result = { kind: 'loaded', url: entry.url };
    } else {
      this.entries.delete(task.key);
      this.unused.delete(task.key);
      result = failure(fetched);
    }
    this.changes.next({ repositoryId: task.repositoryId, path: task.path, result });
    // The preview has swapped its images by now.
    URL.revokeObjectURL(previous);
    task.finish(result);
  }

  private store(task: Task, fetched: Extract<Fetched, { kind: 'loaded'; }>): ImageResult {
    const url = URL.createObjectURL(fetched.blob);
    this.entries.set(task.key, { repositoryId: task.repositoryId, path: task.path, url, etag: fetched.etag, users: 0 });
    this.unused.add(task.key);
    this.trim();
    return { kind: 'loaded', url };
  }

  private trim(): void {
    for (const key of this.unused) {
      if (this.unused.size <= UNUSED_IMAGE_LIMIT) {
        return;
      }
      const entry = this.entries.get(key);
      this.unused.delete(key);
      if (entry) {
        this.entries.delete(key);
        URL.revokeObjectURL(entry.url);
      }
    }
  }
}

function failure(fetched: Fetched): ImageResult {
  return { kind: 'failed', reason: fetched.kind === 'failed' ? fetched.reason : 'error' };
}
