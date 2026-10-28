import type { CloneMode } from '@front-burner/shared-contracts';
import { ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { access, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Broker, GitCredentials, openBroker } from '../broker/broker';
import { assertSafeRepositoryConfig, UnsafeRepositoryConfigError } from '../config/repository-config';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult, GitRunner } from '../runner/git-runner';
import { probeHostKey } from '../ssh/host-key-probe';
import { hasHostEntry } from '../ssh/known-hosts';
import { classifyGitFailure, GitOperationError } from './git-errors';

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
      paths.map(path => `./${path}\0`).join('')
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

  private runLocal(cwd: string, args: string[], stdin?: string): Promise<GitResult> {
    return this.runner.run(args, { cwd, timeoutMs: LOCAL_TIMEOUT_MS, stdin, maxOutputBytes: LOCAL_MAX_OUTPUT_BYTES });
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
