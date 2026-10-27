import { GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { toAddRepositoryError } from './remote-errors';

const context = { host: 'git.example.com', credentialsMode: 'saved', generatedKey: false } as const;
const answer = (error: ApiErrorException) => ({
  status: error.getStatus(),
  code: error.code,
  params: error.params,
  fields: error.fields
});
const fail = (code: GitOperationError['code'], params: Record<string, string> = { host: 'git.example.com' }) =>
  answer(toAddRepositoryError(new GitOperationError(code, 'fatal: details', params), context));
const onField = (path: string, code: string, params: Record<string, unknown> = {}) => ({
  status: 400,
  code: 'validation-failed',
  params: {},
  fields: [ { path, code, params } ]
});

describe('toAddRepositoryError', () => {
  it('reports an unreachable host on the URL', () => {
    expect(fail('host-unreachable')).toEqual(onField('remoteUrl', 'host-unreachable', { host: 'git.example.com' }));
  });

  it('answers a timeout above the buttons', () => {
    expect(fail('timeout')).toEqual({
      status: 504,
      code: 'remote-timeout',
      params: { host: 'git.example.com' },
      fields: undefined
    });
  });

  it('reports an untrusted certificate on the URL', () => {
    expect(fail('tls-untrusted')).toEqual(onField('remoteUrl', 'tls-untrusted'));
  });

  it('reports refused credentials on the credentials', () => {
    expect(fail('auth-failed')).toEqual(onField('credentials', 'credentials-refused', { generatedKey: false }));
  });

  it('asks whether a generated key was added', () => {
    const error = toAddRepositoryError(new GitOperationError('auth-failed', ''), { ...context, generatedKey: true });
    expect(answer(error)).toEqual(onField('credentials', 'credentials-refused', { generatedKey: true }));
  });

  it('says a repository without credentials needs some', () => {
    const error = toAddRepositoryError(new GitOperationError('auth-failed', ''), {
      ...context,
      credentialsMode: 'none'
    });
    expect(answer(error)).toEqual(onField('credentials', 'credentials-required'));
  });

  it('reports a missing repository on the URL', () => {
    expect(fail('repository-not-found')).toEqual(onField('remoteUrl', 'repository-not-found'));
  });

  it('asks the user to trust an unknown host key', () => {
    const hostKey = {
      host: 'git.example.com',
      port: '2222',
      type: 'ssh-ed25519',
      key: 'AAAA',
      fingerprint: 'SHA256:x'
    };
    expect(fail('host-key-unknown', hostKey)).toEqual({
      status: 409,
      code: 'host-key-unknown',
      params: { ...hostKey, port: 2222 },
      fields: undefined
    });
  });

  it('reports a changed host key on the URL', () => {
    expect(fail('host-key-changed')).toEqual(onField('remoteUrl', 'host-key-changed', { host: 'git.example.com' }));
  });

  it('reports a missing branch on the branch', () => {
    expect(fail('branch-not-found', { host: 'git.example.com', branch: 'main' })).toEqual(
      onField('branch', 'branch-not-found')
    );
  });

  it.each([ 'failed', 'unsafe-repository-config' ] as const)('answers anything else above the buttons (%s)', code => {
    expect(fail(code)).toEqual({ status: 502, code: 'remote-failed', params: {}, fields: undefined });
  });

  it('never repeats git\'s output', () => {
    const error = toAddRepositoryError(new GitOperationError('failed', 'token ghp_secret'), context);
    expect(JSON.stringify(answer(error))).not.toContain('ghp_secret');
    expect(error.message).not.toContain('ghp_secret');
  });
});
