import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { ServerProcess } from './server-process';

/** Polls until `check` resolves to true, for at most 20 seconds. */
export async function waitFor(check: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export interface JobState {
  status: string;
  outcome: { kind: string; code?: string; [key: string]: unknown; } | null;
}

/**
 * One user's calls to a test server's API, for adding repositories and
 * pushing them. With `bodies`, it keeps every response body it receives.
 */
export class GitApi {
  constructor(
    private readonly server: ServerProcess,
    readonly authToken: string,
    private readonly bodies?: string[]
  ) {}

  /** Another session's calls to the same server, kept in the same `bodies`. */
  as(authToken: string): GitApi {
    return new GitApi(this.server, authToken, this.bodies);
  }

  async call(path: string, init: RequestInit = {}, authToken = this.authToken): Promise<Response> {
    const response = await fetch(`${this.server.url}/api/v1${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}`, ...init.headers }
    });
    this.bodies?.push(await response.clone().text());
    return response;
  }

  send(method: string, path: string, body: unknown): Promise<Response> {
    return this.call(path, { method, body: JSON.stringify(body) });
  }

  /** Adds a repository and waits for its clone; returns its ID and working copy. */
  async add(name: string, remoteUrl: string, credentials: object = { mode: 'none' }) {
    const added = await this.send('POST', '/repositories', { remoteUrl, name, credentials, cloneMode: 'full' });
    expect(added.status).toBe(201);
    const { id } = await added.json() as { id: number; };
    await waitFor(async () => (await this.call(`/repositories/${id}/git/status`)).status === 200);
    const [ userDir ] = readdirSync(join(this.server.dataDir, 'repos'));
    return { id, workingCopy: join(this.server.dataDir, 'repos', userDir ?? '', String(id)) };
  }

  startPush(id: number): Promise<number> {
    return this.started(`/repositories/${id}/git/push`);
  }

  async jobState(id: number, jobId: number, authToken = this.authToken): Promise<JobState> {
    const response = await this.call(`/repositories/${id}/git/jobs/${jobId}`, {}, authToken);
    expect(response.status).toBe(200);
    return await response.json() as JobState;
  }

  /** Pushes and waits for the push to finish; `authToken` reads its state. */
  pushed(id: number, authToken = this.authToken): Promise<JobState> {
    return this.finished(id, this.startPush(id), authToken);
  }

  /** Fetches and waits for the fetch to finish. */
  fetched(id: number): Promise<JobState> {
    return this.finished(id, this.started(`/repositories/${id}/git/fetch`));
  }

  private async started(path: string): Promise<number> {
    const response = await this.call(path, { method: 'POST' });
    expect(response.status).toBe(202);
    return (await response.json() as { jobId: number; }).jobId;
  }

  private async finished(id: number, started: Promise<number>, authToken = this.authToken): Promise<JobState> {
    const jobId = await started;
    let state = await this.jobState(id, jobId, authToken);
    await waitFor(async () => {
      state = await this.jobState(id, jobId, authToken);
      return state.status !== 'queued' && state.status !== 'running';
    });
    return state;
  }
}
