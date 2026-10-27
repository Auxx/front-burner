import type { PushEvent } from '@front-burner/shared-contracts';
import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';

/** One open push channel stream: one client tab of one session (A-3.10). */
export interface EventStream {
  readonly userId: number;
  readonly sessionId: string;
  send(event: PushEvent): void;
  /** Ends the stream; the hub has already forgotten it. */
  close(): void;
}

/**
 * Keeps the open push channel streams and delivers events to the streams of
 * their user only (A-3.10, A-3.11).
 */
@Injectable()
export class EventsHub implements BeforeApplicationShutdown {
  private readonly streams = new Set<EventStream>();

  /** Adds a stream; the returned function removes it without closing it. */
  open(stream: EventStream): () => void {
    this.streams.add(stream);
    return () => this.streams.delete(stream);
  }

  publish(userId: number, event: PushEvent): void {
    for (const stream of this.streams) {
      if (stream.userId === userId) {
        stream.send(event);
      }
    }
  }

  /** Closes the streams of a revoked session, so that it keeps no authenticated channel (A-7.2). */
  closeSession(sessionId: string): void {
    this.closeWhere(stream => stream.sessionId === sessionId);
  }

  closeAll(): void {
    this.closeWhere(() => true);
  }

  /** Before the HTTP server closes, which would otherwise wait for every open stream (A-1.14). */
  beforeApplicationShutdown(): void {
    this.closeAll();
  }

  private closeWhere(predicate: (stream: EventStream) => boolean): void {
    for (const stream of [ ...this.streams ]) {
      if (predicate(stream)) {
        this.streams.delete(stream);
        stream.close();
      }
    }
  }
}
