import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOptions, GitRunner, WorkingTreeLock } from '@front-burner/server-core-git';
import type { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DataLayout } from '@front-burner/server-core-storage';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenableRepository } from '../repository/openable-repository';
import { DELETE_FOLDER_JOB_TYPE, EntryDelete } from './entry-delete';
import { WorkingTreeGuard } from './working-tree-guard';

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
const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    // A conflicting merge exits with 1; the test checks the state it leaves.
    return (error as { stdout?: string; }).stdout ?? '';
  }
};

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

const USER = 3;
const REPO = 7;

const refusal = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => 'succeeded',
    (error: unknown) =>
      error instanceof ApiErrorException
        ? { status: error.getStatus(), code: error.code, params: error.params }
        : error
  );

const notDeletable = { status: 400, code: 'entry-not-deletable', params: {} };
const missing = { status: 404, code: 'entry-not-found', params: {} };

describe('EntryDelete', () => {
  let dataDir: string;
  let layout: DataLayout;
  let root: string;
  let outside: string;
  let publish: ReturnType<typeof vi.fn>;
  let enqueue: ReturnType<typeof vi.fn>;
  let entries: EntryDelete;

  const remove = (path: string) => entries.delete(USER, REPO, path);
  const names = (folder = '') => readdirSync(join(root, folder)).filter(name => name !== '.git').sort();

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fb-delete-spec-'));
    layout = new DataLayout(dataDir);
    mkdirSync(layout.tmpDir, { recursive: true });
    root = layout.workingCopy(USER, REPO);
    mkdirSync(root, { recursive: true });
    outside = join(dataDir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret\n');
    git(root, 'init', '-q', '-b', 'main');
    mkdirSync(join(root, 'docs', 'deep'), { recursive: true });
    writeFileSync(join(root, 'docs', 'readme.md'), '# Docs\n');
    writeFileSync(join(root, 'docs', 'deep', 'a.md'), 'a\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    const engine = new GitEngine(options, new GitRunner());
    const repositories = { root: vi.fn().mockReturnValue(root) } as unknown as OpenableRepository;
    publish = vi.fn();
    enqueue = vi.fn().mockReturnValue(1);
    entries = new EntryDelete(
      repositories,
      new WorkingTreeGuard(new WorkingTreeLock(), engine),
      engine,
      { enqueue } as unknown as JobRunner,
      { publish } as unknown as EventsHub,
      layout
    );
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('deletes a committed file and an untracked file', async () => {
    writeFileSync(join(root, 'docs', 'notes.txt'), 'notes\n');

    await remove('docs/readme.md');
    await remove('docs/notes.txt');

    expect(names('docs')).toEqual([ 'deep' ]);
    expect(git(root, 'status', '--porcelain')).toBe(' D docs/readme.md\n');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('AC-FILE-001.11: deleting a symbolic link removes only the link', async () => {
    symlinkSync('/etc/passwd', join(root, 'passwd'));
    symlinkSync(outside, join(root, 'linked'));
    symlinkSync('docs', join(root, 'docs-link'));

    await remove('passwd');
    await remove('linked');
    await remove('docs-link');

    expect(names()).toEqual([ 'docs' ]);
    expect(existsSync('/etc/passwd')).toBe(true);
    expect(readdirSync(outside)).toEqual([ 'secret.txt' ]);
    expect(names('docs')).toEqual([ 'deep', 'readme.md' ]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('moves a folder out of the working copy at once and queues its removal', async () => {
    await remove('docs');

    expect(names()).toEqual([]);
    const trashed = readdirSync(layout.tmpDir);
    expect(trashed).toHaveLength(1);
    const name = trashed[0] ?? '';
    expect(name).toMatch(/^delete-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(readFileSync(join(layout.tmpDir, name, 'deep', 'a.md'), 'utf8')).toBe('a\n');
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      type: DELETE_FOLDER_JOB_TYPE,
      repositoryId: REPO,
      payload: { name }
    });
  });

  it('refuses a submodule', async () => {
    mkdirSync(join(root, 'vendor', 'lib'), { recursive: true });
    writeFileSync(join(root, 'vendor', 'lib', 'README.md'), 'lib\n');
    const sha = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`);

    expect(await refusal(remove('vendor/lib'))).toEqual(notDeletable);
    expect(await refusal(remove('vendor/lib/README.md'))).toEqual(missing);
    expect(readdirSync(join(root, 'vendor', 'lib'))).toEqual([ 'README.md' ]);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('refuses the root folder', async () => {
    expect(await refusal(remove(''))).toEqual(notDeletable);
    expect(names()).toEqual([ 'docs' ]);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('refuses a folder through a symbolic link', async () => {
    mkdirSync(join(outside, 'sub'));
    writeFileSync(join(outside, 'sub', 'b.md'), 'b\n');
    symlinkSync(outside, join(root, 'link'));

    expect(await refusal(remove('link/sub')))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'symlink' } });
    expect(await refusal(remove('link/secret.txt')))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'symlink' } });
    expect(readdirSync(outside).sort()).toEqual([ 'secret.txt', 'sub' ]);
    expect(readdirSync(join(outside, 'sub'))).toEqual([ 'b.md' ]);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('refuses .git, a missing entry and a malformed path', async () => {
    expect(await refusal(remove('.git')))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'inside-git' } });
    expect(await refusal(remove('docs/.git/config')))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'inside-git' } });
    expect(await refusal(remove('docs/gone.md'))).toEqual(missing);
    expect(await refusal(remove('docs/../docs')))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'malformed' } });
    expect(existsSync(join(root, '.git', 'HEAD'))).toBe(true);
  });

  it('refuses a delete during a merge', async () => {
    writeFileSync(join(root, 'docs', 'readme.md'), 'main\n');
    git(root, 'commit', '-q', '-am', 'main');
    git(root, 'checkout', '-q', '-b', 'other', 'HEAD~1');
    writeFileSync(join(root, 'docs', 'readme.md'), 'other\n');
    git(root, 'commit', '-q', '-am', 'other');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', 'other');

    const merging = { status: 409, code: 'merge-in-progress', params: {} };
    expect(await refusal(remove('docs'))).toEqual(merging);
    expect(await refusal(remove('docs/deep/a.md'))).toEqual(merging);
    expect(names('docs')).toEqual([ 'deep', 'readme.md' ]);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes files.changed with the parent folder, and a deleted folder\'s own path', async () => {
    await remove('docs/deep/a.md');
    await remove('docs/deep');

    expect(publish.mock.calls).toEqual([
      [ USER, { type: 'files.changed', repositoryId: REPO, folders: [ 'docs/deep' ] } ],
      [ USER, { type: 'files.changed', repositoryId: REPO, folders: [ 'docs', 'docs/deep' ] } ]
    ]);
  });
});
