import { GitEngine, GitOptions, GitRunner } from '@front-burner/server-core-git';
import { PathRefusedError } from '@front-burner/server-core-storage';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EntrySummaries } from './entry-summaries';

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
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

const write = (path: string, content = '\n') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

describe('EntrySummaries', () => {
  const summaries = new EntrySummaries(new GitEngine(options, new GitRunner()));
  let root: string;

  const refusal = (promise: Promise<unknown>) =>
    promise.then(() => 'succeeded', (error: unknown) => error instanceof PathRefusedError ? error.reason : error);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-summary-spec-'));
    git(root, 'init', '-q', '-b', 'main');
    write(join(root, '.gitignore'), 'build/\n*.log\n');
    write(join(root, 'docs', 'guide.md'));
    write(join(root, 'docs', 'img', 'logo.png'));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('summarises a file', async () => {
    write(join(root, 'docs', 'notes.md'));
    write(join(root, 'docs', 'debug.log'));

    expect(await summaries.summary(root, 'docs/guide.md')).toEqual({ files: 1, nonMarkdown: 0, uncommitted: 0 });
    expect(await summaries.summary(root, 'docs/img/logo.png')).toEqual({ files: 1, nonMarkdown: 1, uncommitted: 0 });
    expect(await summaries.summary(root, 'docs/notes.md')).toEqual({ files: 1, nonMarkdown: 0, uncommitted: 1 });
    expect(await summaries.summary(root, 'docs/debug.log')).toEqual({ files: 1, nonMarkdown: 1, uncommitted: 1 });
  });

  it('counts files, non-Markdown files and uncommitted files in a folder', async () => {
    write(join(root, 'docs', 'guide.md'), 'changed\n');
    write(join(root, 'docs', 'drafts', 'a.md'));
    write(join(root, 'docs', 'drafts', 'b.png'));
    write(join(root, 'docs', 'trace.log'));
    symlinkSync('guide.md', join(root, 'docs', 'link.md'));
    mkdirSync(join(root, 'docs', 'empty'));

    // guide.md, logo.png, a.md, b.png, trace.log and the link; the modified guide.md can be brought back.
    expect(await summaries.summary(root, 'docs')).toEqual({ files: 6, nonMarkdown: 4, uncommitted: 4 });
  });

  it('does not walk through a symbolic link folder', async () => {
    write(join(root, 'outside', 'a.md'));
    write(join(root, 'outside', 'b.md'));
    symlinkSync('../outside', join(root, 'docs', 'linked'));

    expect(await summaries.summary(root, 'docs')).toMatchObject({ files: 3, nonMarkdown: 2 });
    expect(await summaries.summary(root, 'docs/linked')).toMatchObject({ files: 1, nonMarkdown: 1 });
    expect(await refusal(summaries.summary(root, 'docs/linked/a.md'))).toBe('symlink');
  });

  it('counts nothing inside a submodule or .git', async () => {
    write(join(root, 'docs', 'vendor', 'lib', '.git'), 'gitdir: ../../.git/modules/lib\n');
    write(join(root, 'docs', 'vendor', 'lib', 'inside.md'));

    expect(await summaries.summary(root, 'docs')).toMatchObject({ files: 2, nonMarkdown: 1 });
    expect(await refusal(summaries.summary(root, '.git'))).toBe('inside-git');
  });

  it('refuses a path inside a submodule and counts nothing for the submodule itself', async () => {
    write(join(root, 'vendor', 'lib', 'docs', 'a.md'));
    const sha = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`);

    expect(await summaries.summary(root, 'vendor/lib')).toEqual({ files: 0, nonMarkdown: 0, uncommitted: 0 });
    expect(await refusal(summaries.summary(root, 'vendor/lib/docs'))).toBe('not-found');
    expect(await refusal(summaries.summary(root, 'vendor/lib/docs/a.md'))).toBe('not-found');
    expect(await refusal(summaries.ignored(root, 'vendor/lib/docs/b.md', 'file'))).toBe('not-found');
    expect(await refusal(summaries.ignored(root, 'vendor/lib/b.md', 'file'))).toBe('not-found');
  });

  it('agrees with git on a nested repository', async () => {
    write(join(root, 'notes', 'old', 'a.md'));
    git(join(root, 'notes', 'old'), 'init', '-q');

    expect(await summaries.summary(root, 'notes')).toEqual({ files: 0, nonMarkdown: 0, uncommitted: 0 });
  });

  it('refuses a missing entry', async () => {
    expect(await refusal(summaries.summary(root, 'docs/gone.md'))).toBe('not-found');
  });

  it('counts uncommitted files beyond 1 MiB of git output', { timeout: 60_000 }, async () => {
    const folder = join(root, 'many');
    mkdirSync(folder);
    const name = (index: number) =>
      `a-rather-long-file-name-to-fill-the-git-output-${String(index).padStart(5, '0')}.md`;
    for (let index = 0; index < 20_000; index++) {
      writeFileSync(join(folder, name(index)), '');
    }

    expect(await summaries.summary(root, 'many')).toEqual({ files: 20_000, nonMarkdown: 0, uncommitted: 20_000 });
  });

  it('says a new name inside an ignored folder is ignored', async () => {
    mkdirSync(join(root, 'build'));

    expect(await summaries.ignored(root, 'build/new.md', 'file')).toBe(true);
    expect(await summaries.ignored(root, 'docs/new.md', 'file')).toBe(false);
    expect(await summaries.ignored(root, 'docs/new.log', 'file')).toBe(true);
    expect(await summaries.ignored(root, 'docs/build', 'folder')).toBe(true);
    expect(await summaries.ignored(root, 'docs/build', 'file')).toBe(false);
    expect(await refusal(summaries.ignored(root, 'nope/new.md', 'file'))).toBe('not-found');
  });
});
