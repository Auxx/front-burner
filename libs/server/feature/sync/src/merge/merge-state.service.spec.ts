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
  const engine = new GitEngine(options, new GitRunner());
  const merge = new GitMerge(new LocalGit(new GitRunner()), options);
  const service = new MergeStateService(
    engine,
    merge,
    new FileContents({} as OpenableRepository, {} as WorkingTreeGuard, engine, {} as EventsHub, {} as DataLayout)
  );
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
    rmSync(root, { recursive: true, force: true });
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
        { path: 'a.md', kind: 'both-changed', resolved: false, editable: true, mineSize: 5, theirsSize: 11 }
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
      { path: 'by-me.md', kind: 'deleted-by-me', resolved: false, editable: false, mineSize: null, theirsSize: 7 },
      { path: 'by-them.md', kind: 'deleted-by-them', resolved: false, editable: false, mineSize: 5, theirsSize: null }
    ]);
  });

  it('reports a resolved file', async () => {
    await merged({ 'a.md': 'base\n' }, { 'a.md': 'mine\n' }, { 'a.md': 'theirs\n' });
    writeFileSync(join(work, 'a.md'), 'both\n');
    git(work, 'add', 'a.md');

    expect((await service.read(work)).files).toEqual([
      { path: 'a.md', kind: 'both-changed', resolved: true, editable: true, mineSize: 5, theirsSize: 7 }
    ]);
  });
});
