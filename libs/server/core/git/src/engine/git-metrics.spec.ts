import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from 'prom-client';
import type { GitOptions } from '../git.options';
import { GitRunner } from '../runner/git-runner';
import { GitEngine } from './git-engine';
import { GitOperationError } from './git-errors';
import { GIT_OPERATION_DURATION, GIT_OPERATIONS, GitMetrics } from './git-metrics';

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
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });

describe('GitMetrics', () => {
  let root: string;
  let registry: Registry;
  let options: GitOptions;

  /** How many times the operation was timed. */
  const countOf = async (operation: string): Promise<number | undefined> => {
    const metric = await registry.getSingleMetric(GIT_OPERATION_DURATION)?.get();
    const values = (metric?.values ?? []) as { labels: { operation?: string; }; value: number; metricName?: string; }[];
    return values.find(value =>
      value.metricName === `${GIT_OPERATION_DURATION}_count` && value.labels.operation === operation
    )?.value;
  };
  const engine = (overrides: Partial<GitOptions> = {}) => {
    const runner = new GitRunner();
    return new GitEngine({ ...options, ...overrides }, runner, undefined, new GitMetrics(registry));
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-git-metrics-'));
    git(root, 'init', '-q', '-b', 'main');
    writeFileSync(join(root, 'a.md'), 'one\n');
    git(root, 'add', 'a.md');
    git(root, 'commit', '-q', '-m', 'first');
    registry = new Registry();
    options = {
      helpersDir: join(__dirname, '../../helpers'),
      egress: { blockPrivateNetworks: false },
      cloneTimeoutMs: 60_000,
      gitTimeoutMs: 60_000,
      knownHosts: []
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('times a git operation by name', async () => {
    const timed = engine();

    await timed.status(root);
    await timed.status(root);
    writeFileSync(join(root, 'a.md'), 'two\n');
    await timed.commit(root, {
      paths: [ 'a.md' ],
      message: 'second',
      author: { name: 'Fixture', email: 'fixture@example.com' }
    });

    expect(await countOf('status')).toBe(2);
    // A commit reads the status itself: that is not a status operation.
    expect(await countOf('commit')).toBe(1);
    const text = await registry.metrics();
    expect(text).not.toContain(root);
  });

  it('a timed-out command is timed', async () => {
    writeFileSync(join(root, 'a.md'), 'changed\n');

    const failure = await engine({ gitTimeoutMs: 1 }).diff(root, 'a.md').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GitOperationError);
    expect((failure as GitOperationError).code).toBe('timeout');
    expect(await countOf('diff')).toBe(1);
  });

  it('labels operations from the fixed list only', async () => {
    const timed = engine();
    await timed.status(root);
    await timed.unsavedWork(root);

    const metric = await registry.getSingleMetric(GIT_OPERATION_DURATION)?.get();
    const operations = new Set(metric?.values.map(({ labels }) => labels['operation']));
    expect([ ...operations ].every(operation => (GIT_OPERATIONS as readonly unknown[]).includes(operation))).toBe(
      true
    );
  });
});
