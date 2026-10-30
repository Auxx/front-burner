import { GitEngine, GitOptions, GitRunner } from '@front-burner/server-core-git';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { OpenableRepository } from '../repository/openable-repository';
import { ImageFiles } from './image-files';
import { IMAGE_CSP, ImagesController } from './images.controller';

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
const REPO = 7;
const PNG = Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3 ]);

const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('ImagesController', () => {
  let dir: string;
  let root: string;
  let app: INestApplication;

  const image = (path: string, id = REPO) =>
    request(app.getHttpServer()).get(`/repositories/${id}/image`).query({ path }).buffer(true).parse(binary);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fb-images-controller-'));
    root = join(dir, 'copy');
    mkdirSync(join(root, 'img'), { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, '.gitignore'), 'build/\n');
    writeFileSync(join(root, 'img', 'committed.png'), PNG);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    const repositories = {
      root: (userId: number, id: number) => {
        if (userId !== USER || id !== REPO) {
          throw new ApiErrorException(404, 'not-found');
        }
        return root;
      }
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ ImagesController ],
      providers: [
        ImageFiles,
        { provide: GitEngine, useValue: new GitEngine(options, new GitRunner()) },
        { provide: OpenableRepository, useValue: repositories },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe }
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
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC-EDIT-003.3: serves an image that is not committed', async () => {
    writeFileSync(join(root, 'img', 'new.png'), PNG);

    const res = await image('img/new.png').expect(200);

    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-length']).toBe(String(PNG.length));
    expect(res.body).toEqual(PNG);
  });

  it('serves an ignored image', async () => {
    mkdirSync(join(root, 'build'));
    writeFileSync(join(root, 'build', 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const res = await image('build/chart.svg').expect(200);

    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.body.toString()).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('serves an empty image', async () => {
    writeFileSync(join(root, 'empty.gif'), '');

    const res = await image('empty.gif').expect(200);

    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.body).toEqual(Buffer.alloc(0));
  });

  it('takes the content type from the extension only', async () => {
    writeFileSync(join(root, 'x.png'), '<!doctype html><script>alert(1)</script>');

    const res = await image('x.png').expect(200);

    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sends the sandbox headers on every answer', async () => {
    writeFileSync(join(root, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const ok = await image('evil.svg').expect(200);
    const notModified = await image('evil.svg').set('If-None-Match', ok.headers['etag'] as string).expect(304);
    const missing = await image('missing.svg').expect(404);
    const unsupported = await image('a.tiff').expect(415);

    for (const res of [ ok, notModified, missing, unsupported ]) {
      expect(res.headers['content-security-policy']).toBe(IMAGE_CSP);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    expect(IMAGE_CSP).toBe('default-src \'none\'; sandbox');
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await image('img/committed.png').expect(200);
    const { size, mtimeMs } = statSync(join(root, 'img', 'committed.png'));

    expect(first.headers['etag']).toBe(`"${size}-${mtimeMs}"`);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const again = await image('img/committed.png').set('If-None-Match', `"other", W/${first.headers['etag']}`)
      .expect(304);
    expect(again.body).toEqual(Buffer.alloc(0));
    expect(again.headers['etag']).toBe(first.headers['etag']);
    await image('img/committed.png').set('If-None-Match', '"other"').expect(200);
  });

  it('changes the ETag when the file is replaced', async () => {
    const path = join(root, 'img', 'committed.png');
    utimesSync(path, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const before = await image('img/committed.png').expect(200);

    // A pull replaces it with another image of the same size.
    writeFileSync(path, Buffer.from(PNG.map(byte => byte ^ 1)));
    utimesSync(path, new Date(1_700_000_001_000), new Date(1_700_000_001_000));
    const after = await image('img/committed.png').set('If-None-Match', before.headers['etag'] as string)
      .expect(200);

    expect(after.headers['etag']).not.toBe(before.headers['etag']);
    expect(after.body).toEqual(Buffer.from(PNG.map(byte => byte ^ 1)));
  });

  it('refuses a path that is not a string, and another user\'s repository like a missing one', async () => {
    await request(app.getHttpServer()).get(`/repositories/${REPO}/image`).expect(400);
    const other = await image('img/committed.png', REPO + 1).expect(404);

    expect(other.body.toString()).toContain('"code":"not-found"');
  });
});
