import type { CloneMode } from '@front-burner/shared-contracts';
import { ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Broker, GitCredentials, openBroker } from '../broker/broker';
import { assertSafeRepositoryConfig, UnsafeRepositoryConfigError } from '../config/repository-config';
import { GIT_OPTIONS, GitOptions } from '../git.options';
import { GitResult, GitRunner } from '../runner/git-runner';
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
}

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
  async accessCheck(remoteUrl: string, credentials: GitCredentials): Promise<AccessCheckResult> {
    const result = await this.runNetwork(
      'access check',
      remoteUrl,
      credentials,
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

  private async runNetwork(
    operation: string,
    remoteUrl: string,
    credentials: GitCredentials,
    args: (remote: string) => string[],
    timeoutMs: number,
    params: Record<string, string> = {}
  ): Promise<GitResult> {
    const parsed = parseRemoteUrl(remoteUrl);
    // SSH comes with plan 8.
    if (!parsed.ok || parsed.remote.protocol !== 'https') {
      throw new GitOperationError('failed', 'The remote URL is not a supported HTTPS URL.');
    }
    const remote: ParsedRemote = parsed.remote;
    let broker: Broker | undefined;
    try {
      broker = await openBroker({ remote, credentials, gitOptions: this.options });
      const result = await this.runner.run(args(remoteUrl), { env: broker.env, timeoutMs });
      if (result.exitCode === 0) {
        return result;
      }
      const code = classifyGitFailure(result, broker.egress.refusals);
      // The URL has no credentials: parseRemoteUrl refuses them (NF-10.5).
      this.logger.debug(`git ${operation} of ${remoteUrl} failed with ${code}: ${result.stderr.trim()}`);
      throw new GitOperationError(code, result.stderr, { host: remote.host, ...params });
    } finally {
      await broker?.close();
    }
  }
}
