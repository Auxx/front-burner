import { inBatches, lstatOrMissing, PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import type { CloneMode } from '@front-burner/shared-contracts';
import { ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { access, mkdtemp, readdir, readlink, rename, rm, unlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Broker, GitCredentials, openBroker } from '../broker/broker';
import { assertSafeRepositoryConfig, UnsafeRepositoryConfigError } from '../config/repository-config';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult, GitRunner } from '../runner/git-runner';
import { redactCredentials } from '../runner/redact';
import { probeHostKey } from '../ssh/host-key-probe';
import { hasHostEntry, HostKey, trustedKeysFor } from '../ssh/known-hosts';
import { FileDiff, onlyLineEndingsDiffer, parseUnifiedDiff } from './git-diff';
import { classifyGitFailure, classifyPushFailure, GitOperationError } from './git-errors';
import { parseStatus, WorkingCopyStatus } from './git-status';
import { LOCAL_TIMEOUT_MS, LocalGit, NO_LFS, nulTerminated } from './local-git';

/** What `git status` shows for a byte of a name that is not valid UTF-8. */
const UNDECODABLE = '\uFFFD';

/** AR-42. */
const ACCESS_CHECK_TIMEOUT_MS = 30_000;

export interface AccessCheckResult {
  /** Sorted; empty for an empty remote (AR-37). */
  branches: string[];
  /** The branch the remote's `HEAD` points to, when it exists. */
  defaultBranch: string | undefined;
}

export interface CloneRequest {
  remoteUrl: string;
  credentials: GitCredentials;
  mode: CloneMode;
  /** Required for `single-branch`. */
  branch?: string;
  /** On the same file system as `destination` (NF-5.3). */
  tmpRoot: string;
  /** Must not exist yet; its parent must. */
  destination: string;
  /** For SSH: the user's accepted hosts as `known_hosts` lines; the instance's are always added. */
  knownHosts?: string[];
}

export interface PushRequest {
  /** The repository's stored remote; `origin` must have this URL. */
  remoteUrl: string;
  credentials: GitCredentials;
  /** For SSH: the user's accepted hosts as `known_hosts` lines; the instance's are always added. */
  knownHosts: string[];
  /** The current branch. */
  branch: string;
  /** The working copy is a single-branch clone (GA-41). */
  singleBranch: boolean;
}

export interface PushResult {
  /** The commits the branch had that its upstream did not, counted before the push. */
  commits: number;
  /** Such as `origin/main`. */
  upstream: string;
}

interface NetworkRunOptions {
  /** Values for the user's message besides `host`. */
  params?: Record<string, string>;
  /** A working copy to run in; its config and `origin` are checked first (A-5.7). */
  cwd?: string;
  /** Classifies a failure as a push's, with the remote's own lines. */
  push?: boolean;
}

export interface CommitRequest {
  /** Checked by the caller (A-7.6); duplicates and paths that are not changes are ignored. */
  paths: string[];
  /** As the user wrote it; git removes trailing spaces and trailing blank lines (GA-21). */
  message: string;
  /** Recorded as author and committer (CA-2). */
  author: { name: string; email: string; };
  /** Replaces the last commit (GA-22); then `paths` may name no change. */
  amend?: boolean;
}

/** The current branch's last commit, as far as the commit form needs it (GA-22). */
export interface LastCommit {
  /** Which commit this is, so that a client can tell when it was replaced. */
  oid: string;
  /** It is on the current branch, not on any remote branch, and not a merge commit. */
  amendable: boolean;
  /** Without a trailing line break; `null` when it cannot be amended, as nothing else needs it. */
  message: string | null;
}

/** GA-16: a diff larger than this, with 3 lines of context, is not shown. */
const DIFF_LIMIT_BYTES = 1_000_000;

/** git's empty tree, which it knows without having the object. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Global options of every diff: attributes are read from the empty tree, so
 * that a repository's `.gitattributes` (`-diff`, `binary`, `text`, `eol`) does
 * not choose how a diff is made, and line ending changes are always shown (GA-16).
 */
const DIFF_GLOBALS = [ '--no-optional-locks', `--attr-source=${EMPTY_TREE}` ];

/** Nor does the repository's configuration. */
const DIFF_FLAGS = [ '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames' ];

/** Room for a whole-file diff: both versions of a file at the limit, with a prefix per line. */
const WHOLE_FILE_MAX_BYTES = 4 * DIFF_LIMIT_BYTES;

/** More lines of context than any file has: the whole file. */
const WHOLE_FILE_CONTEXT = '--unified=2147483647';

/** A file's diff without changed lines. */
const NO_DIFF: FileDiff = { kind: 'text', lines: [], complete: true, lineEndingsOnly: false };

/** Index entries of submodules (`git ls-files --stage`). */
const GITLINK_MODE = '160000';

/** Escapes the characters a `:(glob)` pathspec treats as wildcards. */
const escapeGlob = (path: string) => path.replace(/[*?[\\]/g, '\\$&');

/** What git leaves in `.git` while a merge or rebase waits for the user. */
const IN_PROGRESS_MARKERS = [ 'MERGE_HEAD', 'rebase-merge', 'rebase-apply' ];

/** `git ls-remote --symref` output: `ref: <target>\t<name>` and `<oid>\t<name>` lines. */
function parseLsRemote(stdout: string): AccessCheckResult {
  const branches: string[] = [];
  let head: string | undefined;
  for (const line of stdout.split('\n')) {
    const [ left, name ] = line.split('\t');
    if (left?.startsWith('ref: ') && name === 'HEAD') {
      head = left.slice('ref: '.length);
    } else if (name?.startsWith('refs/heads/')) {
      branches.push(name.slice('refs/heads/'.length));
    }
  }
  branches.sort((a, b) => a.localeCompare(b));
  const defaultBranch = head?.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : undefined;
  return { branches, defaultBranch: defaultBranch && branches.includes(defaultBranch) ? defaultBranch : undefined };
}

/**
 * Git operations for features (A-5.10); features never build git command lines.
 * Every network command goes through a broker and the egress proxy (A-5.4, A-5.7).
 */
@Injectable()
export class GitEngine implements BeforeApplicationShutdown {
  private readonly logger = new Logger(GitEngine.name);

  constructor(
    @Inject(GIT_OPTIONS) private readonly options: GitOptions,
    private readonly runner: GitRunner,
    private readonly local: LocalGit = new LocalGit(runner)
  ) {}

  /**
   * Proves the remote can be read and lists its branches (`git ls-remote`, AR-42, A-5.9).
   *
   * @throws GitOperationError
   */
  async accessCheck(
    remoteUrl: string,
    credentials: GitCredentials,
    knownHosts: string[] = []
  ): Promise<AccessCheckResult> {
    const result = await this.runNetwork(
      'access check',
      remoteUrl,
      credentials,
      knownHosts,
      remote => [ 'ls-remote', '--symref', '--', remote, 'HEAD', 'refs/heads/*' ],
      ACCESS_CHECK_TIMEOUT_MS
    );
    return parseLsRemote(result.stdout);
  }

  /**
   * Clones into a fresh folder under `tmpRoot` and moves it to `destination`
   * with one rename (A-5.13, AR-49 to AR-51). On failure nothing is left behind.
   *
   * @throws GitOperationError
   */
  async clone(request: CloneRequest): Promise<void> {
    const dir = await mkdtemp(join(request.tmpRoot, 'clone-'));
    try {
      const single = request.mode === 'single-branch'
        ? [ '--single-branch', '--branch', request.branch ?? '', '--depth', '1' ]
        : [];
      await this.runNetwork(
        'clone',
        request.remoteUrl,
        request.credentials,
        request.knownHosts ?? [],
        remote => [ ...NO_LFS, 'clone', '--no-recurse-submodules', ...single, '--', remote, dir ],
        this.options.cloneTimeoutMs,
        { params: request.branch === undefined ? {} : { branch: request.branch } }
      );
      await this.assertSafeConfig(dir);
      await rename(dir, request.destination);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * The paths among `paths` that `.gitignore` rules ignore (`git check-ignore`),
   * including everything inside an ignored folder. Tracked paths are never
   * reported, even when a rule matches them (FB-20b). git scans the whole index
   * once per path, so this is for a few paths; a folder's entries take `ignoredIn`.
   */
  async ignoredAmong(workingCopy: string, paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) {
      return new Set();
    }
    // check-ignore reads each path as a pathspec, and has no literal mode: `./`
    // keeps a name such as `:!x` from being read as pathspec magic.
    const result = await this.local.run(
      workingCopy,
      [ 'check-ignore', '--stdin', '-z' ],
      { stdin: paths.map(path => `./${path}\0`).join('') }
    );
    // 1: none of the paths is ignored.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`git check-ignore failed: ${result.stderr.trim()}`);
    }
    return new Set(result.stdout.split('\0').filter(path => path !== '').map(path => path.replace(/^\.\//, '')));
  }

  /**
   * The names (not paths) of the untracked entries directly inside `folder`
   * (`''` is the root) that `.gitignore` rules ignore; a folder that holds a
   * tracked file is never one of them. `folder` must not be inside an ignored
   * folder: everything there is ignored, and git refuses to list it.
   */
  async ignoredIn(workingCopy: string, folder: string): Promise<Set<string>> {
    const prefix = folder === '' ? '' : `${folder}/`;
    const result = await this.local.run(workingCopy, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
      '--',
      `:(glob)${escapeGlob(prefix)}*`
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
    }
    // --directory: an ignored folder is one entry with a trailing `/`.
    return new Set(
      result.stdout.split('\0').filter(path => path !== '').map(path => path.slice(prefix.length).replace(/\/$/, ''))
    );
  }

  /**
   * The names (not paths) of the submodules (gitlinks) of the index directly
   * inside `folder` (`''` is the root).
   */
  async gitlinksIn(workingCopy: string, folder: string): Promise<Set<string>> {
    const entries = await this.indexEntriesIn(workingCopy, folder);
    return new Set([ ...entries ].filter(([ , mode ]) => mode === GITLINK_MODE).map(([ name ]) => name));
  }

  /**
   * The number of untracked and ignored files at or under `path` (`''` is the
   * root), counted one by one inside untracked and ignored folders. Modified
   * tracked files do not count: their committed version can be brought back
   * (FB-38), and neither does a nested repository. Never writes the index, so
   * it can run outside the working-tree lock.
   */
  async uncommittedUnder(workingCopy: string, path: string): Promise<number> {
    const result = await this.local.run(workingCopy, [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignored=traditional',
      '--',
      path === '' ? '.' : `:(literal)${path}`
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`git status failed: ${result.stderr.trim()}`);
    }
    // -z: "XY <path>\0" per record; a rename or copy, in either column, is followed by its source path.
    const records = result.stdout.split('\0');
    let count = 0;
    for (let index = 0; index < records.length; index++) {
      const record = records[index] ?? '';
      const status = record.slice(0, 2);
      if (status === '??' || status === '!!') {
        // With --untracked-files=all, only a nested repository is still a folder.
        count += record.endsWith('/') ? 0 : 1;
      } else if (/[RC]/.test(status)) {
        index++;
      }
    }
    return count;
  }

  /**
   * The branch, its counts against the upstream, and every changed file (GA-11).
   * Never writes the index, so it can run outside the working-tree lock (A-5.3).
   */
  async status(workingCopy: string): Promise<WorkingCopyStatus> {
    return this.statusUnder(workingCopy, [], LOCAL_TIMEOUT_MS);
  }

  /**
   * One changed file's difference from the last commit, as parsed lines, or
   * that it is binary or too large (GA-14 to GA-16). A file small enough gets
   * the whole file as context, so that every fold can be opened; a file that
   * is not changed has no lines. Never writes the index (A-5.3).
   */
  async diff(workingCopy: string, path: string): Promise<FileDiff> {
    // Limited to one path, it can still walk a large working copy's index.
    const status = await this.statusUnder(workingCopy, [ '--', `:(literal)${path}` ], this.options.gitTimeoutMs);
    const change = status.changes.find(entry => entry.path === path);
    if (change === undefined) {
      return NO_DIFF;
    }
    const added = change.state === 'added';
    const [ oldSize, onDisk ] = await Promise.all([
      added ? null : this.committedSize(workingCopy, path),
      change.state === 'deleted' ? undefined : lstatOrMissing(join(workingCopy, path))
    ]);
    if (added && onDisk === undefined) {
      // Added to the index, then deleted: nothing to compare.
      return NO_DIFF;
    }
    if (added && onDisk?.isSymbolicLink()) {
      // `--no-index` would read a linked folder; git stores a link as its target's name.
      const text = await readlink(join(workingCopy, path));
      return {
        kind: 'text',
        lines: [ { type: 'added', oldLine: null, newLine: 1, text } ],
        complete: true,
        lineEndingsOnly: false
      };
    }
    const newSize = onDisk?.size ?? null;
    // An added file is compared with nothing: before the first commit there is no HEAD.
    const run = (extra: string[], maxOutputBytes: number) =>
      this.runDiff(workingCopy, path, added, extra, maxOutputBytes);

    const short = await run([], DIFF_LIMIT_BYTES);
    // Counted as git wrote them: decoding would turn each invalid byte into three.
    if (short.bytes > DIFF_LIMIT_BYTES) {
      return { kind: 'too-large' };
    }
    const headers = short.text.split('\n@@ ')[0]?.split('\n') ?? [];
    if (headers.some(line => line.startsWith('Binary files '))) {
      return { kind: 'binary', oldSize, newSize };
    }
    if ((oldSize ?? 0) + (newSize ?? 0) <= DIFF_LIMIT_BYTES) {
      const whole = await run([ WHOLE_FILE_CONTEXT ], WHOLE_FILE_MAX_BYTES);
      // The file can grow after its size was read: a cut-off diff is never shown as whole.
      if (whole.bytes <= WHOLE_FILE_MAX_BYTES) {
        const lines = parseUnifiedDiff(whole.text);
        return { kind: 'text', lines, complete: true, lineEndingsOnly: onlyLineEndingsDiffer(lines) };
      }
    }
    const lines = parseUnifiedDiff(short.text);
    const lineEndingsOnly = change.state === 'modified' && lines.some(line => line.type !== 'context')
      && await this.differsOnlyInLineEndings(workingCopy, path);
    return { kind: 'text', lines, complete: false, lineEndingsOnly };
  }

  /** `git status` of the entries a pathspec names (`[]` for all), as `status` reads it. */
  private async statusUnder(workingCopy: string, pathspec: string[], timeoutMs: number): Promise<WorkingCopyStatus> {
    const result = await this.local.run(workingCopy, [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--ignored=no',
      ...pathspec
    ], { timeoutMs });
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new Error(`git status failed: ${result.stderr.trim()}`);
    }
    return parseStatus(result.stdout);
  }

  /**
   * The last commit and whether it can be amended (GA-22), or `null` without
   * commits. Never writes the index, so it can run outside the working-tree lock
   * (A-5.3).
   */
  async lastCommit(workingCopy: string): Promise<LastCommit | null> {
    // `--` everywhere: a file named HEAD would make the revision ambiguous.
    const [ head, unpushed, branch ] = await Promise.all([
      this.local.run(workingCopy, [ '--no-optional-locks', 'log', '-1', '--format=%H %P%x00%B', 'HEAD', '--' ]),
      // Walks only the commits that no remote branch has: nothing printed means HEAD was pushed.
      this.local.run(workingCopy, [ '--no-optional-locks', 'rev-list', '-1', 'HEAD', '--not', '--remotes', '--' ]),
      this.local.run(workingCopy, [ 'symbolic-ref', '--quiet', 'HEAD' ])
    ]);
    for (const result of [ head, unpushed, branch ]) {
      if (result.timedOut) {
        throw new GitOperationError('timeout', result.stderr);
      }
    }
    if (head.exitCode !== 0) {
      const resolved = await this.local.run(workingCopy, [ 'rev-parse', '--verify', '--quiet', 'HEAD' ]);
      if (resolved.exitCode !== 0 && !resolved.timedOut) {
        // HEAD names a branch that has no commit yet.
        return null;
      }
      throw new Error(`git log failed: ${head.stderr.trim()}`);
    }
    if (unpushed.exitCode !== 0) {
      throw new Error(`git rev-list failed: ${unpushed.stderr.trim()}`);
    }
    const separator = head.stdout.indexOf('\0');
    const [ oid = '', ...parents ] = head.stdout.slice(0, separator).trim().split(' ');
    if (branch.exitCode !== 0 || parents.length > 1 || unpushed.stdout.trim() === '') {
      return { oid, amendable: false, message: null };
    }
    return { oid, amendable: true, message: head.stdout.slice(separator + 1).replace(/\n+$/, '') };
  }

  /**
   * Commits exactly the listed paths, as they are on disk, with their additions
   * and deletions, as `author` (GA-19, CA-2). Paths that are not changes are
   * ignored. Anything else in the index is left out, and on failure the index
   * is emptied again, so that the working copy is as it was (GA-43). The
   * caller has checked the paths and holds the working-tree lock.
   *
   * With `amend`, replaces the last commit with one that has the message, the
   * last commit's files and the listed paths, which then need not name a change
   * (GA-22). The rule is checked here, inside the lock, since a push can have
   * happened after the client read the status.
   *
   * @throws GitOperationError `nothing-to-commit` when no path is a change, and
   * `amend-not-allowed` when the last commit cannot be amended.
   */
  async commit(workingCopy: string, request: CommitRequest): Promise<{ oid: string; }> {
    const amend = request.amend === true;
    const [ status, last ] = await Promise.all([
      this.status(workingCopy),
      amend ? this.lastCommit(workingCopy) : null
    ]);
    if (status.branch === null) {
      // A commit on no branch is lost after the next switch (plan 52's review).
      throw new GitOperationError('detached-head', 'HEAD is not on a branch.');
    }
    if (amend && last?.amendable !== true) {
      throw new GitOperationError('amend-not-allowed', 'The last commit cannot be amended.');
    }
    const changed = new Set(status.changes.map(change => change.path));
    const paths = [ ...new Set(request.paths) ].filter(path => changed.has(path));
    if (paths.length === 0 && !amend) {
      throw new GitOperationError('nothing-to-commit', 'None of the paths is a change.');
    }
    const emptyIndex = status.noCommits ? [ 'read-tree', '--empty' ] : [ 'reset', '-q' ];
    // With no commits, HEAD may name any branch; it is put back if the commit fails (GA-43).
    const unbornHead = status.noCommits ? await this.symbolicHead(workingCopy) : undefined;
    try {
      await this.local.checked(workingCopy, emptyIndex);
      if (unbornHead !== undefined) {
        // GA-42: whatever HEAD names in a new repository, the first commit makes `main`.
        await this.local.checked(workingCopy, [ 'symbolic-ref', 'HEAD', 'refs/heads/main' ]);
      }
      if (paths.length > 0) {
        // With no paths at all, `add -A` would add every change.
        await this.local.checked(
          workingCopy,
          [ '--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul' ],
          { stdin: nulTerminated(paths), timeoutMs: this.options.gitTimeoutMs }
        );
      }
      const { name, email } = request.author;
      await this.local.checked(
        workingCopy,
        [
          '-c',
          'commit.gpgsign=false',
          'commit',
          // `--allow-empty`: a message can change on a commit that has no files of its own.
          ...(amend ? [ '--amend', '--reset-author', '--allow-empty' ] : []),
          '--cleanup=whitespace',
          '--no-edit',
          '-F',
          '-'
        ],
        {
          stdin: request.message,
          timeoutMs: this.options.gitTimeoutMs,
          // These beat every git configuration, including the working copy's (CA-2).
          env: {
            GIT_AUTHOR_NAME: name,
            GIT_AUTHOR_EMAIL: email,
            GIT_COMMITTER_NAME: name,
            GIT_COMMITTER_EMAIL: email
          }
        }
      );
    } catch (error) {
      await this.undoCommit(workingCopy, emptyIndex, unbornHead, error);
      throw error;
    }
    const head = await this.local.run(workingCopy, [ 'rev-parse', 'HEAD' ]);
    if (head.exitCode !== 0) {
      throw new Error(`git rev-parse failed: ${head.stderr.trim()}`);
    }
    return { oid: head.stdout.trim() };
  }

  /**
   * Discards the changes to the listed paths (GA-23): a modified or deleted file
   * comes back from the last commit, and an added one is deleted, as a symbolic
   * link and not what it points to. A path that is not a change is skipped, and
   * folders stay. The caller has checked the paths and holds the working-tree
   * lock, so that the states cannot change meanwhile. `changing` is called once,
   * just before the first change, so that a caller knows what a failure left.
   *
   * @throws GitOperationError `discard-blocked`, before anything has changed,
   *   when restoring a deleted file would replace a file or folder that is not
   *   being discarded: git would remove it without asking.
   * @throws PathRefusedError `malformed`, before anything has changed, for a
   *   name that is not valid UTF-8: status cannot say it, so git cannot be told it.
   */
  async discard(workingCopy: string, paths: string[], changing?: () => void): Promise<void> {
    const { changes } = await this.status(workingCopy);
    const listed = new Set(paths);
    const chosen = changes.filter(change => listed.has(change.path));
    if (chosen.length === 0) {
      return;
    }
    if (chosen.some(change => change.path.includes(UNDECODABLE))) {
      throw new PathRefusedError('malformed');
    }
    const added = chosen.filter(change => change.state === 'added').map(change => change.path);
    const tracked = chosen.filter(change => change.state !== 'added').map(change => change.path);
    const deleted = chosen.filter(change => change.state === 'deleted').map(change => change.path);
    await this.assertNothingInTheWay(workingCopy, deleted, new Set(added));
    changing?.();
    const onStdin = (list: string[]) => ({ stdin: nulTerminated(list), timeoutMs: this.options.gitTimeoutMs });
    try {
      if (added.length > 0) {
        await inBatches(added, path => this.deleteAdded(workingCopy, path));
        // Takes exact names: `git rm --cached docs` would also mean the files in a folder `docs`.
        await this.local.checked(workingCopy, [ 'update-index', '--force-remove', '-z', '--stdin' ], onStdin(added));
      }
      // Added files first: one may stand where a deleted file comes back.
      if (tracked.length > 0) {
        await this.local.checked(
          workingCopy,
          [
            '--literal-pathspecs',
            'restore',
            '--source=HEAD',
            '--staged',
            '--worktree',
            '--pathspec-from-file=-',
            '--pathspec-file-nul'
          ],
          onStdin(tracked)
        );
      }
    } catch (error) {
      await this.local.removeStaleIndexLock(workingCopy, error);
      throw error;
    }
  }

  /**
   * Deletes an added file, as the entry it is; one that is already gone is fine.
   * A folder stays: a staged submodule's, or one that replaced a staged file, whose
   * files are changes of their own.
   */
  private async deleteAdded(workingCopy: string, path: string): Promise<void> {
    try {
      const { absolute, type } = await resolveInWorkingCopy(workingCopy, path, { symlinkLeaf: true });
      if (type !== 'folder') {
        await unlink(absolute);
      }
    } catch (error) {
      const missing = error instanceof PathRefusedError && error.reason === 'not-found';
      if (!missing && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Refuses when a deleted file cannot come back without replacing something
   * other than the added files being discarded: a file where a folder on the way
   * to it must be, or a folder holding other files where it must be. `git
   * restore` would remove them without asking, and they may be changes the user
   * did not select, or ignored files. Each folder on the way is looked at once.
   */
  private async assertNothingInTheWay(workingCopy: string, deleted: string[], added: Set<string>): Promise<void> {
    const entries = new Map<string, ReturnType<typeof lstatOrMissing>>();
    const entryAt = (path: string) => {
      let entry = entries.get(path);
      if (entry === undefined) {
        entry = lstatOrMissing(join(workingCopy, path));
        entries.set(path, entry);
      }
      return entry;
    };
    const holdsOthers = async (folder: string) => {
      const inside = await readdir(join(workingCopy, folder), { recursive: true, withFileTypes: true });
      return inside.some(entry =>
        !entry.isDirectory()
        && !added.has(relative(workingCopy, join(entry.parentPath, entry.name)).split(sep).join('/'))
      );
    };
    const isBlocked = async (path: string) => {
      const segments = path.split('/');
      for (let depth = 1; depth < segments.length; depth++) {
        const parent = segments.slice(0, depth).join('/');
        const entry = await entryAt(parent);
        if (entry?.isDirectory() !== true) {
          return entry !== undefined && !added.has(parent);
        }
      }
      const leaf = await lstatOrMissing(join(workingCopy, path));
      return leaf?.isDirectory() === true && await holdsOthers(path);
    };
    await inBatches(deleted, async path => {
      if (await isBlocked(path)) {
        throw new GitOperationError('discard-blocked', `Something stands where ${path} goes.`);
      }
    });
  }

  /**
   * The submodule (gitlink) that `path` is or lies inside, or `null`. Asks git
   * once, for the entries directly inside each folder on the path.
   */
  async submoduleOn(workingCopy: string, path: string): Promise<string | null> {
    if (path === '') {
      return null;
    }
    const segments = path.split('/');
    const folders = segments.map((_, index) => segments.slice(0, index).join('/'));
    const result = await this.local.run(workingCopy, [
      'ls-files',
      '--stage',
      '-z',
      '--',
      ...folders.map(folder => `:(glob)${escapeGlob(folder === '' ? '' : `${folder}/`)}*`)
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
    }
    const gitlinks = new Set<string>();
    for (const line of result.stdout.split('\0')) {
      const tab = line.indexOf('\t');
      if (tab > 0 && line.startsWith(`${GITLINK_MODE} `)) {
        gitlinks.add(line.slice(tab + 1));
      }
    }
    for (let index = 1; index <= segments.length; index++) {
      const prefix = segments.slice(0, index).join('/');
      if (gitlinks.has(prefix)) {
        return prefix;
      }
    }
    return null;
  }

  /** True when a submodule (gitlink) of the index lies anywhere inside `folder`, not `''`. */
  async holdsSubmodule(workingCopy: string, folder: string): Promise<boolean> {
    const result = await this.local.run(workingCopy, [ 'ls-files', '--stage', '-z', '--', `:(literal)${folder}/` ]);
    if (result.exitCode !== 0) {
      throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
    }
    // The pathspec also matches a gitlink at `folder` itself: only those strictly inside count.
    return result.stdout.split('\0').some(line =>
      line.startsWith(`${GITLINK_MODE} `) && line.slice(line.indexOf('\t') + 1).startsWith(`${folder}/`)
    );
  }

  /** True while a merge or rebase is in progress in the working copy (FB-26). */
  async mergeInProgress(workingCopy: string): Promise<boolean> {
    const found = await Promise.all(
      IN_PROGRESS_MARKERS.map(marker => access(join(workingCopy, '.git', marker)).then(() => true, () => false))
    );
    return found.includes(true);
  }

  /**
   * Pushes the current branch to its upstream on `origin`, or publishes it
   * under its own name and makes that its upstream; never forced, without tags
   * (GA-29, GA-30). In a single-branch clone, a published branch is added to
   * what is fetched (GA-41). Takes no lock: the caller holds the NetworkLock.
   *
   * @throws GitOperationError `unsafe-repository-config` when `origin` is not
   * the stored remote, and push-* codes with `remoteMessages` when the remote
   * refuses (GA-31, RC-5).
   */
  async push(workingCopy: string, request: PushRequest): Promise<PushResult> {
    const { branch } = request;
    // Before anything is written; runNetwork checks again, as for every network command.
    await this.assertSafeWorkingCopy(workingCopy, request.remoteUrl);
    const source = `refs/heads/${branch}`;
    const target = await this.local.upstreamOf(workingCopy, branch);
    const commits = await this.commitsToPush(workingCopy, source, target);
    const addedRefspec = target === null && request.singleBranch
      ? await this.fetchAlso(workingCopy, branch)
      : undefined;
    const destination = target ?? source;
    try {
      await this.runNetwork(
        'push',
        request.remoteUrl,
        request.credentials,
        request.knownHosts,
        () => [
          'push',
          '--porcelain',
          '--no-follow-tags',
          '--no-recurse-submodules',
          ...(target === null ? [ '--set-upstream' ] : []),
          'origin',
          // Full names: a branch named like an option stays a ref, and nothing is forced.
          `${source}:${destination}`
        ],
        this.options.gitTimeoutMs,
        { cwd: workingCopy, push: true, params: { branch } }
      );
    } catch (error) {
      if (addedRefspec !== undefined) {
        // A failed push leaves the working copy as it was (GA-43).
        await this.local.checked(workingCopy, [
          'config',
          '--unset',
          '--fixed-value',
          'remote.origin.fetch',
          addedRefspec
        ])
          // The push's failure is what the user needs to hear about.
          .catch((undo: unknown) =>
            this.logger.warn(`Could not remove the fetch refspec ${addedRefspec}: ${String(undo)}`)
          );
      }
      throw error;
    }
    return { commits, upstream: `origin/${destination.slice('refs/heads/'.length)}` };
  }

  /** What the remote-tracking branch of `target` lacks, or what no remote branch has. */
  private async commitsToPush(workingCopy: string, source: string, target: string | null): Promise<number> {
    const count = (not: string[]) =>
      this.local.run(workingCopy, [ 'rev-list', '--count', source, '--not', ...not, '--' ], {
        timeoutMs: this.options.gitTimeoutMs
      });
    let result = target === null
      ? undefined
      : await count([ `refs/remotes/origin/${target.slice('refs/heads/'.length)}` ]);
    if (result === undefined || result.exitCode !== 0) {
      // Unpublished, or its remote-tracking branch is gone.
      result = await count([ '--remotes' ]);
    }
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new Error(`git rev-list failed: ${result.stderr.trim()}`);
    }
    return Number.parseInt(result.stdout.trim(), 10);
  }

  /**
   * Adds the branch to what a single-branch clone fetches, so that its upstream
   * ref exists (GA-41). Returns the refspec when it added it.
   */
  private async fetchAlso(workingCopy: string, branch: string): Promise<string | undefined> {
    const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
    if ((await this.local.configValues(workingCopy, 'remote.origin.fetch')).includes(refspec)) {
      return undefined;
    }
    await this.local.checked(workingCopy, [ 'config', '--add', 'remote.origin.fetch', refspec ]);
    return refspec;
  }

  /**
   * Refuses a working copy whose config could bypass the egress proxy, or
   * whose `origin` has any URL but the stored remote: git pushes to every URL
   * of a remote, and the broker's credentials are for the stored one (A-5.7).
   */
  private async assertSafeWorkingCopy(cwd: string, remoteUrl: string): Promise<void> {
    await this.assertSafeConfig(cwd);
    const urls = await this.local.configValues(cwd, 'remote.origin.url');
    if (urls.length !== 1 || urls[0] !== remoteUrl) {
      throw new GitOperationError('unsafe-repository-config', 'origin is not the repository\'s remote alone.');
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.runner.killAll();
  }

  private async assertSafeConfig(cwd: string): Promise<void> {
    try {
      await assertSafeRepositoryConfig(this.runner, cwd);
    } catch (error) {
      if (error instanceof UnsafeRepositoryConfigError) {
        throw new GitOperationError('unsafe-repository-config', error.message);
      }
      throw error;
    }
  }

  /**
   * The index entries directly inside `folder`, by name, with their modes.
   * Lists only that folder's entries: the glob's `*` does not cross `/` (FB-15).
   */
  private async indexEntriesIn(workingCopy: string, folder: string): Promise<Map<string, string>> {
    const prefix = folder === '' ? '' : `${folder}/`;
    const result = await this.local.run(workingCopy, [
      'ls-files',
      '--stage',
      '-z',
      '--',
      `:(glob)${escapeGlob(prefix)}*`
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
    }
    const entries = new Map<string, string>();
    // -z: "<mode> <object> <stage>\t<path>\0" per entry; a conflict has one per stage.
    for (const line of result.stdout.split('\0')) {
      const tab = line.indexOf('\t');
      if (tab > 0) {
        entries.set(line.slice(tab + 1 + prefix.length), line.slice(0, line.indexOf(' ')));
      }
    }
    return entries;
  }

  /**
   * The diff text of one file: against the last commit, or, for an added file,
   * against nothing (`--no-index`, where exit code 1 means "differs"), with
   * how many bytes git wrote.
   */
  private async runDiff(
    workingCopy: string,
    path: string,
    added: boolean,
    extra: string[],
    maxOutputBytes: number
  ): Promise<{ text: string; bytes: number; }> {
    const args = added
      ? [ ...DIFF_GLOBALS, 'diff', '--no-index', ...DIFF_FLAGS, ...extra, '--', '/dev/null', path ]
      : [ ...DIFF_GLOBALS, '--literal-pathspecs', 'diff', ...DIFF_FLAGS, ...extra, 'HEAD', '--', path ];
    const result = await this.local.run(workingCopy, args, { timeoutMs: this.options.gitTimeoutMs, maxOutputBytes });
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    // With --no-index, 1 means "differs", but it is also how an error ends.
    const differs = added && result.exitCode === 1 && result.stdoutBytes > 0;
    if (result.exitCode !== 0 && !differs) {
      throw new Error(`git diff failed: ${result.stderr.trim()}`);
    }
    return { text: result.stdout, bytes: result.stdoutBytes };
  }

  /** True when the file's only change is its line endings (GA-16), for a diff without every line. */
  private async differsOnlyInLineEndings(workingCopy: string, path: string): Promise<boolean> {
    const result = await this.local.run(
      workingCopy,
      [
        ...DIFF_GLOBALS,
        '--literal-pathspecs',
        'diff',
        ...DIFF_FLAGS,
        '--ignore-cr-at-eol',
        '--quiet',
        'HEAD',
        '--',
        path
      ],
      { timeoutMs: this.options.gitTimeoutMs }
    );
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    // --quiet: 0 for no difference, 1 for a difference.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`git diff failed: ${result.stderr.trim()}`);
    }
    return result.exitCode === 0;
  }

  /**
   * The size in bytes of the file in the last commit, or `null` when the last
   * commit does not have it, as for a file of the other side of a merge.
   */
  private async committedSize(workingCopy: string, path: string): Promise<number | null> {
    const result = await this.local.run(workingCopy, [ 'cat-file', '-s', `HEAD:${path}` ]);
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode === 0) {
      return Number(result.stdout.trim());
    }
    if (/does not exist in 'HEAD'|exists on disk, but not in 'HEAD'/.test(result.stderr)) {
      return null;
    }
    throw new Error(`git cat-file failed: ${result.stderr.trim()}`);
  }

  /** The ref HEAD names, for example `refs/heads/trunk`. */
  private async symbolicHead(workingCopy: string): Promise<string> {
    const result = await this.local.run(workingCopy, [ 'symbolic-ref', 'HEAD' ]);
    if (result.exitCode !== 0) {
      throw new Error(`git symbolic-ref failed: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  /**
   * Leaves the working copy as it was before a failed commit (GA-43): nothing
   * staged, and HEAD naming what it named.
   */
  private async undoCommit(
    workingCopy: string,
    emptyIndex: string[],
    unbornHead: string | undefined,
    failure: unknown
  ): Promise<void> {
    try {
      await this.local.removeStaleIndexLock(workingCopy, failure);
      await this.local.checked(workingCopy, emptyIndex);
      if (unbornHead !== undefined) {
        await this.local.checked(workingCopy, [ 'symbolic-ref', 'HEAD', unbornHead ]);
      }
    } catch (error) {
      this.logger.warn(`Could not undo a failed commit in ${workingCopy}: ${(error as Error).message}`);
    }
  }

  private async runNetwork(
    operation: string,
    remoteUrl: string,
    credentials: GitCredentials,
    userKnownHosts: string[],
    args: (remote: string) => string[],
    timeoutMs: number,
    { params = {}, cwd, push = false }: NetworkRunOptions = {}
  ): Promise<GitResult> {
    const parsed = parseRemoteUrl(remoteUrl);
    if (!parsed.ok) {
      throw new GitOperationError('failed', 'The remote URL is not a supported HTTPS or SSH URL.');
    }
    const remote: ParsedRemote = parsed.remote;
    if (credentials.kind !== 'none' && credentials.kind !== remote.protocol) {
      throw new GitOperationError(
        'failed',
        `${credentials.kind} credentials cannot be used with an ${remote.protocol} remote.`
      );
    }
    if (cwd !== undefined) {
      await this.assertSafeWorkingCopy(cwd, remoteUrl);
    }
    const knownHosts = [ ...this.options.knownHosts, ...userKnownHosts ];
    let broker: Broker | undefined;
    let failure: GitOperationError;
    try {
      broker = await openBroker({ remote, credentials, gitOptions: this.options, knownHosts });
      const result = await this.runner.run(args(remoteUrl), { env: broker.env, timeoutMs, cwd });
      if (result.exitCode === 0) {
        return result;
      }
      const pushed = push ? classifyPushFailure(result, broker.egress.refusals) : undefined;
      let code = pushed?.code ?? classifyGitFailure(result, broker.egress.refusals);
      // ssh calls a key of a type it does not know "unknown", even when it knows another key of this host.
      if (code === 'host-key-unknown' && hasHostEntry(knownHosts, { host: remote.host, port: remote.port ?? 22 })) {
        code = 'host-key-changed';
      }
      // The URL has no credentials: parseRemoteUrl refuses them (NF-10.5).
      this.logger.debug(`git ${operation} of ${remoteUrl} failed with ${code}: ${result.stderr.trim()}`);
      // `--porcelain` writes each ref's status to stdout.
      const detail = push ? `${redactCredentials(result.stdout)}${result.stderr}` : result.stderr;
      failure = new GitOperationError(code, detail, {
        host: remote.host,
        ...params,
        ...(pushed?.remoteMessages ? { remoteMessages: pushed.remoteMessages } : {})
      });
    } finally {
      await broker?.close();
    }
    if (failure.code === 'host-key-changed') {
      throw await this.describeChangedHostKey(failure, knownHosts, { host: remote.host, port: remote.port ?? 22 });
    }
    if (failure.code === 'host-key-unknown') {
      // AR-32: the user decides whether to trust the key `ssh` was shown.
      const { host, port, type, key, fingerprint } = await probeHostKey(
        { host: remote.host, port: remote.port ?? 22 },
        this.options.egress
      );
      throw new GitOperationError('host-key-unknown', failure.detail, {
        ...failure.params,
        host,
        port: String(port),
        type,
        key,
        fingerprint
      });
    }
    throw failure;
  }

  /**
   * A changed host key with the key that was trusted and, when the probe
   * reaches the server, the new one (RC-21). Of the trusted keys, the one of
   * the new key's type if there is one, and the user's own before the
   * instance's, as the user's lines come last.
   */
  private async describeChangedHostKey(
    failure: GitOperationError,
    knownHosts: string[],
    target: { host: string; port: number; }
  ): Promise<GitOperationError> {
    const trusted = trustedKeysFor(knownHosts, target);
    let probed: HostKey | undefined;
    try {
      probed = await probeHostKey(target, this.options.egress, undefined, trusted.map(({ type }) => type));
    } catch (error) {
      // The server went away: the change is still reported, without a key to trust.
      this.logger.debug(`Host key probe of ${target.host}:${target.port} failed: ${(error as Error).message}`);
    }
    const sameType = trusted.filter(({ type }) => type === probed?.type);
    const shown = sameType.at(-1) ?? trusted.at(-1);
    return new GitOperationError('host-key-changed', failure.detail, {
      ...failure.params,
      host: target.host,
      port: String(target.port),
      ...(probed ? { type: probed.type, key: probed.key, fingerprint: probed.fingerprint } : {}),
      ...(shown ? { trustedType: shown.type, trustedFingerprint: shown.fingerprint } : {})
    });
  }
}
