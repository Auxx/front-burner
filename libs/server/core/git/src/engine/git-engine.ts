import type { CloneMode } from '@front-burner/shared-contracts';
import { ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { access, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Broker, GitCredentials, openBroker } from '../broker/broker';
import { assertSafeRepositoryConfig, UnsafeRepositoryConfigError } from '../config/repository-config';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult, GitRunner } from '../runner/git-runner';
import { probeHostKey } from '../ssh/host-key-probe';
import { hasHostEntry } from '../ssh/known-hosts';
import { FileDiff, parseUnifiedDiff } from './git-diff';
import { classifyGitFailure, GitOperationError } from './git-errors';
import { parseStatus, WorkingCopyStatus } from './git-status';

/** AR-42. */
const ACCESS_CHECK_TIMEOUT_MS = 30_000;

/** Submodules are not cloned by `--no-recurse-submodules`; these keep LFS from fetching (AR-50). */
const NO_LFS = [ '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false' ];

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

export interface CommitRequest {
  /** Checked by the caller (A-7.6); duplicates and paths that are not changes are ignored. */
  paths: string[];
  /** As the user wrote it; git removes trailing spaces and trailing blank lines (GA-21). */
  message: string;
  /** Recorded as author and committer (CA-2). */
  author: { name: string; email: string; };
}

interface LocalRunOptions {
  stdin?: string;
  env?: Record<string, string>;
  /** `FRONT_BURNER_GIT_TIMEOUT` for commands that read whole files, such as `git add` (NF-11.8). */
  timeoutMs?: number;
  /** Per stream; default `LOCAL_MAX_OUTPUT_BYTES`. */
  maxOutputBytes?: number;
}

/** GA-16: a diff larger than this, with 3 lines of context, is not shown. */
const DIFF_LIMIT_BYTES = 1_000_000;

/** Neither the repository's configuration nor its `.gitattributes` choose how a diff is made. */
const DIFF_FLAGS = [ '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames' ];

/** More lines of context than any file has: the whole file. */
const WHOLE_FILE_CONTEXT = '--unified=2147483647';

/** A file's diff without changed lines. */
const NO_DIFF: FileDiff = { kind: 'text', lines: [], complete: true, lineEndingsOnly: false };

/** The entry's size without following a link, or `null` when it is missing. */
async function sizeOnDisk(path: string): Promise<number | null> {
  try {
    return (await lstat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Commands that read only the working copy and its index. */
const LOCAL_TIMEOUT_MS = 10_000;

/** Enough for the names of a folder of a few hundred thousand entries; output past it would be lost. */
const LOCAL_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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

  constructor(@Inject(GIT_OPTIONS) private readonly options: GitOptions, private readonly runner: GitRunner) {}

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
        request.branch === undefined ? {} : { branch: request.branch }
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
    const result = await this.runLocal(
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
    const result = await this.runLocal(workingCopy, [
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
    const result = await this.runLocal(workingCopy, [
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
    return this.statusUnder(workingCopy, []);
  }

  /**
   * One changed file's difference from the last commit, as parsed lines, or
   * that it is binary or too large (GA-14 to GA-16). A file small enough gets
   * the whole file as context, so that every fold can be opened; a file that
   * is not changed has no lines. Never writes the index (A-5.3).
   */
  async diff(workingCopy: string, path: string): Promise<FileDiff> {
    const status = await this.statusUnder(workingCopy, [ '--', `:(literal)${path}` ]);
    const change = status.changes.find(entry => entry.path === path);
    if (change === undefined) {
      return NO_DIFF;
    }
    const added = change.state === 'added';
    const [ oldSize, newSize ] = await Promise.all([
      added ? null : this.committedSize(workingCopy, path),
      change.state === 'deleted' ? null : sizeOnDisk(join(workingCopy, path))
    ]);
    if (added && newSize === null) {
      // Added to the index, then deleted: nothing to compare.
      return NO_DIFF;
    }
    // An added file is compared with nothing: before the first commit there is no HEAD.
    const run = (extra: string[], maxOutputBytes: number) =>
      this.runDiff(workingCopy, path, added, extra, maxOutputBytes);

    const short = await run([], DIFF_LIMIT_BYTES + 1);
    if (Buffer.byteLength(short) > DIFF_LIMIT_BYTES) {
      return { kind: 'too-large' };
    }
    const headers = short.split('\n@@ ')[0]?.split('\n') ?? [];
    if (headers.some(line => line.startsWith('Binary files '))) {
      return { kind: 'binary', oldSize, newSize };
    }
    const complete = (oldSize ?? 0) + (newSize ?? 0) <= DIFF_LIMIT_BYTES;
    // The whole file is at most its two versions plus a prefix per line.
    const lines = parseUnifiedDiff(complete ? await run([ WHOLE_FILE_CONTEXT ], 4 * DIFF_LIMIT_BYTES) : short);
    const lineEndingsOnly = change.state === 'modified' && lines.some(line => line.type !== 'context')
      && await this.differsOnlyInLineEndings(workingCopy, path);
    return { kind: 'text', lines, complete, lineEndingsOnly };
  }

  /** `git status` of the entries a pathspec names (`[]` for all), as `status` reads it. */
  private async statusUnder(workingCopy: string, pathspec: string[]): Promise<WorkingCopyStatus> {
    const result = await this.runLocal(workingCopy, [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--ignored=no',
      ...pathspec
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`git status failed: ${result.stderr.trim()}`);
    }
    return parseStatus(result.stdout);
  }

  /**
   * Commits exactly the listed paths, as they are on disk, with their additions
   * and deletions, as `author` (GA-19, CA-2). Paths that are not changes are
   * ignored. Anything else in the index is left out, and on failure the index
   * is emptied again, so that the working copy is as it was (GA-43). The
   * caller has checked the paths and holds the working-tree lock.
   *
   * @throws GitOperationError `nothing-to-commit` when no path is a change.
   */
  async commit(workingCopy: string, request: CommitRequest): Promise<{ oid: string; }> {
    const status = await this.status(workingCopy);
    if (status.branch === null) {
      // A commit on no branch is lost after the next switch (plan 52's review).
      throw new GitOperationError('detached-head', 'HEAD is not on a branch.');
    }
    const changed = new Set(status.changes.map(change => change.path));
    const paths = [ ...new Set(request.paths) ].filter(path => changed.has(path));
    if (paths.length === 0) {
      throw new GitOperationError('nothing-to-commit', 'None of the paths is a change.');
    }
    const emptyIndex = status.noCommits ? [ 'read-tree', '--empty' ] : [ 'reset', '-q' ];
    // With no commits, HEAD may name any branch; it is put back if the commit fails (GA-43).
    const unbornHead = status.noCommits ? await this.symbolicHead(workingCopy) : undefined;
    try {
      await this.runChecked(workingCopy, emptyIndex);
      if (unbornHead !== undefined) {
        // GA-42: whatever HEAD names in a new repository, the first commit makes `main`.
        await this.runChecked(workingCopy, [ 'symbolic-ref', 'HEAD', 'refs/heads/main' ]);
      }
      await this.runChecked(
        workingCopy,
        [ '--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul' ],
        { stdin: paths.map(path => `${path}\0`).join(''), timeoutMs: this.options.gitTimeoutMs }
      );
      const { name, email } = request.author;
      await this.runChecked(
        workingCopy,
        [ '-c', 'commit.gpgsign=false', 'commit', '--cleanup=whitespace', '--no-edit', '-F', '-' ],
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
    const head = await this.runLocal(workingCopy, [ 'rev-parse', 'HEAD' ]);
    if (head.exitCode !== 0) {
      throw new Error(`git rev-parse failed: ${head.stderr.trim()}`);
    }
    return { oid: head.stdout.trim() };
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
    const result = await this.runLocal(workingCopy, [
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
    const result = await this.runLocal(workingCopy, [ 'ls-files', '--stage', '-z', '--', `:(literal)${folder}/` ]);
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
    const result = await this.runLocal(workingCopy, [
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
   * against nothing (`--no-index`, where exit code 1 means "differs").
   */
  private async runDiff(
    workingCopy: string,
    path: string,
    added: boolean,
    extra: string[],
    maxOutputBytes: number
  ): Promise<string> {
    const args = added
      ? [ '--no-optional-locks', 'diff', '--no-index', ...DIFF_FLAGS, ...extra, '--', '/dev/null', path ]
      : [ '--no-optional-locks', '--literal-pathspecs', 'diff', ...DIFF_FLAGS, ...extra, 'HEAD', '--', path ];
    const result = await this.runLocal(workingCopy, args, { timeoutMs: this.options.gitTimeoutMs, maxOutputBytes });
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0 && !(added && result.exitCode === 1)) {
      throw new Error(`git diff failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
  }

  /** True when the file's only change is its line endings (GA-16). */
  private async differsOnlyInLineEndings(workingCopy: string, path: string): Promise<boolean> {
    const result = await this.runLocal(
      workingCopy,
      [
        '--no-optional-locks',
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
    // --quiet: 0 for no difference, 1 for a difference.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`git diff failed: ${result.stderr.trim()}`);
    }
    return result.exitCode === 0;
  }

  /** The size in bytes of the file in the last commit, or `null` when it has none. */
  private async committedSize(workingCopy: string, path: string): Promise<number | null> {
    const result = await this.runLocal(workingCopy, [ 'cat-file', '-s', `HEAD:${path}` ]);
    return result.exitCode === 0 ? Number(result.stdout.trim()) : null;
  }

  /** The ref HEAD names, for example `refs/heads/trunk`. */
  private async symbolicHead(workingCopy: string): Promise<string> {
    const result = await this.runLocal(workingCopy, [ 'symbolic-ref', 'HEAD' ]);
    if (result.exitCode !== 0) {
      throw new Error(`git symbolic-ref failed: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  /**
   * Leaves the working copy as it was before a failed commit (GA-43): nothing
   * staged, and HEAD naming what it named. A git killed at its timeout cannot
   * remove its `index.lock`; the caller holds the working-tree lock, so no other
   * command of ours is using it, and it is removed.
   */
  private async undoCommit(
    workingCopy: string,
    emptyIndex: string[],
    unbornHead: string | undefined,
    failure: unknown
  ): Promise<void> {
    try {
      if (failure instanceof GitOperationError && failure.code === 'timeout') {
        await rm(join(workingCopy, '.git', 'index.lock'), { force: true });
      }
      await this.runChecked(workingCopy, emptyIndex);
      if (unbornHead !== undefined) {
        await this.runChecked(workingCopy, [ 'symbolic-ref', 'HEAD', unbornHead ]);
      }
    } catch (error) {
      this.logger.warn(`Could not undo a failed commit in ${workingCopy}: ${(error as Error).message}`);
    }
  }

  /**
   * A local command that must succeed.
   *
   * @throws GitOperationError `timeout` when it ran out of time.
   */
  private async runChecked(cwd: string, args: string[], options: LocalRunOptions = {}): Promise<void> {
    const result = await this.runLocal(cwd, args, options);
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    }
  }

  /** Runs with `LOCAL_TIMEOUT_MS` unless `options` says otherwise. */
  private runLocal(cwd: string, args: string[], options: LocalRunOptions = {}): Promise<GitResult> {
    return this.runner.run(args, {
      cwd,
      timeoutMs: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
      stdin: options.stdin,
      env: options.env,
      maxOutputBytes: options.maxOutputBytes ?? LOCAL_MAX_OUTPUT_BYTES
    });
  }

  private async runNetwork(
    operation: string,
    remoteUrl: string,
    credentials: GitCredentials,
    userKnownHosts: string[],
    args: (remote: string) => string[],
    timeoutMs: number,
    params: Record<string, string> = {}
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
    const knownHosts = [ ...this.options.knownHosts, ...userKnownHosts ];
    let broker: Broker | undefined;
    let failure: GitOperationError;
    try {
      broker = await openBroker({ remote, credentials, gitOptions: this.options, knownHosts });
      const result = await this.runner.run(args(remoteUrl), { env: broker.env, timeoutMs });
      if (result.exitCode === 0) {
        return result;
      }
      let code = classifyGitFailure(result, broker.egress.refusals);
      // ssh calls a key of a type it does not know "unknown", even when it knows another key of this host.
      if (code === 'host-key-unknown' && hasHostEntry(knownHosts, { host: remote.host, port: remote.port ?? 22 })) {
        code = 'host-key-changed';
      }
      // The URL has no credentials: parseRemoteUrl refuses them (NF-10.5).
      this.logger.debug(`git ${operation} of ${remoteUrl} failed with ${code}: ${result.stderr.trim()}`);
      failure = new GitOperationError(code, result.stderr, { host: remote.host, ...params });
    } finally {
      await broker?.close();
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
}
