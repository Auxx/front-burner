import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOptions, GitRunner, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { CreateEntryRequest, RenameEntryRequest } from '@front-burner/shared-contracts';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenableRepository } from '../repository/openable-repository';
import { EntryActions } from './entry-actions';
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

interface Refusal {
  status: number;
  code: string;
  params: Record<string, unknown>;
  fields?: { path: string; code: string; }[];
}

const refusal = (promise: Promise<unknown>): Promise<Refusal | unknown> =>
  promise.then(
    () => 'succeeded',
    (error: unknown) => {
      if (!(error instanceof ApiErrorException)) {
        return error;
      }
      const answer: Refusal = { status: error.getStatus(), code: error.code, params: error.params };
      if (error.fields !== undefined) {
        answer.fields = error.fields.map(({ path, code }) => ({ path, code }));
      }
      return answer;
    }
  );

const nameTaken = {
  status: 400,
  code: 'validation-failed',
  params: {},
  fields: [ { path: 'name', code: 'name-taken' } ]
};
const notRenamable = { status: 400, code: 'entry-not-renamable', params: {} };

describe('EntryActions', () => {
  let root: string;
  let publish: ReturnType<typeof vi.fn>;
  let actions: EntryActions;

  const create = (request: CreateEntryRequest) => actions.create(USER, REPO, request);
  const rename = (request: RenameEntryRequest) => actions.rename(USER, REPO, request);
  const names = (folder = '') => readdirSync(join(root, folder)).filter(name => name !== '.git').sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-actions-spec-'));
    git(root, 'init', '-q', '-b', 'main');
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'readme.md'), '# Docs\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    const engine = new GitEngine(options, new GitRunner());
    const repositories = { root: vi.fn().mockReturnValue(root) } as unknown as OpenableRepository;
    publish = vi.fn();
    actions = new EntryActions(
      repositories,
      new WorkingTreeGuard(new WorkingTreeLock(), engine),
      engine,
      { publish } as unknown as EventsHub
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates notes as an empty untracked notes.md', async () => {
    expect(await create({ folder: 'docs', name: 'notes', kind: 'file' })).toEqual({ path: 'docs/notes.md' });

    expect(statSync(join(root, 'docs', 'notes.md')).size).toBe(0);
    expect(git(root, 'status', '--porcelain', '--', 'docs/notes.md')).toBe('?? docs/notes.md\n');
  });

  it('creates an empty folder', async () => {
    expect(await create({ folder: '', name: 'drafts', kind: 'folder' })).toEqual({ path: 'drafts' });

    expect(statSync(join(root, 'drafts')).isDirectory()).toBe(true);
    expect(readdirSync(join(root, 'drafts'))).toEqual([]);
  });

  it('keeps a Markdown extension and does not add .md to a folder', async () => {
    expect(await create({ folder: '', name: 'Guide.MDX', kind: 'file' })).toEqual({ path: 'Guide.MDX' });
    expect(await create({ folder: '', name: 'v1.0', kind: 'folder' })).toEqual({ path: 'v1.0' });
  });

  it('AC-FILE-001.14: refuses a case-only clash but allows a case-only rename', async () => {
    expect(await refusal(create({ folder: 'docs', name: 'README.md', kind: 'file' }))).toEqual(nameTaken);
    expect(await refusal(create({ folder: 'docs', name: 'README.md', kind: 'folder' }))).toEqual(nameTaken);

    expect(await rename({ path: 'docs/readme.md', name: 'README.md' })).toEqual({ path: 'docs/README.md' });
    expect(names('docs')).toEqual([ 'README.md' ]);
    expect(readFileSync(join(root, 'docs', 'README.md'), 'utf8')).toBe('# Docs\n');
  });

  it('refuses to rename onto another entry', async () => {
    writeFileSync(join(root, 'docs', 'other.md'), 'other\n');

    expect(await refusal(rename({ path: 'docs/readme.md', name: 'OTHER.md' }))).toEqual(nameTaken);
    expect(names('docs')).toEqual([ 'other.md', 'readme.md' ]);
    expect(readFileSync(join(root, 'docs', 'other.md'), 'utf8')).toBe('other\n');
  });

  it('AC-FILE-001.25: stores names in NFC', async () => {
    const decomposed = 'café';

    expect(await create({ folder: '', name: decomposed, kind: 'file' })).toEqual({ path: 'café.md' });
    expect(names()).toContain('café.md');
    expect(names()).not.toContain(`${decomposed}.md`);
    expect(await refusal(create({ folder: '', name: 'CAFÉ.md', kind: 'file' }))).toEqual(nameTaken);
    expect(await refusal(create({ folder: '', name: `${decomposed}.md`, kind: 'folder' }))).toEqual(nameTaken);
  });

  it('renames guide.md to guide.txt as guide.txt.md', async () => {
    writeFileSync(join(root, 'docs', 'guide.md'), 'guide\n');

    expect(await rename({ path: 'docs/guide.md', name: 'guide.txt' })).toEqual({ path: 'docs/guide.txt.md' });
    expect(names('docs')).toEqual([ 'guide.txt.md', 'readme.md' ]);
  });

  it('renames a folder with what it holds', async () => {
    expect(await rename({ path: 'docs', name: 'manual' })).toEqual({ path: 'manual' });
    expect(names('manual')).toEqual([ 'readme.md' ]);
    expect(existsSync(join(root, 'docs'))).toBe(false);
  });

  it('refuses a new name that is too long once .md is added', async () => {
    const answer = await refusal(create({ folder: '', name: 'a'.repeat(254), kind: 'file' }));
    expect(answer).toMatchObject({ code: 'validation-failed', fields: [ { path: 'name', code: 'too-long' } ] });
  });

  it('refuses to rename a non-Markdown file, a symbolic link or a submodule', async () => {
    writeFileSync(join(root, 'logo.png'), 'png');
    symlinkSync('docs/readme.md', join(root, 'link.md'));
    mkdirSync(join(root, 'vendor', 'lib'), { recursive: true });
    const sha = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`);

    for (const path of [ 'logo.png', 'link.md', 'vendor/lib', '' ]) {
      expect(await refusal(rename({ path, name: 'other.md' }))).toEqual(notRenamable);
    }
    expect(names()).toEqual([ 'docs', 'link.md', 'logo.png', 'vendor' ]);
    expect(names('vendor')).toEqual([ 'lib' ]);
  });

  it('refuses to rename a symbolic link', async () => {
    mkdirSync(join(root, 'target'));
    writeFileSync(join(root, 'target', 'a.md'), 'a\n');
    symlinkSync('target', join(root, 'linked'));

    expect(await refusal(rename({ path: 'linked', name: 'moved' }))).toEqual(notRenamable);
    expect(await refusal(rename({ path: 'linked/a.md', name: 'b.md' })))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'symlink' } });
    expect(await refusal(create({ folder: 'linked', name: 'b', kind: 'file' })))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'symlink' } });
    expect(names()).toEqual([ 'docs', 'linked', 'target' ]);
    expect(names('target')).toEqual([ 'a.md' ]);
  });

  it('refuses changes during a merge', async () => {
    writeFileSync(join(root, 'docs', 'readme.md'), 'main\n');
    git(root, 'commit', '-q', '-am', 'main');
    git(root, 'checkout', '-q', '-b', 'other', 'HEAD~1');
    writeFileSync(join(root, 'docs', 'readme.md'), 'other\n');
    git(root, 'commit', '-q', '-am', 'other');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', 'other');
    const before = names('docs');

    const merging = { status: 409, code: 'merge-in-progress', params: {} };
    expect(await refusal(create({ folder: 'docs', name: 'notes', kind: 'file' }))).toEqual(merging);
    expect(await refusal(rename({ path: 'docs/readme.md', name: 'guide' }))).toEqual(merging);
    expect(names('docs')).toEqual(before);
    expect(publish).not.toHaveBeenCalled();

    git(root, 'merge', '--abort');
    expect(await create({ folder: 'docs', name: 'notes', kind: 'file' })).toEqual({ path: 'docs/notes.md' });
  });

  it('refuses a missing parent folder with entry-not-found', async () => {
    const missing = { status: 404, code: 'entry-not-found', params: {} };
    expect(await refusal(create({ folder: 'nope', name: 'a', kind: 'file' }))).toEqual(missing);
    expect(await refusal(create({ folder: 'docs/readme.md', name: 'a', kind: 'file' }))).toEqual(missing);
    expect(await refusal(rename({ path: 'docs/gone.md', name: 'a' }))).toEqual(missing);
  });

  it('refuses .git as a folder', async () => {
    expect(await refusal(create({ folder: '.git', name: 'a', kind: 'file' })))
      .toEqual({ status: 400, code: 'path-refused', params: { reason: 'inside-git' } });
  });

  it('publishes files.changed with the parent folder', async () => {
    await create({ folder: 'docs', name: 'notes', kind: 'file' });
    await rename({ path: 'docs', name: 'manual' });

    expect(publish.mock.calls).toEqual([
      [ USER, { type: 'files.changed', repositoryId: REPO, folders: [ 'docs' ] } ],
      [ USER, { type: 'files.changed', repositoryId: REPO, folders: [ '' ] } ]
    ]);
  });
});
