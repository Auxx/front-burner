import { z } from 'zod';
import {
  AccessCheckRequestSchema,
  AccessCheckResultSchema,
  AddRepositoryRequestSchema,
  RemoteUrlSchema,
  RepositoryCredentialsSchema,
  RepositoryIndexSchema,
  RepositoryNameSchema
} from './add-repository.schema';

const codesOf = (result: z.ZodSafeParseResult<unknown>) =>
  result.success ? [] : result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    code: (issue as { params?: { code?: string; }; }).params?.code ?? issue.code
  }));

const https = {
  remoteUrl: 'https://github.com/acme/handbook.git',
  name: 'Handbook',
  credentials: { mode: 'none' },
  cloneMode: 'full'
} as const;
const ssh = {
  ...https,
  remoteUrl: 'git@github.com:acme/handbook.git',
  credentials: { mode: 'saved', credentialId: 3 }
};

describe('RemoteUrlSchema', () => {
  it.each([
    [ 'http://github.com/acme/handbook.git', 'unsupported' ],
    [ 'git://github.com/acme/handbook.git', 'unsupported' ],
    [ 'file:///srv/handbook.git', 'unsupported' ],
    [ '/srv/handbook.git', 'unsupported' ],
    [ 'https://alice:token@github.com/acme/handbook.git', 'credentials-in-url' ],
    [ '  ', 'required' ]
  ])('refuses http and local URLs with the parser\'s codes: %s', (url, code) => {
    expect(codesOf(RemoteUrlSchema.safeParse(url))).toEqual([ { path: '', code } ]);
  });

  it('trims the URL', () => {
    expect(RemoteUrlSchema.parse('  https://github.com/acme/handbook.git ')).toBe(
      'https://github.com/acme/handbook.git'
    );
  });
});

describe('RepositoryNameSchema', () => {
  it('trims the name', () => {
    expect(RepositoryNameSchema.parse('  Handbook ')).toBe('Handbook');
  });

  it('refuses a blank name and one over 100 characters', () => {
    expect(RepositoryNameSchema.safeParse('  ').success).toBe(false);
    expect(RepositoryNameSchema.safeParse('x'.repeat(100)).success).toBe(true);
    expect(RepositoryNameSchema.safeParse('x'.repeat(101)).success).toBe(false);
  });

  it('refuses a name with a control character', () => {
    expect(codesOf(RepositoryNameSchema.safeParse('Hand\u0007book'))).toEqual([
      { path: '', code: 'control-character' }
    ]);
  });
});

describe('RepositoryCredentialsSchema', () => {
  it('accepts each mode', () => {
    for (
      const credentials of [
        { mode: 'none' },
        { mode: 'saved', credentialId: 3 },
        { mode: 'saved', credentialId: 3, passphrase: ' secret ' },
        { mode: 'new-https', name: 'Work', username: 'alice', password: 'token' },
        { mode: 'new-ssh-key', name: 'Laptop', privateKey: 'key', passphrase: 'secret' }
      ]
    ) {
      expect(RepositoryCredentialsSchema.parse(credentials)).toEqual(credentials);
    }
  });

  it('refuses an unknown mode and a credential ID that is not a positive integer', () => {
    expect(RepositoryCredentialsSchema.safeParse({ mode: 'generated' }).success).toBe(false);
    expect(RepositoryCredentialsSchema.safeParse({ mode: 'saved', credentialId: 0 }).success).toBe(false);
    expect(RepositoryCredentialsSchema.safeParse({ mode: 'saved', credentialId: 1.5 }).success).toBe(false);
  });
});

describe('AddRepositoryRequestSchema', () => {
  it('accepts a public HTTPS repository', () => {
    expect(AddRepositoryRequestSchema.parse(https)).toEqual(https);
  });

  it('requires a branch for a single-branch clone', () => {
    expect(codesOf(AddRepositoryRequestSchema.safeParse({ ...https, cloneMode: 'single-branch' }))).toEqual([
      { path: 'branch', code: 'required' }
    ]);
    expect(AddRepositoryRequestSchema.safeParse({ ...https, cloneMode: 'single-branch', branch: 'main' }).success)
      .toBe(true);
  });

  it('refuses no credentials for an SSH URL', () => {
    expect(codesOf(AddRepositoryRequestSchema.safeParse({ ...ssh, credentials: { mode: 'none' } }))).toEqual([
      { path: 'credentials', code: 'protocol-mismatch' }
    ]);
  });

  it('refuses new HTTPS credentials for an SSH URL', () => {
    const credentials = { mode: 'new-https', name: 'Work', username: 'alice', password: 'token' };
    expect(codesOf(AddRepositoryRequestSchema.safeParse({ ...ssh, credentials }))).toEqual([
      { path: 'credentials', code: 'protocol-mismatch' }
    ]);
  });

  it('refuses a new SSH key for an HTTPS URL', () => {
    const credentials = { mode: 'new-ssh-key', name: 'Laptop', privateKey: 'key' };
    expect(codesOf(AddRepositoryRequestSchema.safeParse({ ...https, credentials }))).toEqual([
      { path: 'credentials', code: 'protocol-mismatch' }
    ]);
  });

  it('accepts a saved credential for either protocol', () => {
    expect(AddRepositoryRequestSchema.safeParse(ssh).success).toBe(true);
    expect(AddRepositoryRequestSchema.safeParse({ ...https, credentials: ssh.credentials }).success).toBe(true);
  });

  it('refuses an unknown level', () => {
    expect(AddRepositoryRequestSchema.safeParse({ ...https, gitLevel: 'expert' }).success).toBe(false);
    expect(AddRepositoryRequestSchema.parse({ ...https, gitLevel: 'simple' }).gitLevel).toBe('simple');
  });
});

describe('AccessCheckRequestSchema', () => {
  it('refuses no credentials for an SSH URL', () => {
    expect(codesOf(AccessCheckRequestSchema.safeParse({ remoteUrl: ssh.remoteUrl, credentials: { mode: 'none' } })))
      .toEqual([ { path: 'credentials', code: 'protocol-mismatch' } ]);
  });
});

describe('registry', () => {
  it.each(
    [
      [ RepositoryCredentialsSchema, 'RepositoryCredentials' ],
      [ AccessCheckRequestSchema, 'AccessCheckRequest' ],
      [ AccessCheckResultSchema, 'AccessCheckResult' ],
      [ AddRepositoryRequestSchema, 'AddRepositoryRequest' ],
      [ RepositoryIndexSchema, 'RepositoryIndex' ]
    ] as const
  )('registers %#', (schema, id) => {
    expect(z.globalRegistry.get(schema as z.ZodType)?.id).toBe(id);
  });
});
