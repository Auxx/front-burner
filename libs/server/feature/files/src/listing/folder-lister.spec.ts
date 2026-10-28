import { GitEngine, GitOptions, GitRunner } from '@front-burner/server-core-git';
import { PathRefusedError } from '@front-burner/server-core-storage';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderLister } from './folder-lister';

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
const git = (cwd: string, args: string[], input?: string) =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

const write = (path: string, content = '') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

describe('FolderLister', () => {
  const lister = new FolderLister(new GitEngine(options, new GitRunner()));
  let root: string;

  const names = async (path = '') => (await lister.list(root, path)).entries.map(entry => entry.name);
  const refusal = (path: string) =>
    lister.list(root, path).then(
      () => undefined,
      (error: unknown) => error instanceof PathRefusedError ? error.reason : error
    );

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-lister-spec-'));
    git(root, [ 'init', '-q', '-b', 'main' ]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-FILE-001.7: sorts folders first in natural order', async () => {
    for (const name of [ '10-deploy.md', '2-setup.md', 'B.md', 'a.md' ]) {
      write(join(root, name));
    }
    for (const name of [ 'zeta', 'Alpha', 'docs10', 'docs9' ]) {
      mkdirSync(join(root, name));
    }

    expect(await names()).toEqual(
      [ 'Alpha', 'docs9', 'docs10', 'zeta', '2-setup.md', '10-deploy.md', 'a.md', 'B.md' ]
    );
  });

  it('AC-FILE-001.8: lists .github and .claude but never .git', async () => {
    mkdirSync(join(root, '.github'));
    mkdirSync(join(root, '.claude'));
    write(join(root, '.env'));
    mkdirSync(join(root, 'sub', '.GIT'), { recursive: true });
    write(join(root, 'sub', 'a.md'));

    expect(await names()).toEqual([ '.claude', '.github', 'sub', '.env' ]);
    expect(await names('sub')).toEqual([ 'a.md' ]);
    expect(await refusal('.git')).toBe('inside-git');
  });

  it('AC-FILE-001.11: lists a symbolic link as such without following it', async () => {
    symlinkSync('/etc', join(root, 'etc'));
    symlinkSync('/etc/passwd', join(root, 'passwd.md'));

    const listing = await lister.list(root, '');

    expect(listing.entries).toEqual([
      { name: 'etc', kind: 'symlink', size: null, markdown: false, ignored: false, empty: false },
      { name: 'passwd.md', kind: 'symlink', size: null, markdown: false, ignored: false, empty: false }
    ]);
    expect(await refusal('etc')).toBe('symlink');
  });

  it('lists a gitlink as a submodule', async () => {
    git(root, [ 'commit', '-q', '--allow-empty', '-m', 'base' ]);
    const sha = git(root, [ 'rev-parse', 'HEAD' ]).trim();
    git(root, [ 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib` ]);
    mkdirSync(join(root, 'vendor', 'lib'), { recursive: true });
    mkdirSync(join(root, 'vendor', 'own'));

    expect((await lister.list(root, 'vendor')).entries).toEqual([
      { name: 'own', kind: 'folder', size: null, markdown: false, ignored: false, empty: true },
      { name: 'lib', kind: 'submodule', size: null, markdown: false, ignored: false, empty: false }
    ]);
  });

  it('marks ignored entries, but never a tracked file', async () => {
    write(join(root, '.gitignore'), 'build/\n*.log\n');
    write(join(root, 'keep.log'), 'kept\n');
    git(root, [ 'add', '-f', '.gitignore', 'keep.log' ]);
    write(join(root, 'out.log'));
    mkdirSync(join(root, 'build'));
    write(join(root, 'notes.md'));

    const ignored = Object.fromEntries((await lister.list(root, '')).entries.map(e => [ e.name, e.ignored ]));

    expect(ignored).toEqual({
      build: true,
      '.gitignore': false,
      'keep.log': false,
      'notes.md': false,
      'out.log': true
    });
  });

  it('marks everything inside an ignored folder as ignored', async () => {
    write(join(root, '.gitignore'), 'build/\n');
    write(join(root, 'build', 'app.js'));
    write(join(root, 'build', 'nested', 'deep.md'));
    write(join(root, 'build', 'README.md'));

    const listing = await lister.list(root, 'build');
    const nested = await lister.list(root, 'build/nested');

    expect(listing.ignored).toBe(true);
    expect(listing.entries.map(entry => [ entry.name, entry.ignored ])).toEqual(
      [ [ 'nested', true ], [ 'app.js', true ], [ 'README.md', true ] ]
    );
    expect(nested.ignored).toBe(true);
    expect(nested.entries.map(entry => entry.ignored)).toEqual([ true ]);
  });

  it('does not mark a tracked file inside an ignored folder', async () => {
    write(join(root, '.gitignore'), 'build/\n');
    write(join(root, 'build', 'keep.js'));
    write(join(root, 'build', 'out.js'));
    git(root, [ 'add', '-f', 'build/keep.js' ]);
    write(join(root, 'dist', 'a.js'));
    write(join(root, '.gitignore'), 'build/\ndist/\n');

    const listing = await lister.list(root, 'build');

    expect(listing.entries.map(entry => [ entry.name, entry.ignored ])).toEqual([ [ 'keep.js', false ], [
      'out.js',
      true
    ] ]);
    expect((await lister.list(root, 'dist')).entries.map(entry => entry.ignored)).toEqual([ true ]);
  });

  it('marks empty folders', async () => {
    mkdirSync(join(root, 'empty'));
    mkdirSync(join(root, 'only-git', '.git'), { recursive: true });
    write(join(root, 'full', 'a.md'));

    const empty = Object.fromEntries((await lister.list(root, '')).entries.map(e => [ e.name, e.empty ]));

    expect(empty).toEqual({ empty: true, full: false, 'only-git': true });
  });

  it('flags Markdown files in any case and gives file sizes', async () => {
    write(join(root, 'A.MD'), '12345');
    write(join(root, 'b.Markdown'));
    write(join(root, 'c.mdx'));
    write(join(root, 'd.txt'), 'abc');
    mkdirSync(join(root, 'e.md'));

    expect((await lister.list(root, '')).entries).toEqual([
      { name: 'e.md', kind: 'folder', size: null, markdown: false, ignored: false, empty: true },
      { name: 'A.MD', kind: 'file', size: 5, markdown: true, ignored: false, empty: false },
      { name: 'b.Markdown', kind: 'file', size: 0, markdown: true, ignored: false, empty: false },
      { name: 'c.mdx', kind: 'file', size: 0, markdown: true, ignored: false, empty: false },
      { name: 'd.txt', kind: 'file', size: 3, markdown: false, ignored: false, empty: false }
    ]);
  });

  it('handles names with newlines and quotes', async () => {
    write(join(root, '.gitignore'), '*.log\n');
    write(join(root, 'a\nb.log'));
    write(join(root, 'say "hi".md'));

    const listing = await lister.list(root, '');

    expect(listing.entries.map(entry => [ entry.name, entry.ignored ])).toEqual(
      [ [ '.gitignore', false ], [ 'a\nb.log', true ], [ 'say "hi".md', false ] ]
    );
  });

  it('refuses a file, a missing folder and malformed paths', async () => {
    write(join(root, 'a.md'));

    expect(await refusal('a.md')).toBe('not-found');
    expect(await refusal('nope')).toBe('not-found');
    expect(await refusal('../x')).toBe('malformed');
  });

  it('AC-FILE-001.24: lists the first 5,000 of 6,000 entries and counts the rest', async () => {
    mkdirSync(join(root, 'many'));
    for (let i = 0; i < 6000; i++) {
      writeFileSync(join(root, 'many', `f${i}.md`), '');
    }

    const listing = await lister.list(root, 'many');

    expect(listing.entries).toHaveLength(5000);
    expect(listing.more).toBe(1000);
    expect(listing.entries[0]?.name).toBe('f0.md');
    expect(listing.entries[4999]?.name).toBe('f4999.md');
  });

  describe('in a repository of 100,000 files', () => {
    let big: string;

    beforeAll(() => {
      big = mkdtempSync(join(tmpdir(), 'fb-lister-big-'));
      git(big, [ 'init', '-q', '-b', 'main' ]);
      write(join(big, '.gitignore'), '*.log\n');
      const blob = git(big, [ 'hash-object', '-w', '--stdin' ], '').trim();
      const lines: string[] = [];
      for (let i = 0; i < 99_000; i++) {
        lines.push(`100644 ${blob}\tother/d${Math.floor(i / 1000)}/f${i}.md`);
      }
      mkdirSync(join(big, 'docs'));
      for (let i = 0; i < 1000; i++) {
        const name = i % 2 === 0 ? `f${i}.md` : `d${i}`;
        if (i % 2 === 0) {
          writeFileSync(join(big, 'docs', name), '');
          lines.push(`100644 ${blob}\tdocs/${name}`);
        } else {
          mkdirSync(join(big, 'docs', name));
          writeFileSync(join(big, 'docs', name, 'x.md'), '');
          lines.push(`100644 ${blob}\tdocs/${name}/x.md`);
        }
      }
      git(big, [ 'update-index', '--index-info' ], lines.join('\n') + '\n');
    }, 120_000);

    afterAll(() => {
      rmSync(big, { recursive: true, force: true });
    });

    it('AC-FILE-001.7: lists 1,000 entries within 300 ms in a repository of 100,000 files', async () => {
      const times: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        const listing = await lister.list(big, 'docs');
        times.push(performance.now() - start);
        expect(listing.entries).toHaveLength(1000);
      }
      times.sort((a, b) => a - b);

      expect(times[2]).toBeLessThan(300);
    }, 120_000);
  });
});
