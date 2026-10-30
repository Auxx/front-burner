import { HttpErrorResponse, type HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { catchError, switchMap, throwError, timer } from 'rxjs';

import { ImageCache, type ImageChange, type ImageResult, UNUSED_IMAGE_LIMIT } from './image-cache';

const URL_OF = (path: string) => `/api/v1/repositories/7/image?path=${path}`;

/** Lets queued requests start and answers settle. */
const tick = () => new Promise(resolve => setTimeout(resolve));

/** The token the fake interceptor sends; `expired` makes the next request fail as the real one sees it. */
let token = 'token-1';
let refreshes = 0;

/** Adds the token like the web client's auth interceptor, and refreshes it once on `auth-token-expired`. */
const authInterceptor: HttpInterceptorFn = (request, next) => {
  const sent = token;
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${sent}` } })).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return timer(0).pipe(switchMap(() => {
        refreshes++;
        token = 'token-2';
        return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
      }));
    })
  );
};

describe('ImageCache', () => {
  let cache: ImageCache;
  let http: HttpTestingController;
  let created: number;
  let revoked: string[];

  beforeEach(() => {
    token = 'token-1';
    refreshes = 0;
    created = 0;
    revoked = [];
    URL.createObjectURL = () => `blob:${++created}`;
    URL.revokeObjectURL = (url: string) => void revoked.push(url);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([ authInterceptor ])),
        provideHttpClientTesting(),
        ImageCache
      ]
    });
    cache = TestBed.inject(ImageCache);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function answer(request: TestRequest, etag = '"1-1"'): void {
    request.flush(new Blob([ 'png' ]), { headers: { ETag: etag } });
  }

  function fail(request: TestRequest, status: number): void {
    request.flush(new Blob([ '{}' ]), { status, statusText: 'Error' });
  }

  async function loaded(path: string): Promise<string> {
    const result = cache.load(7, path);
    await tick();
    answer(http.expectOne(URL_OF(path)));
    const value = await result;
    return value.kind === 'loaded' ? value.url : '';
  }

  it('loads an image as a blob URL with the token', async () => {
    const result = cache.load(7, 'docs/img/flow.png');
    await tick();
    const request = http.expectOne(URL_OF('docs/img/flow.png'));

    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.urlWithParams).not.toContain('token');
    expect(request.request.responseType).toBe('blob');
    answer(request);

    expect(await result).toEqual({ kind: 'loaded', url: 'blob:1' });
    expect(cache.peek(7, 'docs/img/flow.png')).toBe('blob:1');
    expect(await cache.load(7, 'docs/img/flow.png')).toEqual({ kind: 'loaded', url: 'blob:1' });
  });

  it('maps each error status to its reason', async () => {
    const cases: [ number, ImageResult ][] = [
      [ 404, { kind: 'failed', reason: 'not-found' } ],
      [ 413, { kind: 'failed', reason: 'too-large' } ],
      [ 415, { kind: 'failed', reason: 'unsupported' } ],
      [ 400, { kind: 'failed', reason: 'refused' } ],
      [ 500, { kind: 'failed', reason: 'error' } ],
      [ 0, { kind: 'failed', reason: 'error' } ]
    ];
    for (const [ status, expected ] of cases) {
      const result = cache.load(7, `${status}.png`);
      await tick();
      const request = http.expectOne(URL_OF(`${status}.png`));
      if (status === 0) {
        request.error(new ProgressEvent('error'));
      } else {
        fail(request, status);
      }

      expect(await result, String(status)).toEqual(expected);
    }
    // Failures are not cached: the next load tries again (IM-19).
    const again = cache.load(7, '404.png');
    await tick();
    answer(http.expectOne(URL_OF('404.png')));
    expect(await again).toEqual({ kind: 'loaded', url: 'blob:1' });
  });

  it('shares one request for the same path', async () => {
    const first = cache.load(7, 'a.png');
    const second = cache.load(7, 'a.png');
    await tick();
    answer(http.expectOne(URL_OF('a.png')));

    expect(await first).toEqual(await second);
    expect(created).toBe(1);
  });

  it('never runs more than four requests', async () => {
    const results = Array.from({ length: 6 }, (_, index) => cache.load(7, `${index}.png`));
    await tick();

    const first = http.match(() => true);
    expect(first.map(request => request.request.params.get('path'))).toEqual([ '0.png', '1.png', '2.png', '3.png' ]);
    answer(first[0] as TestRequest);
    await tick();
    // `match` takes the requests it returns, so only the new one is left.
    const next = http.match(() => true);
    expect(next.map(request => request.request.params.get('path'))).toEqual([ '4.png' ]);
    for (const request of [ ...first.slice(1), ...next ]) {
      answer(request);
    }
    await tick();
    answer(http.expectOne(URL_OF('5.png')));
    expect((await Promise.all(results)).every(result => result.kind === 'loaded')).toBe(true);
  });

  it('drops a waiting load whose images scrolled away', async () => {
    const busy = Array.from({ length: 4 }, (_, index) => cache.load(7, `${index}.png`));
    const controller = new AbortController();
    const dropped = cache.load(7, 'away.png', controller.signal);
    await tick();
    controller.abort();

    await expect(dropped).rejects.toThrow(/scrolled away/);
    for (const request of http.match(() => true)) {
      answer(request);
    }
    await Promise.all(busy);
    await tick();
    http.expectNone(URL_OF('away.png'));
  });

  it('revalidates with If-None-Match and keeps the URL on 304', async () => {
    const url = await loaded('docs/a.png');
    cache.revalidate(7, [ 'docs/a.png' ]);
    await tick();
    const request = http.expectOne(URL_OF('docs/a.png'));

    expect(request.request.headers.get('If-None-Match')).toBe('"1-1"');
    request.flush(null, { status: 304, statusText: 'Not Modified' });
    await tick();
    expect(cache.peek(7, 'docs/a.png')).toBe(url);
    expect(revoked).toEqual([]);
  });

  it('reports a changed image after revalidation', async () => {
    const changes: ImageChange[] = [];
    cache.changed.subscribe(change => changes.push(change));
    await loaded('docs/a.png');
    await loaded('docs/b.png');
    await loaded('other/c.png');
    cache.revalidateFolders(7, [ 'docs' ]);
    await tick();

    answer(http.expectOne(URL_OF('docs/a.png')), '"2-2"');
    fail(http.expectOne(URL_OF('docs/b.png')), 404);
    http.expectNone(URL_OF('other/c.png'));
    await tick();
    expect(changes).toEqual([
      { repositoryId: 7, path: 'docs/a.png', result: { kind: 'loaded', url: 'blob:4' } },
      { repositoryId: 7, path: 'docs/b.png', result: { kind: 'failed', reason: 'not-found' } }
    ]);
    expect(revoked).toEqual([ 'blob:1', 'blob:2' ]);
    expect(cache.peek(7, 'docs/b.png')).toBeNull();
  });

  it('keeps a cached image when revalidating it fails on the network', async () => {
    const url = await loaded('a.png');
    cache.revalidate(7, 'all');
    await tick();
    fail(http.expectOne(URL_OF('a.png')), 503);
    await tick();

    expect(cache.peek(7, 'a.png')).toBe(url);
  });

  it('revokes unused URLs over the limit', async () => {
    const used = await loaded('used.png');
    const release = cache.use(7, 'used.png');
    for (let index = 0; index <= UNUSED_IMAGE_LIMIT; index++) {
      await loaded(`${index}.png`);
    }

    expect(revoked).toEqual([ 'blob:2' ]);
    expect(cache.peek(7, 'used.png')).toBe(used);
    release();
    release();
    expect(revoked).toEqual([ 'blob:2', 'blob:3' ]);
    expect(cache.peek(7, 'used.png')).toBe(used);
  });

  it('refreshes an expired token and loads', async () => {
    const result = cache.load(7, 'a.png');
    await tick();
    http.expectOne(URL_OF('a.png')).flush(new Blob([ '{"code":"auth-token-expired"}' ]), {
      status: 401,
      statusText: 'Unauthorized'
    });
    await tick();
    const retried = http.expectOne(URL_OF('a.png'));

    expect(retried.request.headers.get('Authorization')).toBe('Bearer token-2');
    answer(retried);
    expect(await result).toEqual({ kind: 'loaded', url: 'blob:1' });
    expect(refreshes).toBe(1);
  });

  it('revokes every URL when destroyed', async () => {
    await loaded('a.png');
    cache.destroy();

    expect(revoked).toEqual([ 'blob:1' ]);
    expect(cache.peek(7, 'a.png')).toBeNull();
  });
});
