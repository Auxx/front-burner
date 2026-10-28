import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { PushEvent } from '@front-burner/shared-contracts';
import { EMPTY, Observable, share, Subject, switchMap } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';
import { INITIAL_SSE_STATE, parseSse } from './sse-parser';

const EVENTS_URL = '/api/v1/events';

/** The waits before each reconnect; the last one repeats (A-8.5). */
export const RECONNECT_DELAYS_MS = [ 1000, 2000, 5000, 10_000, 30_000 ] as const;

/** A connection that lasted this long starts the backoff again. */
export const STABLE_CONNECTION_MS = 60_000;

/** Every event type the client knows; a new member of `PushEvent` fails to compile until it is listed. */
const EVENT_TYPES: Record<PushEvent['type'], true> = {
  'repository.status': true,
  'job.progress': true,
  'job.finished': true,
  'files.changed': true
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
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly reconnectedSubject = new Subject<void>();

  /** Emits after every successful connect, the first included. */
  readonly reconnected: Observable<void> = this.reconnectedSubject.asObservable();

  /** Opens with the first subscriber while logged in; closes with the last one or on logout. */
  readonly events: Observable<PushEvent> = toObservable(this.auth.loggedIn).pipe(
    switchMap(loggedIn => loggedIn ? this.connection() : EMPTY),
    share()
  );

  /** Connects, and reconnects until unsubscribed or the backend refuses the session. */
  private connection(): Observable<PushEvent> {
    return new Observable<PushEvent>(subscriber => {
      let closed = false;
      let controller: AbortController | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let failures = 0;

      /** `afterRefresh`: the token was just refreshed, so another expiry waits for the backoff. */
      const connect = async (afterRefresh = false): Promise<void> => {
        retry = undefined;
        const token = this.auth.authToken();
        if (closed || token === undefined) {
          return;
        }
        controller = new AbortController();
        const startedAt = Date.now();
        try {
          const response = await fetch(EVENTS_URL, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            cache: 'no-store',
            signal: controller.signal
          });
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
          await this.read(response.body, event => subscriber.next(event));
        } catch {
          // A lost connection, a stopped backend or a failed refresh: retried below.
        } finally {
          controller = undefined;
        }
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
