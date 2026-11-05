import type { EgressRefusal } from '../egress/egress-proxy';
import type { GitResult } from '../runner/git-runner';
import { classifyGitFailure, classifyPushFailure, GitOperationError } from './git-errors';

const failed = (stderr: string, timedOut = false): GitResult => ({
  exitCode: timedOut ? null : 128,
  stdout: '',
  stdoutBytes: 0,
  stderr,
  timedOut
});

describe('classifyGitFailure', () => {
  it.each([
    [ 'fatal: unable to access \'https://h/r/\': SSL certificate problem: self-signed certificate', 'tls-untrusted' ],
    [
      'fatal: unable to access \'https://h/r/\': server certificate verification failed. CAfile: none',
      'tls-untrusted'
    ],
    [
      'fatal: unable to access \'https://h/r/\': SSL certificate OpenSSL verify result: self-signed certificate (18)',
      'tls-untrusted'
    ],
    [
      'fatal: unable to access \'https://h/r/\': SSL: no alternative certificate subject name matches target host name',
      'tls-untrusted'
    ],
    // Git built with GnuTLS, as in Debian.
    [
      'fatal: unable to access \'https://h/r/\': server verification failed: certificate signer not trusted. (CAfile: none)',
      'tls-untrusted'
    ],
    [ 'fatal: unable to access \'https://h/r/\': Could not resolve host: h', 'host-unreachable' ],
    [ 'fatal: unable to access \'https://h/r/\': Failed to connect to h port 443', 'host-unreachable' ],
    [ 'fatal: unable to access \'https://h/r/\': Connection refused', 'host-unreachable' ],
    [ 'fatal: unable to access \'https://h/r/\': Couldn\'t connect to server', 'host-unreachable' ],
    [ 'remote: Repository not found.\nfatal: repository \'https://h/r/\' not found', 'repository-not-found' ],
    [ 'fatal: repository \'https://h/r/\' not found', 'repository-not-found' ],
    [ 'fatal: unable to access \'https://h/r/\': The requested URL returned error: 404', 'repository-not-found' ],
    [ 'fatal: \'x\' does not appear to be a git repository', 'repository-not-found' ],
    [ 'fatal: Authentication failed for \'https://h/r/\'', 'auth-failed' ],
    [ 'fatal: could not read Username for \'https://h\': terminal prompts disabled', 'auth-failed' ],
    [ 'fatal: could not read Password for \'https://u@h\': No such device or address', 'auth-failed' ],
    [ 'fatal: unable to access \'https://h/r/\': The requested URL returned error: 403', 'auth-failed' ],
    [ 'fatal: unable to access \'https://h/r/\': The requested URL returned error: 401', 'auth-failed' ],
    [ 'remote: Invalid username or password.', 'auth-failed' ],
    [ 'remote: Invalid username or token.', 'auth-failed' ],
    [
      'warning: Could not find remote branch nope to clone.\nfatal: Remote branch nope not found in upstream origin',
      'branch-not-found'
    ],
    [ 'fatal: something else entirely', 'failed' ]
  ])('classifies %j as %s', (stderr, code) => {
    expect(classifyGitFailure(failed(stderr), [])).toBe(code);
  });

  it('puts a timeout first', () => {
    expect(classifyGitFailure(failed('fatal: Authentication failed', true), [ { host: 'h', reason: 'blocked' } ])).toBe(
      'timeout'
    );
  });

  it('reports any egress refusal as host-unreachable', () => {
    const refusals: EgressRefusal[] = [ { host: '169.254.169.254', reason: 'blocked' } ];

    expect(classifyGitFailure(failed('fatal: Authentication failed for \'https://h/r/\''), refusals)).toBe(
      'host-unreachable'
    );
  });
});

describe('GitOperationError', () => {
  it('carries the code, the detail and the parameters', () => {
    const error = new GitOperationError('host-unreachable', 'fatal: x', { host: 'h' });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('host-unreachable');
    expect(error.detail).toBe('fatal: x');
    expect(error.params).toEqual({ host: 'h' });
    expect(error.message).toContain('host-unreachable');
  });
});

describe('classifyGitFailure over SSH', () => {
  it.each([
    [
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n'
      + 'Host key for [127.0.0.1]:2222 has changed and you have requested strict checking.\nHost key verification failed.',
      'host-key-changed'
    ],
    [ 'Host key for git.example.com has changed and you have requested strict checking.', 'host-key-changed' ],
    [
      'No ED25519 host key is known for [127.0.0.1]:2222 and you have requested strict checking.\nHost key verification failed.\nfatal: Could not read from remote repository.',
      'host-key-unknown'
    ],
    [ 'Host key verification failed.\nfatal: Could not read from remote repository.', 'host-key-unknown' ],
    [ 'git@127.0.0.1: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'auth-failed' ],
    [
      'egress proxy refused the connection (code 2)\nConnection closed by UNKNOWN port 65535\nfatal: Could not read from remote repository.',
      'host-unreachable'
    ]
  ])('maps %j to %s', (stderr, code) => {
    expect(classifyGitFailure(failed(stderr), [])).toBe(code);
  });
});

describe('classifyPushFailure', () => {
  const pushed = (stderr: string, stdout = '', timedOut = false): GitResult => ({
    exitCode: timedOut ? null : 1,
    stdout,
    stdoutBytes: stdout.length,
    stderr,
    timedOut
  });
  const code = (stderr: string, stdout = '') => classifyPushFailure(pushed(stderr, stdout), []).code;
  const status = (reason: string) => `To https://h/r.git\n!\trefs/heads/main:refs/heads/main\t${reason}\nDone\n`;
  const failedToPush = 'error: failed to push some refs to \'https://h/r.git\'\n';

  it('recognises a non-fast-forward', () => {
    const hint = 'hint: Updates were rejected because the remote contains work that you do not\nhint: have locally.\n';

    expect(code(failedToPush + hint, status('[rejected] (fetch first)'))).toBe('push-non-fast-forward');
    expect(code(failedToPush, status('[rejected] (non-fast-forward)'))).toBe('push-non-fast-forward');
  });

  it.each([
    // GitHub, a token without write access over HTTPS.
    'remote: Permission to o/r.git denied to u.\nfatal: unable to access \'https://github.com/o/r.git/\': The requested URL returned error: 403\n',
    // GitHub, a read-only deploy key.
    'ERROR: The key you are authenticating with has been marked as read only.\nfatal: Could not read from remote repository.\n',
    // GitHub, an SSH user without write access.
    'ERROR: Permission to o/r.git denied to u.\nfatal: Could not read from remote repository.\n',
    // Bitbucket, a read-only access key.
    'repository access denied. access via a deployment key is read-only.\nfatal: Could not read from remote repository.\n',
    // Bitbucket, an app password or token without write access.
    'remote: You do not have write access to this repository.\nfatal: unable to access \'https://bitbucket.org/w/r.git/\': The requested URL returned error: 403\n',
    'You do not have write access to this repository.\nfatal: Could not read from remote repository.\n'
  ])('recognises GitHub\'s and Bitbucket\'s refusals of a read-only token and key: %j', stderr => {
    expect(code(stderr)).toBe('push-not-allowed');
  });

  it('recognises a protected branch', () => {
    const stderr = 'remote: error: GH006: Protected branch update failed for refs/heads/main.\n'
      + 'remote: error: Changes must be made through a pull request.\n' + failedToPush;

    expect(code(stderr, status('[remote rejected] (protected branch hook declined)'))).toBe('push-protected-branch');
  });

  it('recognises a refusal of unsigned commits', () => {
    // GitHub reports it through branch protection, and through rulesets.
    const protection = 'remote: error: GH006: Protected branch update failed for refs/heads/main.\n'
      + 'remote: error: Commits must have verified signatures.\n' + failedToPush;
    const ruleset = 'remote: error: GH013: Repository rule violations found for refs/heads/main.\n'
      + 'remote: - Commits must have verified signatures.\n' + failedToPush;

    expect(code(protection, status('[remote rejected] (protected branch hook declined)'))).toBe('push-unsigned');
    expect(code(ruleset, status('[remote rejected] (push declined due to repository rule violations)'))).toBe(
      'push-unsigned'
    );
  });

  it('recognises any other refusal by the remote', () => {
    expect(code('remote: Nope.\n' + failedToPush, status('[remote rejected] (pre-receive hook declined)'))).toBe(
      'push-rejected'
    );
    expect(code('remote: Nope.\n ! [remote rejected] main -> main (pre-receive hook declined)\n')).toBe(
      'push-rejected'
    );
  });

  it('collects the remote lines, without credentials and at most 64 KB', () => {
    const stderr = 'remote: First\r\nremote:\nremote: see https://u:token@h/x\nerror: failed\n';

    expect(classifyPushFailure(pushed(stderr), []).remoteMessages).toBe('First\n\nsee https://***@h/x');

    const long = classifyPushFailure(pushed(`remote: ${'é'.repeat(40_000)}\n`), []).remoteMessages;
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(64 * 1024);
    expect(long).toBe('é'.repeat(32 * 1024));
  });

  it('reads git\'s codes only from git\'s own lines', () => {
    const stderr = 'remote: ! [rejected] (fetch first)\nremote: The requested URL returned error: 403\n'
      + 'remote: protected branch\nremote: Authentication failed\n' + failedToPush;

    expect(code(stderr, status('[remote rejected] (pre-receive hook declined)'))).toBe('push-rejected');
    expect(code('remote: The requested URL returned error: 403\nfatal: the remote end hung up\n')).toBe('failed');
  });

  it('still reports a refused login as auth-failed', () => {
    expect(code('remote: Invalid username or password.\nfatal: Authentication failed for \'https://h/r.git/\'\n')).toBe(
      'auth-failed'
    );
    expect(code('git@h: Permission denied (publickey).\nfatal: Could not read from remote repository.\n')).toBe(
      'auth-failed'
    );
    expect(code('fatal: unable to access \'https://h/r/\': The requested URL returned error: 401\n')).toBe(
      'auth-failed'
    );
  });

  it('puts a timeout and an egress refusal first', () => {
    expect(classifyPushFailure(pushed(failedToPush, status('[rejected] (fetch first)'), true), []).code).toBe(
      'timeout'
    );
    expect(classifyPushFailure(pushed('fatal: x\n'), [ { host: 'h', reason: 'blocked' } ]).code).toBe(
      'host-unreachable'
    );
  });
});
