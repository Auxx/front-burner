import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  E2E_ADMIN,
  E2E_SETUP_TOKEN,
  login,
  onboard,
  seed,
  type ServerProcess,
  startServerProcess
} from './support/server-process';

const ENTRIES = 1000;

describe('compressed answers (A-7.15)', () => {
  let server: ServerProcess;
  let token: string;
  let repositoryId: number;

  beforeAll(async () => {
    server = await startServerProcess({ FRONT_BURNER_SETUP_TOKEN: E2E_SETUP_TOKEN });
    await onboard(server);
    const { userIds: [ userId ] } = seed(server.dataDir, { users: [ { email: 'alice@example.com' } ] });
    token = (await login(server, 'body', { email: 'alice@example.com', password: E2E_ADMIN.password })).authToken;
    repositoryId = seed(server.dataDir, {
      repositories: [ { userId: userId as number, name: 'handbook', lastAccessedAt: new Date(0) } ]
    }).repositoryIds[0] as number;
    const root = join(server.dataDir, 'repos', String(userId), String(repositoryId));
    mkdirSync(join(root, 'big'), { recursive: true });
    execFileSync('git', [ 'init', '-q', '-b', 'main', root ]);
    for (let i = 0; i < ENTRIES; i++) {
      writeFileSync(join(root, 'big', `note-${String(i).padStart(4, '0')}.md`), '# Note\n');
    }
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('NF-2.1: a folder listing of 1,000 entries arrives gzipped', async () => {
    const response = await fetch(`${server.url}/api/v1/repositories/${repositoryId}/folder?path=big`, {
      headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip' }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('vary')).toMatch(/accept-encoding/i);
    // fetch decodes the body.
    const body = (await response.json()) as { entries: unknown[]; };
    expect(body.entries).toHaveLength(ENTRIES);
  });

  it('A-3.10: the push channel delivers an event at once to a client that accepts gzip and br', async () => {
    const stream = await fetch(`${server.url}/api/v1/events`, {
      headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip, br' }
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-encoding')).toBeNull();
    const reader = stream.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (reader === undefined) {
      throw new Error('The response has no body');
    }
    try {
      // The first bytes, sent as the stream opens.
      expect((await reader.read()).value).toContain(': connected');

      const created = await fetch(`${server.url}/api/v1/repositories/${repositoryId}/entries`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ folder: '', name: 'drafts', kind: 'folder' })
      });
      expect(created.status).toBe(201);

      // Well before the 30 s keep-alive, which would flush a buffering compressor.
      const event = await Promise.race([
        (async () => {
          let text = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              return text;
            }
            text += value;
            if (/^data: /m.test(text)) {
              return text;
            }
          }
        })(),
        new Promise<string>(resolve => setTimeout(() => resolve('timed out'), 2000))
      ]);
      expect(event).toContain('"type":"files.changed"');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });
});
