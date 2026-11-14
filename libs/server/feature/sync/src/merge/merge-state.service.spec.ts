import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitMerge, GitRunner, LocalGit } from '@front-burner/server-core-git';
import type { DataLayout } from '@front-burner/server-core-storage';
import { FileContents, type OpenableRepository, type WorkingTreeGuard } from '@front-burner/server-feature-files';
import { EDITABLE_FILE_LIMIT } from '@front-burner/shared-contracts';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRemote, git, testGitOptions } from '../testing/git-fixtures';
import { MergeStateService } from './merge-state.service';

const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' };

type Content = string | Buffer | { link: string; };

describe('MergeStateService', () => {
  const options = testGitOptions();
  const runner = new GitRunner();
  const engine = new GitEngine(options, runner);
  const merge = new GitMerge(new LocalGit(runner), options);
  const contents = new FileContents(
    {} as OpenableRepository,
    {} as WorkingTreeGuard,
    engine,
    {} as EventsHub,
    {} as DataLayout
  );
  const service = new MergeStateService(merge, contents);
  let root: string;
  let bare: string;
  let work: string;
  let elsewhere: string;

  function put(folder: string, files: Record<string, Content | null>): void {
    for (const [ path, content ] of Object.entries(files)) {
      const absolute = join(folder, path);
      rmSync(absolute, { force: true });
      if (content === null) {
        continue;
      }
      mkdirSync(dirname(absolute), { recursive: true });
      if (typeof content === 'object' && 'link' in content) {
        symlinkSync(content.link, absolute);
      } else {
        writeFileSync(absolute, content);
      }
    }
    git(folder, 'add', '-A');
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'files');
  }

  /** Commits `base` on both sides, then `theirs` on the remote and `mine` here, and merges. */
  async function merged(
    base: Record<string, Content>,
    mine: Record<string, Content | null>,
    theirs: Record<string, Content | null>
  ): Promise<void> {
    put(work, base);
    git(work, 'push', '-q', 'origin', 'main');
    git(elsewhere, 'pull', '-q', 'origin', 'main');
    put(elsewhere, theirs);
    git(elsewhere, 'push', '-q', 'origin', 'main');
    put(work, mine);
    git(work, 'fetch', '-q', 'origin');
    const result = await merge.merge(work, { branch: 'main', upstream: 'origin/main', author: AUTHOR });
    expect(result.kind).toBe('conflicted');
  }

  const editableOf = async () =>
    Object.fromEntries((await service.read(work)).files.map(({ path, editable }) => [ path, editable ]));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'merge-state-'));
    bare = createRemote(root);
    work = join(root, 'work');
    elsewhere = join(root, 'elsewhere');
    git(root, 'clone', '-q', bare, work);
    git(root, 'clone', '-q', bare, elsewhere);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('answers that a rebase is no merge', async () => {
    mkdirSync(join(work, '.git', 'rebase-merge'));

    await expect(service.read(work)).rejects.toMatchObject({ code: 'no-merge-in-progress' });
  });

  it('a file git could not merge as text is not editable, on either side', async () => {
    await merged(
      { 'mine-binary.md': 'base\n', 'theirs-binary.md': 'base\n', 'text.md': 'base\n' },
      { 'mine-binary.md': 'mi\0ne\n', 'theirs-binary.md': 'mine\n', 'text.md': 'mine\n' },
      { 'mine-binary.md': 'theirs\n', 'theirs-binary.md': 'thei\0rs\n', 'text.md': 'theirs\n' }
    );

    expect(await editableOf()).toEqual({ 'mine-binary.md': false, 'text.md': true, 'theirs-binary.md': false });
  });

  it('a file the user took the markers out of stays editable', async () => {
    await merged({ 'a.md': 'base\n' }, { 'a.md': 'mine\n' }, { 'a.md': 'theirs\n' });
    writeFileSync(join(work, 'a.md'), 'both of them\n');

    expect(await editableOf()).toEqual({ 'a.md': true });
  });

  it('a problem with one file leaves it not editable, and the others readable', async () => {
    await merged(
      { 'a.md': 'base\n', 'b.md': 'base\n' },
      { 'a.md': 'mine\n', 'b.md': 'mine\n' },
      { 'a.md': 'theirs\n', 'b.md': 'theirs\n' }
    );
    const readTracked = contents.readTracked.bind(contents);
    vi.spyOn(contents, 'readTracked').mockImplementation((folder, path) =>
      path === 'a.md' ? Promise.reject(new Error('EACCES')) : readTracked(folder, path)
    );

    expect(await editableOf()).toEqual({ 'a.md': false, 'b.md': true });
  });

  it('asks git nothing per file that has its markers, and scans no working tree', async () => {
    await merged(
      { 'a.md': 'base\n', 'b.md': 'base\n' },
      { 'a.md': 'mine\n', 'b.md': 'mine\n' },
      { 'a.md': 'theirs\n', 'b.md': 'theirs\n' }
    );
    const run = vi.spyOn(runner, 'run');

    await service.read(work);

    const words = run.mock.calls.flatMap(([ args ]) => args);
    expect(words).toContain('ls-files');
    expect(words).not.toContain('status');
    expect(words).not.toContain('merge-file');
    expect(words).not.toContain('--stage');
  });

  it('says what merges into what', async () => {
    await merged(
      { 'a.md': 'base\n', 'clean.md': 'one\ntwo\nthree\n' },
      { 'a.md': 'mine\n', 'clean.md': 'ONE\ntwo\nthree\n' },
      { 'a.md': 'their text\n', 'clean.md': 'one\ntwo\nTHREE\n', 'new.md': 'new\n' }
    );

    expect(await service.read(work)).toEqual({
      into: 'main',
      from: 'origin/main',
      files: [
        {
          path: 'a.md',
          kind: 'both-changed',
          resolved: false,
          edited: false,
          editable: true,
          oursSize: 5,
          theirsSize: 11,
          oursShowable: true,
          theirsShowable: true
        }
      ],
      otherFiles: [ 'clean.md', 'new.md' ],
      message: 'Merge remote-tracking branch \'origin/main\''
    });
  });

  it('names the upstream after a fetch pruned it', async () => {
    await merged({ 'a.md': 'base\n' }, { 'a.md': 'mine\n' }, { 'a.md': 'theirs\n' });
    git(bare, 'branch', '-q', 'other', 'main');
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/other');
    git(bare, 'branch', '-q', '-D', 'main');
    git(work, 'fetch', '-q', '--prune', 'origin');
    expect(git(work, 'branch', '-r')).not.toContain('origin/main');

    expect(await service.read(work)).toMatchObject({ into: 'main', from: 'origin/main' });
  });

  it('names what git has when the branch has no upstream', async () => {
    await merged({ 'a.md': 'base\n' }, { 'a.md': 'mine\n' }, { 'a.md': 'theirs\n' });
    git(work, 'config', '--unset', 'branch.main.remote');
    git(work, 'config', '--unset', 'branch.main.merge');

    expect(await service.read(work)).toMatchObject({ into: 'main', from: 'MERGE_HEAD' });
  });

  it('marks a Markdown file editable', async () => {
    await merged(
      { 'a.md': 'base\n', 'UPPER.MD': 'base\n' },
      { 'a.md': 'mine\n', 'UPPER.MD': 'mine\n', 'added.md': 'mine\n' },
      { 'a.md': 'theirs\n', 'UPPER.MD': 'theirs\n', 'added.md': 'theirs\n' }
    );

    expect(await editableOf()).toEqual({ 'UPPER.MD': true, 'a.md': true, 'added.md': true });
  });

  it('a PNG, a large file, a file that is not valid UTF-8, a symbolic link and a file through a linked folder are not editable', async () => {
    const large = (fill: string) => `${fill.repeat(EDITABLE_FILE_LIMIT)}\n`;
    await merged(
      {
        'image.png': 'base\n',
        'large.md': 'base\n',
        'latin.md': 'base\n',
        'link.md': { link: 'base.txt' },
        'linked/inner.md': 'base\n',
        'swapped.md': 'base\n'
      },
      {
        'image.png': 'mine\n',
        'large.md': large('m'),
        'latin.md': Buffer.from([ 0x6d, 0xe9, 0x0a ]),
        'link.md': { link: 'mine.txt' },
        'linked/inner.md': 'mine\n',
        'swapped.md': 'mine\n'
      },
      {
        'image.png': 'theirs\n',
        'large.md': large('t'),
        'latin.md': Buffer.from([ 0x74, 0xe9, 0x0a ]),
        'link.md': { link: 'theirs.txt' },
        'linked/inner.md': 'theirs\n',
        'swapped.md': 'theirs\n'
      }
    );
    // What the merge wrote is only what is on disk now: both of these are links in the working copy.
    rmSync(join(work, 'linked'), { recursive: true });
    symlinkSync(root, join(work, 'linked'));
    rmSync(join(work, 'swapped.md'));
    symlinkSync(join(root, 'outside.md'), join(work, 'swapped.md'));
    writeFileSync(join(root, 'outside.md'), 'outside\n');

    expect(await editableOf()).toEqual({
      'image.png': false,
      'large.md': false,
      'latin.md': false,
      'link.md': false,
      'linked/inner.md': false,
      'swapped.md': false
    });
  });

  it('a file one side deleted is not editable', async () => {
    await merged(
      { 'by-me.md': 'base\n', 'by-them.md': 'base\n' },
      { 'by-me.md': null, 'by-them.md': 'mine\n' },
      { 'by-me.md': 'theirs\n', 'by-them.md': null }
    );

    const { files } = await service.read(work);

    expect(files).toEqual([
      {
        path: 'by-me.md',
        kind: 'deleted-by-us',
        resolved: false,
        edited: false,
        editable: false,
        oursSize: null,
        theirsSize: 7,
        oursShowable: false,
        theirsShowable: true
      },
      {
        path: 'by-them.md',
        kind: 'deleted-by-them',
        resolved: false,
        edited: false,
        editable: false,
        oursSize: 5,
        theirsSize: null,
        oursShowable: true,
        theirsShowable: false
      }
    ]);
  });

  it('reports a resolved file', async () => {
    await merged({ 'a.md': 'base\n' }, { 'a.md': 'mine\n' }, { 'a.md': 'theirs\n' });
    writeFileSync(join(work, 'a.md'), 'both\n');
    git(work, 'add', 'a.md');

    expect((await service.read(work)).files).toEqual([
      {
        path: 'a.md',
        kind: 'both-changed',
        resolved: true,
        edited: true,
        editable: true,
        oursSize: 5,
        theirsSize: 7,
        oursShowable: true,
        theirsShowable: true
      }
    ]);
  });

  it('refuses readVersion for symbolic links with version-not-readable, and says they can\'t be shown', async () => {
    await merged(
      { 'link.md': { link: 'base.txt' } },
      { 'link.md': { link: 'mine.txt' } },
      { 'link.md': { link: 'theirs.txt' } }
    );

    // A link has a size, as any blob does, so the size alone can't tell.
    expect((await service.read(work)).files).toMatchObject([
      { path: 'link.md', oursShowable: false, theirsShowable: false }
    ]);

    await expect(service.readVersion(work, 'link.md', 'ours')).rejects.toMatchObject({
      code: 'version-not-readable'
    });
    await expect(service.readVersion(work, 'link.md', 'theirs')).rejects.toMatchObject({
      code: 'version-not-readable'
    });
  });

  it('refuses readVersion for non-Markdown files with version-not-readable', async () => {
    await merged(
      { 'config.env': 'BASE=1\n', 'app.ts': 'console.log("base");\n' },
      { 'config.env': 'BASE=2\n', 'app.ts': 'console.log("mine");\n' },
      { 'config.env': 'BASE=3\n', 'app.ts': 'console.log("theirs");\n' }
    );

    await expect(service.readVersion(work, 'config.env', 'ours')).rejects.toMatchObject({
      code: 'version-not-readable'
    });
    await expect(service.readVersion(work, 'config.env', 'theirs')).rejects.toMatchObject({
      code: 'version-not-readable'
    });
    await expect(service.readVersion(work, 'app.ts', 'ours')).rejects.toMatchObject({ code: 'version-not-readable' });
    await expect(service.readVersion(work, 'app.ts', 'theirs')).rejects.toMatchObject({ code: 'version-not-readable' });
    expect((await service.read(work)).files).toMatchObject([
      { path: 'app.ts', oursShowable: false, theirsShowable: false },
      { path: 'config.env', oursShowable: false, theirsShowable: false }
    ]);
  });

  it('refuses a large version without reading the blob', async () => {
    const large = (fill: string) => `${fill.repeat(EDITABLE_FILE_LIMIT)}\n`;
    await merged(
      { 'large.md': 'base\n' },
      { 'large.md': large('m') },
      { 'large.md': 'theirs\n' }
    );
    const readBlob = vi.spyOn(merge, 'readVersion');

    expect((await service.read(work)).files).toMatchObject([
      { path: 'large.md', oursShowable: false, theirsShowable: true }
    ]);
    await expect(service.readVersion(work, 'large.md', 'ours')).rejects.toMatchObject({
      code: 'version-not-readable'
    });

    expect(readBlob).not.toHaveBeenCalled();
  });

  it('allows readVersion for Markdown files in conflict', async () => {
    await merged(
      { 'notes.md': 'base\n' },
      { 'notes.md': 'mine\n' },
      { 'notes.md': 'theirs\n' }
    );

    const ours = await service.readVersion(work, 'notes.md', 'ours');
    const theirs = await service.readVersion(work, 'notes.md', 'theirs');

    expect(ours.content).toBe('mine\n');
    expect(theirs.content).toBe('theirs\n');
  });

  it('returns no-merge-in-progress when merge is aborted between checks', async () => {
    await merged(
      { 'notes.md': 'base\n' },
      { 'notes.md': 'mine\n' },
      { 'notes.md': 'theirs\n' }
    );

    // Simulate the merge being aborted on another device between the two checks:
    // the first mergeInProgress returns true, conflict finds nothing (merge aborted),
    // then the second mergeInProgress returns false.
    vi.spyOn(merge, 'conflict').mockResolvedValue(null);
    let callCount = 0;
    vi.spyOn(merge, 'mergeInProgress').mockImplementation(async () => {
      callCount++;
      return callCount === 1;
    });

    await expect(service.readVersion(work, 'notes.md', 'ours')).rejects.toMatchObject({
      code: 'no-merge-in-progress'
    });
  });

  it('returns not-conflicting when the file is not in conflicts and merge is still in progress', async () => {
    await merged(
      { 'notes.md': 'base\n' },
      { 'notes.md': 'mine\n' },
      { 'notes.md': 'theirs\n' }
    );

    await expect(service.readVersion(work, 'nonexistent.md', 'ours')).rejects.toMatchObject({
      code: 'not-conflicting'
    });
  });

  it('strips a BOM from the returned content', async () => {
    const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);
    const withBom = Buffer.concat([ BOM, Buffer.from('mine\n') ]);
    await merged(
      { 'notes.md': 'base\n' },
      { 'notes.md': withBom },
      { 'notes.md': 'theirs\n' }
    );

    const { content } = await service.readVersion(work, 'notes.md', 'ours');

    expect(content).toBe('mine\n');
  });

  it('converts CRLF to LF in the returned content', async () => {
    await merged(
      { 'notes.md': 'base\n' },
      { 'notes.md': Buffer.from('line one\r\nline two\r\n') },
      { 'notes.md': 'theirs\n' }
    );

    const { content } = await service.readVersion(work, 'notes.md', 'ours');

    expect(content).toBe('line one\nline two\n');
  });

  it('accepts a file containing U+FFFD', async () => {
    await merged(
      { 'notes.md': 'base\n' },
      { 'notes.md': Buffer.from('replaced \ufffd char\n') },
      { 'notes.md': 'theirs\n' }
    );

    const { content } = await service.readVersion(work, 'notes.md', 'ours');

    expect(content).toBe('replaced \ufffd char\n');
  });
});
