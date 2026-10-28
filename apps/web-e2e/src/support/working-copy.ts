import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * What a seeded repository's working copy holds:
 * - `empty`: one empty commit;
 * - `handbook`: `README.md`, `docs/guide.md`, `2-setup.md` and `10-deploy.md`
 *   (natural order), `.github/` and `.claude/`, a `.gitignore` with `build/` and
 *   `*.log` and an untracked `build/` and `debug.log` it ignores, a tracked
 *   `keep.log` that matches it, a symbolic link `latest` to `README.md`, a
 *   submodule `vendor` (not cloned, AR-50) and an image `logo.png`.
 */
export type WorkingCopyFixture = 'empty' | 'handbook';

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

/** The smallest valid PNG: one transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const HANDBOOK_FILES: Record<string, string | Buffer> = {
  'README.md': '# Handbook\n',
  'docs/guide.md': '# Guide\n',
  '2-setup.md': '# Setup\n',
  '10-deploy.md': '# Deploy\n',
  '.github/workflows/ci.yml': 'on: push\n',
  '.claude/skills/review.md': '# Review\n',
  '.gitignore': 'build/\n*.log\n',
  'keep.log': 'Tracked, although *.log matches it.\n',
  'logo.png': PNG
};

/** Creates the working copy of a seeded repository at `dir`, as a clone would have left it. */
export function createWorkingCopy(dir: string, fixture: WorkingCopyFixture): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: gitEnv });
  mkdirSync(dir, { recursive: true });
  git('init', '-q', '-b', 'main');
  if (fixture === 'empty') {
    git('commit', '-q', '--allow-empty', '-m', 'first');
    return;
  }

  for (const [ path, content ] of Object.entries(HANDBOOK_FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  symlinkSync('README.md', join(dir, 'latest'));
  git('add', '.');
  git('add', '-f', 'keep.log');
  // A gitlink without its content, as `--no-recurse-submodules` leaves it.
  mkdirSync(join(dir, 'vendor'));
  git('update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},vendor`);
  git('commit', '-q', '-m', 'handbook');

  // Untracked and ignored: shown in the ignored colour (FB-20a, FB-20b).
  mkdirSync(join(dir, 'build'));
  writeFileSync(join(dir, 'build/site.html'), '<p>Built</p>\n');
  writeFileSync(join(dir, 'debug.log'), 'Debugging\n');
}
