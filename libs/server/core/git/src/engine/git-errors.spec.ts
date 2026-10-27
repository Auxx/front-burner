import type { EgressRefusal } from '../egress/egress-proxy';
import type { GitResult } from '../runner/git-runner';
import { classifyGitFailure, GitOperationError } from './git-errors';

const failed = (stderr: string, timedOut = false): GitResult => ({
  exitCode: timedOut ? null : 128,
  stdout: '',
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
