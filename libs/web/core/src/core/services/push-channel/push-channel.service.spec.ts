import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PushEvent } from '@front-burner/shared-contracts';
import type { Subscription } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';
import { PushChannelService, RENEW_BEFORE_EXPIRY_MS } from './push-channel.service';

/** One request of the fake `fetch`: the test writes to its stream or ends it. */
interface FakeStream {
  init: RequestInit;
  write(text: string): void;
  end(): void;
}

const encoder = new TextEncoder();
const finished: PushEvent = { type: 'job.finished', jobId: 1, outcome: 'done' };
/** What the service reads of a response; jsdom's streams and Node's `Response` do not mix. */
function fakeResponse(status: number, body: ReadableStream<Uint8Array> | null, json?: unknown): Response {
  return { status, ok: status >= 200 && status < 300, body, json: () => Promise.resolve(json) } as Response;
}

/** The life of the tokens of the handover tests: 15 minutes, as the backend's default. */
const TOKEN_LIFE_MS = 15 * 60_000;

const sse = (event: PushEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

describe('PushChannelService', () => {
  let loggedIn: ReturnType<typeof signal<boolean>>;
  let token: string;
  let refresh: ReturnType<typeof vi.fn<(failed: string) => Promise<string>>>;
  let expire: ReturnType<typeof vi.fn<(returnUrl?: string) => Promise<void>>>;
  /** When `token` expires; unknown unless a test sets it. */
  let expiresAt: number | undefined;
  let renew: ReturnType<typeof vi.fn<(token: string) => Promise<string>>>;
  let fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;
  /** What the next requests answer; a stream when empty. */
  let answers: (() => Response)[];
  let streams: FakeStream[];
  let service: PushChannelService;
  let subscription: Subscription | undefined;

  /** Lets the fake requests and their reads settle. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  function streamResponse(init: RequestInit): Response {
    const chunks: Uint8Array[] = [];
    let ended = false;
    let failure: unknown;
    let wake = () => undefined as void;
    const changed = () => wake();
    // jsdom has no ReadableStream; the service only reads the body's reader.
    const reader = {
      read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        while (chunks.length === 0 && !ended && failure === undefined) {
          await new Promise<void>(resolve => (wake = resolve));
        }
        if (failure !== undefined) {
          throw failure;
        }
        const value = chunks.shift();
        return value === undefined ? { done: true, value: undefined } : { done: false, value };
      }
    };
    init.signal?.addEventListener('abort', () => {
      failure = new DOMException('Aborted', 'AbortError');
      changed();
    });
    streams.push({
      init,
      write: text => {
        chunks.push(encoder.encode(text));
        changed();
      },
      end: () => {
        ended = true;
        changed();
      }
    });
    return fakeResponse(200, { getReader: () => reader } as unknown as ReadableStream<Uint8Array>);
  }

  const refused = (code: string) => () => fakeResponse(401, null, { code, message: '', params: {} });

  function subscribe(): PushEvent[] {
    const received: PushEvent[] = [];
    subscription = service.events.subscribe(event => received.push(event));
    TestBed.tick();
    return received;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] });
    loggedIn = signal(true);
    token = 'token-1';
    refresh = vi.fn(() => {
      token = 'token-2';
      return Promise.resolve(token);
    });
    expire = vi.fn(() => Promise.resolve());
    expiresAt = undefined;
    renew = vi.fn(() => {
      token = `${token}-renewed`;
      expiresAt = Date.now() + TOKEN_LIFE_MS;
      return Promise.resolve(token);
    });
    answers = [];
    streams = [];
    fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve(answers.shift()?.() ?? streamResponse(init)));
    vi.stubGlobal('fetch', fetch);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthSessionService,
          useValue: { loggedIn, authToken: () => token, authTokenExpiresAt: () => expiresAt, refresh, renew, expire }
        }
      ]
    });
    service = TestBed.inject(PushChannelService);
  });

  afterEach(() => {
    subscription?.unsubscribe();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('delivers events', async () => {
    const received = subscribe();
    await settle();

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/events',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' })
      })
    );
    streams[0]?.write(': keep-alive\n\n');
    streams[0]?.write(sse({ type: 'job.progress', jobId: 1, percent: 50 }).slice(0, 10));
    streams[0]?.write(sse({ type: 'job.progress', jobId: 1, percent: 50 }).slice(10));
    streams[0]?.write('event: repository.deleted\ndata: {"type":"repository.deleted"}\n\n');
    streams[0]?.write('event: job.finished\ndata: not json\n\n');
    streams[0]?.write(sse(finished));
    await settle();

    expect(received).toEqual([ { type: 'job.progress', jobId: 1, percent: 50 }, finished ]);
  });

  it('delivers commit-author.changed', async () => {
    const received = subscribe();
    await settle();

    streams[0]?.write(sse({ type: 'commit-author.changed' }));
    await settle();

    expect(received).toEqual([ { type: 'commit-author.changed' } ]);
  });

  it('delivers git.changed', async () => {
    const received = subscribe();
    await settle();

    streams[0]?.write(sse({ type: 'git.changed', repositoryId: 3 }));
    await settle();

    expect(received).toEqual([ { type: 'git.changed', repositoryId: 3 } ]);
  });

  it('shares one stream between subscribers', async () => {
    const first: PushEvent[] = [];
    const second: PushEvent[] = [];
    subscription = service.events.subscribe(event => first.push(event));
    subscription.add(service.events.subscribe(event => second.push(event)));
    TestBed.tick();
    await settle();

    streams[0]?.write(sse(finished));
    await settle();

    expect(fetch).toHaveBeenCalledOnce();
    expect(first).toEqual([ finished ]);
    expect(second).toEqual([ finished ]);
  });

  it('announces every reconnect', async () => {
    const reconnects = vi.fn();
    service.reconnected.subscribe(reconnects);
    subscribe();
    await settle();
    expect(reconnects).toHaveBeenCalledTimes(1);

    streams[0]?.end();
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reconnects).toHaveBeenCalledTimes(2);
  });

  it('reconnects with backoff', async () => {
    const down = () => {
      throw new TypeError('Failed to fetch');
    };
    answers = [ down, down, down ];
    subscribe();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('starts the backoff again after a connection that lasted a minute', async () => {
    answers = [ () => {
      throw new TypeError('Failed to fetch');
    } ];
    subscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    streams[0]?.end();
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('refreshes the token on auth-token-expired and reconnects', async () => {
    answers = [ refused('auth-token-expired') ];
    subscribe();
    await settle();

    expect(refresh).toHaveBeenCalledWith('token-1');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(streams[0]?.init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });

  it('refreshes once per attempt, then waits for the backoff', async () => {
    answers = [ refused('auth-token-expired'), refused('auth-token-expired') ];
    subscribe();
    await settle();

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(streams).toHaveLength(1);
  });

  describe('handing the stream over before its token expires (A-3.10)', () => {
    const renewalAt = TOKEN_LIFE_MS - RENEW_BEFORE_EXPIRY_MS;
    const authorization = (stream: FakeStream | undefined) =>
      (stream?.init.headers as Record<string, string> | undefined)?.['Authorization'];

    beforeEach(() => {
      expiresAt = Date.now() + TOKEN_LIFE_MS;
    });

    it('opens a stream with a renewed token before closing the first, without a reconnect', async () => {
      const reconnects = vi.fn();
      service.reconnected.subscribe(reconnects);
      const received = subscribe();
      await settle();

      await vi.advanceTimersByTimeAsync(renewalAt - 1);
      expect(renew).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(renew).toHaveBeenCalledWith('token-1');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(authorization(streams[1])).toBe('Bearer token-1-renewed');
      expect(streams[0]?.init.signal?.aborted).toBe(true);
      expect(streams[1]?.init.signal?.aborted).toBe(false);
      expect(reconnects).toHaveBeenCalledOnce();

      streams[1]?.write(sse(finished));
      await settle();
      expect(received).toEqual([ finished ]);
      // The first stream, closed, does not reconnect.
      await vi.advanceTimersByTimeAsync(RENEW_BEFORE_EXPIRY_MS);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('hands each new stream over in turn', async () => {
      subscribe();
      await settle();

      await vi.advanceTimersByTimeAsync(renewalAt);
      await vi.advanceTimersByTimeAsync(TOKEN_LIFE_MS - RENEW_BEFORE_EXPIRY_MS);

      expect(renew).toHaveBeenCalledTimes(2);
      expect(authorization(streams[2])).toBe('Bearer token-1-renewed-renewed');
      expect(streams.filter(stream => !stream.init.signal?.aborted)).toHaveLength(1);
    });

    it('renews a token that lives less than a minute at half its life', async () => {
      expiresAt = Date.now() + 2000;
      subscribe();
      await settle();

      await vi.advanceTimersByTimeAsync(999);
      expect(renew).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(renew).toHaveBeenCalledOnce();
    });

    it('uses a token renewed elsewhere meanwhile as it is', async () => {
      subscribe();
      await settle();
      token = 'token-from-another-tab';
      expiresAt = Date.now() + TOKEN_LIFE_MS;

      await vi.advanceTimersByTimeAsync(renewalAt);

      expect(renew).not.toHaveBeenCalled();
      expect(authorization(streams[1])).toBe('Bearer token-from-another-tab');
      expect(streams[0]?.init.signal?.aborted).toBe(true);
    });

    it('keeps the first stream when the renewal fails, and reconnects when it ends', async () => {
      renew.mockRejectedValue(new Error('unreachable'));
      const reconnects = vi.fn();
      service.reconnected.subscribe(reconnects);
      subscribe();
      await settle();

      await vi.advanceTimersByTimeAsync(renewalAt);
      expect(renew).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
      expect(streams[0]?.init.signal?.aborted).toBe(false);

      streams[0]?.end();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(reconnects).toHaveBeenCalledTimes(2);
    });

    it('keeps the first stream when the second does not open', async () => {
      subscribe();
      await settle();
      answers = [ () => fakeResponse(503, null) ];

      await vi.advanceTimersByTimeAsync(renewalAt);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(streams).toHaveLength(1);
      expect(streams[0]?.init.signal?.aborted).toBe(false);
    });

    it('renews nothing once closed', async () => {
      subscribe();
      await settle();
      subscription?.unsubscribe();

      await vi.advanceTimersByTimeAsync(TOKEN_LIFE_MS);

      expect(renew).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  it('ends the session and stops on unauthenticated', async () => {
    answers = [ refused('unauthenticated') ];
    subscribe();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetch).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(expire).toHaveBeenCalledOnce();
  });

  it('closes on logout', async () => {
    subscribe();
    await settle();
    const { signal } = streams[0]?.init ?? {};

    loggedIn.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('closes with the last subscriber', async () => {
    subscribe();
    await settle();

    subscription?.unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(streams[0]?.init.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('opens only while logged in', async () => {
    loggedIn.set(false);
    subscribe();
    await settle();
    expect(fetch).not.toHaveBeenCalled();

    loggedIn.set(true);
    TestBed.tick();
    await settle();
    expect(fetch).toHaveBeenCalledOnce();
  });

  describe('viewing a repository (A-3.12)', () => {
    const urls = () => fetch.mock.calls.map(([ url ]) => url);

    it('opens the stream for the repository', async () => {
      service.view(7);
      subscribe();
      await settle();

      expect(urls()).toEqual([ '/api/v1/events?repository=7' ]);
    });

    it('ignores what is not a positive integer', async () => {
      service.view(0);
      service.view(1.5);
      service.view(Number.NaN);
      subscribe();
      await settle();

      expect(urls()).toEqual([ '/api/v1/events' ]);
    });

    it('reopens the stream when the repository changes, and says it reconnected', async () => {
      const reconnects = vi.fn();
      service.reconnected.subscribe(reconnects);
      service.view(7);
      subscribe();
      await settle();

      service.view(8);
      await settle();

      expect(urls()).toEqual([ '/api/v1/events?repository=7', '/api/v1/events?repository=8' ]);
      expect(streams[0]?.init.signal?.aborted).toBe(true);
      expect(reconnects).toHaveBeenCalledTimes(2);

      service.view(null);
      await settle();
      expect(urls().at(-1)).toBe('/api/v1/events');
    });

    it('keeps one stream, on the last repository', async () => {
      subscribe();
      await settle();

      service.view(1);
      service.view(2);
      service.view(3);
      await settle();

      expect(streams.filter(stream => stream.init.signal?.aborted === false)).toHaveLength(1);
      expect(urls().at(-1)).toBe('/api/v1/events?repository=3');
      expect(fetch.mock.calls.at(-1)?.[1].signal?.aborted).toBe(false);
    });

    it('does not reopen for the same repository', async () => {
      service.view(7);
      subscribe();
      await settle();

      service.view(7);
      service.view(7);
      await settle();

      expect(fetch).toHaveBeenCalledOnce();
    });

    it('keeps the repository through a reconnect', async () => {
      service.view(7);
      answers = [ refused('auth-token-expired') ];
      subscribe();
      await settle();
      expect(urls()).toEqual([ '/api/v1/events?repository=7', '/api/v1/events?repository=7' ]);

      streams[0]?.end();
      await vi.advanceTimersByTimeAsync(1000);

      expect(urls().at(-1)).toBe('/api/v1/events?repository=7');
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('forgets the repository on logout', async () => {
      service.view(7);
      subscribe();
      await settle();

      loggedIn.set(false);
      TestBed.tick();
      loggedIn.set(true);
      TestBed.tick();
      await settle();

      expect(urls().at(-1)).toBe('/api/v1/events');
    });

    it('remembers the repository viewed while logged out', async () => {
      loggedIn.set(false);
      TestBed.tick();
      service.view(7);
      subscribe();
      loggedIn.set(true);
      TestBed.tick();
      await settle();

      expect(urls()).toEqual([ '/api/v1/events?repository=7' ]);
    });
  });

  it('reconnects when the page becomes visible', async () => {
    answers = [ () => {
      throw new TypeError('Failed to fetch');
    } ];
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    subscribe();
    await settle();

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);

    // An open stream is left alone.
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
