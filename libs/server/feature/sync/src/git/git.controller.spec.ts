import { GitEngine, GitOptions, GitRunner } from '@front-burner/server-core-git';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { GitController } from './git.controller';

const gitEnv = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe' });

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

const USER = 3;
const READY = 7;
const CLONING = 8;

describe('GitController', () => {
  let root: string;
  let app: INestApplication;

  const status = (id = READY) => request(app.getHttpServer()).get(`/repositories/${id}/git/status`);

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-git-controller-'));
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'notes.md'), 'base\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    const repositories = {
      root: (userId: number, id: number) => {
        if (userId !== USER || (id !== READY && id !== CLONING)) {
          throw new ApiErrorException(404, 'not-found');
        }
        if (id === CLONING) {
          throw new ApiErrorException(409, 'repository-not-openable', { status: 'cloning' });
        }
        return root;
      }
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ GitController ],
      providers: [
        { provide: GitEngine, useValue: new GitEngine(options, new GitRunner()) },
        { provide: OpenableRepository, useValue: repositories },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Stands in for the auth middleware.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: USER } as Request['auth'];
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('answers only for the owner\'s ready repository', async () => {
    writeFileSync(join(root, 'notes.md'), 'changed\n');

    const ready = await status().expect(200);
    expect(ready.body).toEqual({
      branch: 'main',
      noCommits: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      mergeInProgress: false,
      changes: [ { path: 'notes.md', state: 'modified' } ]
    });

    const cloning = await status(CLONING).expect(409);
    expect(cloning.body).toMatchObject({ code: 'repository-not-openable', params: { status: 'cloning' } });

    const other = await status(9).expect(404);
    expect(other.body).toMatchObject({ code: 'not-found' });
  });

  it('reports a merge in progress', async () => {
    git(root, 'checkout', '-q', '-b', 'other');
    writeFileSync(join(root, 'notes.md'), 'theirs\n');
    git(root, 'commit', '-q', '-am', 'theirs');
    git(root, 'checkout', '-q', 'main');
    writeFileSync(join(root, 'notes.md'), 'ours\n');
    git(root, 'commit', '-q', '-am', 'ours');
    expect(() => git(root, 'merge', '-q', 'other')).toThrow();

    const { body } = await status().expect(200);
    expect(body).toMatchObject({
      mergeInProgress: true,
      changes: [ { path: 'notes.md', state: 'modified' } ]
    });
  });
});
