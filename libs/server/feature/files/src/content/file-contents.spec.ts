import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOptions, GitRunner, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DataLayout } from '@front-burner/server-core-storage';
import { EDITABLE_FILE_LIMIT, type SaveFileRequest } from '@front-burner/shared-contracts';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkingTreeGuard } from '../actions/working-tree-guard';
import { toFilesError } from '../files/files-errors';
import type { OpenableRepository } from '../repository/openable-repository';
import { FileContents } from './file-contents';
import { hashBytes } from './markdown-codec';

const failRename = vi.hoisted(() => ({ on: false }));

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    rename: (from: string, to: string) =>
      failRename.on ? Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' })) : original.rename(from, to)
  };
});

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
const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);

const refusal = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => 'succeeded',
    (error: unknown) =>
      error instanceof ApiErrorException
        ? { status: error.getStatus(), code: error.code, params: error.params }
        : error
  );

const missing = { status: 404, code: 'entry-not-found', params: {} };
const notEditable = { status: 400, code: 'entry-not-editable', params: {} };
const tooLarge = { status: 413, code: 'file-too-large', params: { limit: EDITABLE_FILE_LIMIT } };
const symlinkRefused = { status: 400, code: 'path-refused', params: { reason: 'symlink' } };

describe('FileContents', () => {
  let dataDir: string;
  let layout: DataLayout;
  let root: string;
  let publish: ReturnType<typeof vi.fn>;
  let contents: FileContents;

  // As the controller answers them.
  const read = (path: string) => contents.read(root, path).catch(toFilesError);
  const save = (request: SaveFileRequest) => contents.save(USER, REPO, request);
  const recreate = (request: SaveFileRequest) => contents.recreate(USER, REPO, request);
  const bytesOf = (path: string) => readFileSync(join(root, path));

  beforeEach(() => {
    failRename.on = false;
    dataDir = mkdtempSync(join(tmpdir(), 'fb-contents-spec-'));
    layout = new DataLayout(dataDir);
    mkdirSync(layout.tmpDir, { recursive: true });
    root = layout.workingCopy(USER, REPO);
    mkdirSync(join(root, 'docs'), { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'docs', 'readme.md'), '# Docs\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    const engine = new GitEngine(options, new GitRunner());
    const repositories = { root: vi.fn().mockReturnValue(root) } as unknown as OpenableRepository;
    publish = vi.fn();
    contents = new FileContents(
      repositories,
      new WorkingTreeGuard(new WorkingTreeLock(), engine),
      engine,
      { publish } as unknown as EventsHub,
      layout
    );
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reads a file with its line ending, BOM and hash', async () => {
    const bytes = Buffer.concat([ BOM, Buffer.from('# A\r\nb\r\n') ]);
    writeFileSync(join(root, 'docs', 'a.md'), bytes);

    expect(await contents.read(root, 'docs/a.md')).toEqual({
      path: 'docs/a.md',
      content: '# A\nb\n',
      lineEnding: 'crlf',
      bom: true,
      hash: hashBytes(bytes),
      size: bytes.length
    });
    expect(await contents.state(root, 'docs/a.md')).toEqual({ hash: hashBytes(bytes), size: bytes.length });
  });

  it('AC-FILE-001.10: refuses a 2 MB file and a Latin-1 file', async () => {
    writeFileSync(join(root, 'big.md'), Buffer.alloc(2 * EDITABLE_FILE_LIMIT, 'a'));
    writeFileSync(join(root, 'latin.md'), Buffer.from([ 0x63, 0x61, 0x66, 0xe9 ]));

    expect(await refusal(read('big.md'))).toEqual(tooLarge);
    expect(await refusal(read('latin.md')))
      .toEqual({ status: 422, code: 'file-not-utf8', params: {} });
  });

  it('AC-FILE-001.11: refuses to read through a symbolic link', async () => {
    const outside = join(dataDir, 'outside.md');
    writeFileSync(outside, 'secret\n');
    symlinkSync(outside, join(root, 'link.md'));
    symlinkSync(join(root, 'docs'), join(root, 'linked'));

    expect(await refusal(read('link.md'))).toEqual(symlinkRefused);
    expect(await refusal(read('linked/readme.md'))).toEqual(symlinkRefused);
    expect(await refusal(save({ path: 'link.md', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(symlinkRefused);
    expect(readFileSync(outside, 'utf8')).toBe('secret\n');
  });

  it('refuses a non-Markdown file', async () => {
    writeFileSync(join(root, 'notes.txt'), 'text\n');
    mkdirSync(join(root, 'folder.md'));

    expect(await refusal(read('notes.txt'))).toEqual(notEditable);
    expect(await refusal(read('folder.md'))).toEqual(notEditable);
    expect(await refusal(read(''))).toEqual(notEditable);
    expect(await refusal(save({ path: 'notes.txt', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(notEditable);
    expect(await refusal(save({ path: 'folder.md', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(notEditable);
    expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe('text\n');
  });

  it('refuses a name with a NUL as malformed', async () => {
    const malformed = { status: 400, code: 'path-refused', params: { reason: 'malformed' } };
    const request: SaveFileRequest = { path: 'a\u0000.md', content: 'x', lineEnding: 'lf', bom: false };

    expect(await refusal(read('a\u0000.md'))).toEqual(malformed);
    expect(await refusal(save(request))).toEqual(malformed);
    expect(await refusal(recreate(request))).toEqual(malformed);
  });

  it('saves and returns the new hash', async () => {
    const state = await save({ path: 'docs/readme.md', content: '# New\n', lineEnding: 'crlf', bom: false });

    expect(bytesOf('docs/readme.md')).toEqual(Buffer.from('# New\r\n'));
    expect(state).toEqual({ hash: hashBytes(Buffer.from('# New\r\n')), size: 7 });
    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('measures the limit on the bytes written', async () => {
    // One character short of the limit as text; the CR makes it exactly the limit, the BOM goes over.
    const content = 'a'.repeat(EDITABLE_FILE_LIMIT - 2) + '\n';

    expect(await refusal(save({ path: 'docs/readme.md', content, lineEnding: 'crlf', bom: true }))).toEqual(tooLarge);
    expect(bytesOf('docs/readme.md').toString()).toBe('# Docs\n');

    expect(await save({ path: 'docs/readme.md', content, lineEnding: 'crlf', bom: false }))
      .toMatchObject({ size: EDITABLE_FILE_LIMIT });
  });

  it('refuses to save a missing file', async () => {
    unlinkSync(join(root, 'docs', 'readme.md'));

    expect(await refusal(save({ path: 'docs/readme.md', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(missing);
    expect(await refusal(save({ path: 'gone/a.md', content: 'x', lineEnding: 'lf', bom: false }))).toEqual(missing);
    expect(existsSync(join(root, 'docs', 'readme.md'))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps the old file when the rename fails', async () => {
    failRename.on = true;

    expect(await refusal(save({ path: 'docs/readme.md', content: 'new\n', lineEnding: 'lf', bom: false })))
      .toMatchObject({ code: 'EIO' });
    expect(bytesOf('docs/readme.md').toString()).toBe('# Docs\n');
    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('keeps the file mode', async () => {
    chmodSync(join(root, 'docs', 'readme.md'), 0o755);

    await save({ path: 'docs/readme.md', content: 'new\n', lineEnding: 'lf', bom: false });

    expect(statSync(join(root, 'docs', 'readme.md')).mode & 0o777).toBe(0o755);
  });

  it('refuses saves during a merge', async () => {
    writeFileSync(join(root, 'docs', 'readme.md'), 'main\n');
    git(root, 'commit', '-q', '-am', 'main');
    git(root, 'checkout', '-q', '-b', 'other', 'HEAD~1');
    writeFileSync(join(root, 'docs', 'readme.md'), 'other\n');
    git(root, 'commit', '-q', '-am', 'other');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', 'other');
    writeFileSync(join(root, 'docs', 'other.md'), 'other\n');
    const before = bytesOf('docs/readme.md');

    const merging = { status: 409, code: 'merge-in-progress', params: {} };
    expect(await refusal(save({ path: 'docs/other.md', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(merging);
    expect(await refusal(save({ path: 'docs/readme.md', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(merging);
    expect(await refusal(recreate({ path: 'docs/new.md', content: 'x', lineEnding: 'lf', bom: false })))
      .toEqual(merging);
    expect(bytesOf('docs/readme.md')).toEqual(before);
    expect(bytesOf('docs/other.md').toString()).toBe('other\n');
    expect(existsSync(join(root, 'docs', 'new.md'))).toBe(false);
  });

  it('recreates a deleted file and refuses an existing one', async () => {
    unlinkSync(join(root, 'docs', 'readme.md'));
    const request: SaveFileRequest = { path: 'docs/readme.md', content: 'back\n', lineEnding: 'crlf', bom: true };

    const state = await recreate(request);

    const bytes = Buffer.concat([ BOM, Buffer.from('back\r\n') ]);
    expect(bytesOf('docs/readme.md')).toEqual(bytes);
    expect(state).toEqual({ hash: hashBytes(bytes), size: bytes.length });
    expect(await refusal(recreate({ ...request, content: 'again\n' })))
      .toEqual({ status: 409, code: 'entry-exists', params: {} });
    expect(bytesOf('docs/readme.md')).toEqual(bytes);
    expect(await refusal(recreate({ ...request, path: 'gone/a.md' }))).toEqual(missing);
    expect(await refusal(recreate({ ...request, path: 'docs/a.txt' }))).toEqual(notEditable);
    expect(await refusal(recreate({ ...request, path: 'docs/README.md' })))
      .toEqual({ status: 409, code: 'entry-exists', params: {} });
    expect(readdirSync(join(root, 'docs'))).toEqual([ 'readme.md' ]);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
  });

  it('publishes files.changed with the saved hash', async () => {
    const saved = await save({ path: 'docs/readme.md', content: 'new\n', lineEnding: 'lf', bom: false });
    unlinkSync(join(root, 'docs', 'readme.md'));
    const recreated = await recreate({ path: 'docs/readme.md', content: 'back\n', lineEnding: 'lf', bom: false });

    expect(publish.mock.calls).toEqual([
      [ USER, {
        type: 'files.changed',
        repositoryId: REPO,
        folders: [ 'docs' ],
        files: [ { path: 'docs/readme.md', hash: saved.hash } ]
      } ],
      [ USER, {
        type: 'files.changed',
        repositoryId: REPO,
        folders: [ 'docs' ],
        files: [ { path: 'docs/readme.md', hash: recreated.hash } ]
      } ]
    ]);
  });

  it('does not stage or commit', async () => {
    const head = git(root, 'rev-parse', 'HEAD');

    await save({ path: 'docs/readme.md', content: '# Changed\n', lineEnding: 'lf', bom: false });

    expect(git(root, 'status', '--porcelain')).toBe(' M docs/readme.md\n');
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });
});
