import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import type { PushEvent } from '@front-burner/shared-contracts';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { get, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { EventsModule } from '../events.module';
import { EventsHub } from './events-hub';
import { KEEP_ALIVE_MS } from './events.controller';

/** Mirrors the global auth guard of `server-feature-auth` (LG-34). */
@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<Request>().auth === undefined) {
      throw new ApiErrorException(401, 'unauthenticated');
    }
    return true;
  }
}

/** A raw response of the stream, read as it arrives. */
interface OpenStream {
  response: IncomingMessage;
  /** Resolves with the text received once it contains `text`. */
  waitFor(text: string): Promise<string>;
  ended: Promise<void>;
}

describe('EventsController', () => {
  let app: INestApplication;
  let hub: EventsHub;
  let port: number;

  function open(userId: number, expiresInMs = 60_000): Promise<OpenStream> {
    return new Promise((resolve, reject) => {
      const headers = { 'x-test-user': String(userId), 'x-test-expires': String(Date.now() + expiresInMs) };
      get({ port, path: '/api/v1/events', headers }, response => {
        let received = '';
        const waiters: (() => void)[] = [];
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          received += chunk;
          waiters.splice(0).forEach(wake => wake());
        });
        const ended = new Promise<void>(done => response.on('end', done));
        const waitFor = (text: string) =>
          new Promise<string>(done => {
            const check = () => (received.includes(text) ? done(received) : waiters.push(check));
            check();
          });
        resolve({ response, waitFor, ended });
      }).on('error', reject);
    });
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ EventsModule ],
      providers: [
        { provide: APP_GUARD, useClass: StubAuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    // Stands in for the auth middleware: the test names the user and the token's expiry in headers.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user');
      if (userId !== undefined) {
        const authTokenExpiresAt = Number(req.header('x-test-expires'));
        req.auth = { userId: Number(userId), sessionId: `session-${userId}`, authTokenExpiresAt };
      }
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    hub = app.get(EventsHub);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('sets the headers that stop buffering', async () => {
    const { response } = await open(1);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/event-stream\b/);
    expect(response.headers).toMatchObject({ 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  });

  it('sends a comment at once, so that a browser\'s fetch sees the stream open', async () => {
    const stream = await open(1);

    expect(await stream.waitFor('\n\n')).toBe(': connected\n\n');
  });

  it('writes events in SSE format', async () => {
    const stream = await open(1);
    const event: PushEvent = { type: 'job.finished', jobId: 3, outcome: 'done' };

    hub.publish(2, { type: 'job.progress', jobId: 9, percent: 10 });
    hub.publish(1, event);

    expect(await stream.waitFor('}\n\n')).toBe(
      `: connected\n\nevent: job.finished\ndata: ${JSON.stringify(event)}\n\n`
    );
  });

  it('sends a comment every 30 seconds', async () => {
    vi.useFakeTimers({ toFake: [ 'setInterval', 'clearInterval' ] });
    const stream = await open(1);

    vi.advanceTimersByTime(KEEP_ALIVE_MS);
    expect(await stream.waitFor(': keep-alive\n\n')).toBe(': connected\n\n: keep-alive\n\n');
    vi.advanceTimersByTime(KEEP_ALIVE_MS);
    expect(await stream.waitFor('keep-alive\n\n: keep-alive\n\n')).toBe(
      ': connected\n\n: keep-alive\n\n: keep-alive\n\n'
    );
  });

  it('closes a stream when its auth token expires', async () => {
    const stream = await open(1, 100);

    await stream.ended;
    hub.publish(1, { type: 'job.progress', jobId: 1, percent: 1 });
  });

  it('keeps a stream open when the auth token outlives a timer', async () => {
    const stream = await open(1, 30 * 86_400_000);

    const ended = await Promise.race([
      stream.ended.then(() => true),
      new Promise(done => setTimeout(done, 100, false))
    ]);

    expect(ended).toBe(false);
  });

  it('closes the streams of a session', async () => {
    const stream = await open(1);

    hub.closeSession('session-1');

    await stream.ended;
  });

  it('refuses a request without a token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/events').expect(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
  });
});
