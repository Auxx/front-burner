import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOptions, GitRunner, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException, ApiExceptionFilter } from '@front-burner/server-core-observability';
import { OpenableRepository, WorkingTreeGuard } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import type { PushEvent, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe', encoding: 'utf8' });

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

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' };

describe('GitController', () => {
  let root: string;
  let app: INestApplication;
  let commitAuthor: RepositoryCommitAuthor;
  let published: PushEvent[];

  const status = (id = READY) => request(app.getHttpServer()).get(`/repositories/${id}/git/status`);
  const commit = (body: object, id = READY) =>
    request(app.getHttpServer()).post(`/repositories/${id}/git/commits`).send(body);
  const authorOf = (rev = 'HEAD') => git(root, 'log', '-1', '--format=%an <%ae> / %cn <%ce>', rev).trim();

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-git-controller-'));
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'notes.md'), 'base\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    commitAuthor = { author: ADA, source: 'default', confirmed: true };
    published = [];
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
    const commitAuthors = {
      forRepository: (userId: number, id: number) => {
        repositories.root(userId, id);
        return commitAuthor;
      }
    };
    const engine = new GitEngine(options, new GitRunner());
    const moduleRef = await Test.createTestingModule({
      controllers: [ GitController ],
      providers: [
        { provide: GitEngine, useValue: engine },
        { provide: WorkingTreeGuard, useValue: new WorkingTreeGuard(new WorkingTreeLock(), engine) },
        { provide: OpenableRepository, useValue: repositories },
        { provide: CommitAuthors, useValue: commitAuthors },
        { provide: EventsHub, useValue: { publish: (_userId: number, event: PushEvent) => published.push(event) } },
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

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('answers only for the owner\'s ready repository', async () => {
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

  // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
  it.skipIf(process.platform === 'win32')('reports a merge in progress', async () => {
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

  describe('diff', () => {
    const diff = (path: string, id = READY) =>
      request(app.getHttpServer()).get(`/repositories/${id}/git/diff`).query({ path });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('answers a modified file\'s lines', async () => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');

      const { body } = await diff('notes.md').expect(200);

      expect(body).toEqual({
        kind: 'text',
        lines: [
          { type: 'removed', oldLine: 1, newLine: null, text: 'base' },
          { type: 'added', oldLine: null, newLine: 1, text: 'changed' }
        ],
        complete: true,
        lineEndingsOnly: false
      });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('answers the diff of a deleted file', async () => {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'a.md'), 'a\n');
      git(root, 'add', 'docs');
      git(root, 'commit', '-q', '-m', 'docs');
      rmSync(join(root, 'notes.md'));
      rmSync(join(root, 'docs'), { recursive: true });

      expect((await diff('notes.md').expect(200)).body.lines).toEqual([
        { type: 'removed', oldLine: 1, newLine: null, text: 'base' }
      ]);
      expect((await diff('docs/a.md').expect(200)).body.lines).toEqual([
        { type: 'removed', oldLine: 1, newLine: null, text: 'a' }
      ]);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('refuses .git and a path through a symbolic link', async () => {
      const inside = await diff('.git/config').expect(400);
      expect(inside.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });

      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));
        const through = await diff('linked/secret.md').expect(400);
        expect(through.body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });

        // The link itself is shown as a link: its target's name, not the files behind it.
        const { body } = await diff('linked').expect(200);
        expect(body.lines).toEqual([ { type: 'added', oldLine: null, newLine: 1, text: outside } ]);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('answers another user\'s repository like a missing one', async () => {
      const { body } = await diff('notes.md', 9).expect(404);

      expect(body).toMatchObject({ code: 'not-found' });
    });

    it('needs a path', async () => {
      const { body } = await diff('').expect(400);

      expect(body).toMatchObject({ code: 'validation-failed' });
    });
  });

  describe('commits', () => {
    beforeEach(() => {
      writeFileSync(join(root, 'notes.md'), 'changed\n');
      writeFileSync(join(root, 'other.md'), 'other\n');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('commits the listed changes as the commit author', async () => {
      const { body } = await commit({ message: 'Update the notes', paths: [ 'notes.md' ] }).expect(201);

      expect(body).toEqual({ oid: git(root, 'rev-parse', 'HEAD').trim() });
      expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('Update the notes');
      expect(authorOf()).toBe('Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>');
      expect(git(root, 'status', '--porcelain').trim()).toBe('?? other.md');
    });

    it('refuses a commit from a user who has not confirmed', async () => {
      commitAuthor = { ...commitAuthor, confirmed: false };
      const head = git(root, 'rev-parse', 'HEAD');

      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'commit-author-not-confirmed' });
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')(
      'AC-GIT-001.8: changing the default does not change commits already made',
      async () => {
        await commit({ message: 'First', paths: [ 'notes.md' ] }).expect(201);
        commitAuthor = { ...commitAuthor, author: { name: 'Ada King', email: 'king@example.com' } };

        await commit({ message: 'Second', paths: [ 'other.md' ] }).expect(201);

        expect(authorOf('HEAD~1')).toBe('Ada Lovelace <ada@example.com> / Ada Lovelace <ada@example.com>');
        expect(authorOf()).toBe('Ada King <king@example.com> / Ada King <king@example.com>');
      }
    );

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('uses the repository\'s override', async () => {
      commitAuthor = { author: { name: 'Work Ada', email: 'ada@work.example' }, source: 'override', confirmed: true };

      await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(201);

      expect(authorOf()).toBe('Work Ada <ada@work.example> / Work Ada <ada@work.example>');
    });

    it('refuses an empty message and an empty list', async () => {
      const empty = await commit({ message: ' \n ', paths: [ 'notes.md' ] }).expect(400);
      expect(empty.body).toMatchObject({ code: 'validation-failed' });

      const none = await commit({ message: 'Update', paths: [] }).expect(400);
      expect(none.body).toMatchObject({ code: 'validation-failed' });
    });

    it('refuses .git and a path through a symbolic link', async () => {
      const inside = await commit({ message: 'Update', paths: [ 'notes.md', '.git/config' ] }).expect(400);
      expect(inside.body).toMatchObject({ code: 'path-refused', params: { reason: 'inside-git' } });

      const outside = mkdtempSync(join(tmpdir(), 'fb-git-outside-'));
      try {
        writeFileSync(join(outside, 'secret.md'), 'secret\n');
        symlinkSync(outside, join(root, 'linked'));
        const through = await commit({ message: 'Update', paths: [ 'linked/secret.md' ] }).expect(400);
        expect(through.body).toMatchObject({ code: 'path-refused', params: { reason: 'symlink' } });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      expect(git(root, 'log', '--format=%s').trim()).toBe('base');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('commits a file of a deleted folder', async () => {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'a.md'), 'a\n');
      git(root, 'add', 'docs');
      git(root, 'commit', '-q', '-m', 'docs');
      rmSync(join(root, 'docs'), { recursive: true });

      await commit({ message: 'Remove docs', paths: [ 'docs/a.md' ] }).expect(201);

      expect(git(root, 'show', '--name-status', '--format=', 'HEAD').trim()).toBe('D\tdocs/a.md');
    });

    it('refuses a commit during a merge', async () => {
      git(root, 'stash', '-q', '-u');
      git(root, 'checkout', '-q', '-b', 'theirs');
      writeFileSync(join(root, 'notes.md'), 'theirs\n');
      git(root, 'commit', '-q', '-am', 'theirs');
      git(root, 'checkout', '-q', 'main');
      writeFileSync(join(root, 'notes.md'), 'ours\n');
      git(root, 'commit', '-q', '-am', 'ours');
      expect(() => git(root, 'merge', '-q', 'theirs')).toThrow();

      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'merge-in-progress' });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('refuses a commit on a detached HEAD', async () => {
      git(root, 'checkout', '-q', '--detach');

      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(409);

      expect(body).toMatchObject({ code: 'detached-head' });
      expect(git(root, 'log', '--format=%s').trim()).toBe('base');
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('a repeated request answers nothing-to-commit', async () => {
      const sent = { message: 'Update', paths: [ 'notes.md' ] };

      const [ first, second ] = await Promise.all([ commit(sent), commit(sent) ]);

      expect([ first.status, second.status ].sort()).toEqual([ 201, 409 ]);
      expect([ first, second ].find(response => response.status === 409)?.body).toMatchObject({
        code: 'nothing-to-commit'
      });
      expect(git(root, 'log', '--format=%s').trim()).toBe('Update\nbase');
    });

    it('answers another user\'s repository like a missing one', async () => {
      const { body } = await commit({ message: 'Update', paths: [ 'notes.md' ] }, 9).expect(404);

      expect(body).toMatchObject({ code: 'not-found' });
    });

    // Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
    it.skipIf(process.platform === 'win32')('publishes git.changed', async () => {
      await commit({ message: 'Update', paths: [ 'notes.md' ] }).expect(201);

      expect(published).toEqual([ { type: 'git.changed', repositoryId: READY } ]);
    });
  });
});
