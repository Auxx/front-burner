import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { PushEvent } from '@front-burner/shared-contracts';
import { BehaviorSubject, distinctUntilChanged, EMPTY, Observable, share, Subject, switchMap } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';
import { VERSION_HEADER, VersionCheckService } from '../version-check/version-check.service';
import { INITIAL_SSE_STATE, parseSse } from './sse-parser';

const EVENTS_URL = '/api/v1/events';

/** The waits before each reconnect; the last one repeats (A-8.5). */
export const RECONNECT_DELAYS_MS = [ 1000, 2000, 5000, 10_000, 30_000 ] as const;

/** A connection that lasted this long starts the backoff again. */
export const STABLE_CONNECTION_MS = 60_000;

/** How long before its auth token expires a stream is handed over to one with a new token (A-3.10). */
export const RENEW_BEFORE_EXPIRY_MS = 30_000;

/** The longest wait `setTimeout` keeps: longer ones fire at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Every event type the client knows; a new member of `PushEvent` fails to compile until it is listed. */
const EVENT_TYPES: Record<PushEvent['type'], true> = {
  'repository.status': true,
  'repository.warning': true,
  'repository.removed': true,
  'job.progress': true,
  'job.finished': true,
  'files.changed': true,
  'git.changed': true,
  'commit-author.changed': true,
  'key.unlocked': true,
  'key.locked': true
};

function toPushEvent(type: string, data: string): PushEvent | undefined {
  if (!Object.prototype.hasOwnProperty.call(EVENT_TYPES, type)) {
    return undefined;
  }
  try {
    const event = JSON.parse(data) as { type?: unknown; } | null;
    // Checked by type only: web-core has no Zod (NF-2.9).
    return typeof event === 'object' && event !== null && event.type === type ? event as PushEvent : undefined;
  } catch {
    return undefined;
  }
}

/** The `code` of an error answer, if it has one. */
async function codeOf(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { code?: unknown; } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The push channel of A-3.10 and A-8.5: reads the backend's Server-Sent Events
 * with `fetch`, so that the auth token travels in the header, and reconnects
 * on its own. Events are notifications only: after every (re)connect,
 * {@link reconnected} tells services to reload their state over REST (A-3.11).
 */
@Injectable({ providedIn: 'root' })
export class PushChannelService {
  private readonly auth = inject(AuthSessionService);
  private readonly versions = inject(VersionCheckService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly reconnectedSubject = new Subject<void>();

  /** Emits after every successful connect, the first included. */
  readonly reconnected: Observable<void> = this.reconnectedSubject.asObservable();

  /** The repository this tab views, or `null` (A-3.12). */
  private readonly viewed = new BehaviorSubject<number | null>(null);

  /**
   * Opens with the first subscriber while logged in; closes with the last one or on logout.
   * A change of the viewed repository replaces the stream, so that there is one, on the last one (A-3.12).
   */
  readonly events: Observable<PushEvent> = toObservable(this.auth.loggedIn).pipe(
    switchMap(loggedIn =>
      loggedIn
        ? this.viewed.pipe(distinctUntilChanged(), switchMap(repositoryId => this.connection(repositoryId)))
        : EMPTY
    ),
    share()
  );

  constructor() {
    // The last repository may not be the next user's.
    let wasLoggedIn = this.auth.loggedIn();
    effect(() => {
      const loggedIn = this.auth.loggedIn();
      if (wasLoggedIn && !loggedIn) {
        this.viewed.next(null);
      }
      wasLoggedIn = loggedIn;
    });
  }

  /**
   * Tells the backend which repository this tab views, or `null` for none (A-3.12): the stream is reopened
   * with `?repository=<id>`, which counts as a reconnect. Remembered while nothing is connected, and forgotten on
   * logout. Anything but a positive integer means none.
   */
  view(repositoryId: number | null): void {
    this.viewed.next(repositoryId !== null && Number.isInteger(repositoryId) && repositoryId > 0 ? repositoryId : null);
  }

  /**
   * Opens the stream at `url` with `token`; aborted with `controller`. Its
   * answer's version goes to the version check, as `HttpClient`'s do (A-8.7):
   * a tab that only listens learns of an upgrade when the stream reconnects.
   */
  private async open(url: string, token: string, controller: AbortController): Promise<Response> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      cache: 'no-store',
      signal: controller.signal
    });
    this.versions.seen(response.headers.get(VERSION_HEADER));
    return response;
  }

  /**
   * Connects, and reconnects until unsubscribed or the backend refuses the session.
   *
   * The backend closes a stream when its auth token expires (A-3.10). Shortly
   * before that, the token is renewed and a second stream opened with it; the
   * first is closed only once the second is open. No event can fall between
   * them, so this is not a reconnect, and the services keep their state rather
   * than reading it all again, which the screen would show (A-3.11). A renewal
   * that fails leaves the first stream to end at the expiry and reconnect.
   */
  private connection(repositoryId: number | null): Observable<PushEvent> {
    const url = repositoryId === null ? EVENTS_URL : `${EVENTS_URL}?repository=${repositoryId}`;
    return new Observable<PushEvent>(subscriber => {
      let closed = false;
      /** The current stream's; a stream that is no longer current stops without reconnecting. */
      let controller: AbortController | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let renewal: ReturnType<typeof setTimeout> | undefined;
      let failures = 0;

      /** Waits for the backoff after the current stream, started at `startedAt`, ended or failed. */
      const reconnectLater = (startedAt: number) => {
        controller = undefined;
        clearTimeout(renewal);
        if (closed) {
          return;
        }
        if (Date.now() - startedAt >= STABLE_CONNECTION_MS) {
          failures = 0;
        }
        const delay = RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)];
        failures++;
        retry = setTimeout(() => void connect(), delay);
      };

      /** Delivers the events of `response`, the stream of `own` opened with `token`, until it ends. */
      const follow = async (
        own: AbortController,
        token: string,
        response: Response,
        startedAt: number
      ): Promise<void> => {
        const expiresAt = this.auth.authTokenExpiresAt();
        if (expiresAt !== undefined) {
          // A token renewed while the stream opened leaves its expiry unknown: it is handed over at once.
          scheduleRenewal(own, token, this.auth.authToken() === token ? expiresAt : Date.now());
        }
        try {
          if (response.body === null) {
            throw new Error('The push channel answered without a body');
          }
          await this.read(response.body, event => subscriber.next(event));
        } catch {
          // A lost connection or a stopped backend: reconnected below.
        }
        if (controller === own) {
          reconnectLater(startedAt);
        }
      };

      /** `afterRefresh`: the token was just refreshed, so another expiry waits for the backoff. */
      const connect = async (afterRefresh = false): Promise<void> => {
        retry = undefined;
        const token = this.auth.authToken();
        if (closed || token === undefined) {
          return;
        }
        const own = new AbortController();
        controller = own;
        const startedAt = Date.now();
        try {
          const response = await this.open(url, token, own);
          if (response.status === 401) {
            const code = await codeOf(response);
            if (code === 'auth-token-expired' && !afterRefresh) {
              await this.auth.refresh(token);
              void connect(true);
              return;
            }
            if (code !== 'auth-token-expired') {
              // The session was revoked or the user disabled: this request bypasses the interceptor,
              // so the channel ends the session itself, as the interceptor would (LG-40).
              void this.auth.expire(this.router.url);
              return;
            }
            throw new Error('The refreshed auth token was refused as expired');
          }
          if (!response.ok || response.body === null) {
            throw new Error(`The push channel answered ${response.status}`);
          }
          this.reconnectedSubject.next();
          void follow(own, token, response, startedAt);
          return;
        } catch {
          // A lost connection, a stopped backend or a failed refresh: retried below.
        }
        if (controller === own) {
          reconnectLater(startedAt);
        }
      };

      /**
       * Hands the stream of `own`, opened with `token`, over to a new one before `token` expires at `expiresAt`
       * (see {@link connection}).
       */
      const scheduleRenewal = (own: AbortController, token: string, expiresAt: number) => {
        clearTimeout(renewal);
        // Half the time left for a token that lives less than twice the lead, so that renewals never run back to back.
        const left = expiresAt - Date.now();
        const at = left - Math.min(RENEW_BEFORE_EXPIRY_MS, left / 2);
        renewal = setTimeout(() => void handOver(own, token, expiresAt), Math.min(Math.max(0, at), MAX_TIMEOUT_MS));
      };

      const handOver = async (old: AbortController, oldToken: string, expiresAt: number): Promise<void> => {
        const current = this.auth.authToken();
        if (closed || controller !== old || current === undefined) {
          return;
        }
        if (expiresAt - Date.now() > RENEW_BEFORE_EXPIRY_MS) {
          // Woken early by the limit of `setTimeout`.
          scheduleRenewal(old, oldToken, expiresAt);
          return;
        }
        const next = new AbortController();
        const startedAt = Date.now();
        try {
          // A token that another tab, or a request of this one, renewed meanwhile is used as it is.
          const token = current === oldToken ? await this.auth.renew(oldToken) : current;
          const response = await this.open(url, token, next);
          if (!response.ok || response.body === null) {
            throw new Error(`The push channel answered ${response.status}`);
          }
          if (closed || controller !== old) {
            next.abort();
            return;
          }
          controller = next;
          old.abort();
          void follow(next, token, response, startedAt);
        } catch {
          // The first stream carries on until its token expires, then reconnects.
          next.abort();
        }
      };

      const onVisible = () => {
        if (this.document.visibilityState === 'visible' && retry !== undefined) {
          clearTimeout(retry);
          void connect();
        }
      };
      this.document.addEventListener('visibilitychange', onVisible);
      void connect();

      return () => {
        closed = true;
        clearTimeout(retry);
        clearTimeout(renewal);
        controller?.abort();
        this.document.removeEventListener('visibilitychange', onVisible);
      };
    });
  }

  /** Reads the stream until it ends. */
  private async read(body: ReadableStream<Uint8Array>, emit: (event: PushEvent) => void): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let state = INITIAL_SSE_STATE;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      const parsed = parseSse(decoder.decode(value, { stream: true }), state);
      state = parsed.state;
      for (const { type, data } of parsed.events) {
        const event = toPushEvent(type, data);
        if (event !== undefined) {
          emit(event);
        }
      }
    }
  }
}
