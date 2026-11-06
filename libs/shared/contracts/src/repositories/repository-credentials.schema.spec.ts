import { z } from 'zod';
import { RepositoryCredentialsInfoSchema } from './repository-credentials.schema';

const key = {
  kind: 'ssh-key',
  id: 3,
  name: 'Laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:abc',
  passphraseProtected: true,
  unlocked: false,
  generated: false,
  missing: false,
  usedBy: 2
};

describe('RepositoryCredentialsInfoSchema', () => {
  it('parses an SSH key, HTTPS credentials and none', () => {
    expect(RepositoryCredentialsInfoSchema.parse({ protocol: 'ssh', inUse: key })).toEqual({
      protocol: 'ssh',
      inUse: key
    });
    const https = { kind: 'https', id: 4, name: 'Work', username: 'alice', missing: true, usedBy: 4 };
    expect(RepositoryCredentialsInfoSchema.parse({ protocol: 'https', inUse: https }).inUse).toEqual(https);
    expect(RepositoryCredentialsInfoSchema.parse({ protocol: 'https', inUse: null }).inUse).toBeNull();
  });

  it('drops a secret', () => {
    const parsed = RepositoryCredentialsInfoSchema.parse({
      protocol: 'ssh',
      inUse: { ...key, privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----', secret: 'fb1.x' }
    });

    expect(JSON.stringify(parsed)).not.toMatch(/privateKey|secret/);
  });

  it('refuses an unknown key type', () => {
    expect(RepositoryCredentialsInfoSchema.safeParse({ protocol: 'ssh', inUse: { ...key, keyType: 'dsa' } }).success)
      .toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(RepositoryCredentialsInfoSchema)?.id).toBe('RepositoryCredentialsInfo');
  });
});
