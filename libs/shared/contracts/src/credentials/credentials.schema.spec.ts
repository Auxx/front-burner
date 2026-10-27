import { z } from 'zod';
import {
  CREDENTIALS_FIELD_CODES,
  GeneratedSshKeySchema,
  GenerateSshKeyRequestSchema,
  HostKeySchema,
  NewHttpsCredentialsSchema,
  NewSshKeySchema,
  SavedCredentialsSchema,
  SavedHttpsCredentialsSchema,
  SavedSshKeySchema,
  TrustHostRequestSchema,
  UnlockSshKeyRequestSchema
} from './credentials.schema';

const sshKey = {
  id: 2,
  name: 'Laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:abc',
  passphraseProtected: true,
  unlocked: false,
  generated: false,
  missing: false
} as const;

describe('NewHttpsCredentialsSchema', () => {
  it('trims names', () => {
    expect(NewHttpsCredentialsSchema.parse({ name: '  Work ', username: 'alice', password: 'p' }).name).toBe('Work');
  });

  it('does not trim a username or a password', () => {
    expect(NewHttpsCredentialsSchema.parse({ name: 'Work', username: ' alice ', password: ' p\n' })).toEqual({
      name: 'Work',
      username: ' alice ',
      password: ' p\n'
    });
  });

  it('refuses a blank name and one over 100 characters', () => {
    expect(NewHttpsCredentialsSchema.safeParse({ name: '  ', username: 'a', password: 'p' }).success).toBe(false);
    expect(NewHttpsCredentialsSchema.safeParse({ name: 'x'.repeat(101), username: 'a', password: 'p' }).success)
      .toBe(false);
  });

  it('refuses a password over 4096 characters', () => {
    expect(NewHttpsCredentialsSchema.safeParse({ name: 'W', username: 'a', password: 'p'.repeat(4097) }).success)
      .toBe(false);
  });
});

describe('NewSshKeySchema', () => {
  it('does not trim a passphrase', () => {
    expect(NewSshKeySchema.parse({ name: 'K', privateKey: 'key', passphrase: ' secret ' }).passphrase).toBe(' secret ');
  });

  it('refuses a private key over 16 KiB', () => {
    expect(NewSshKeySchema.safeParse({ name: 'K', privateKey: 'k'.repeat(16_384) }).success).toBe(true);
    expect(NewSshKeySchema.safeParse({ name: 'K', privateKey: 'k'.repeat(16_385) }).success).toBe(false);
  });
});

describe('UnlockSshKeyRequestSchema', () => {
  it('does not trim a passphrase and refuses an empty one', () => {
    expect(UnlockSshKeyRequestSchema.parse({ passphrase: ' a ' })).toEqual({ passphrase: ' a ' });
    expect(UnlockSshKeyRequestSchema.safeParse({ passphrase: '' }).success).toBe(false);
  });
});

describe('SavedCredentialsSchema', () => {
  it('parses a list without secrets', () => {
    const list = { https: [ { id: 1, name: 'Work', username: 'alice', missing: false } ], sshKeys: [ sshKey ] };
    expect(SavedCredentialsSchema.parse(list)).toEqual(list);
  });

  it('refuses an unknown key type', () => {
    expect(SavedSshKeySchema.safeParse({ ...sshKey, keyType: 'dsa' }).success).toBe(false);
  });
});

describe('TrustHostRequestSchema', () => {
  const host = { host: 'git.example.com', port: 22, type: 'ssh-ed25519', key: 'AAAA' };

  it('takes a host key without its fingerprint', () => {
    expect(TrustHostRequestSchema.parse({ ...host, fingerprint: 'SHA256:x' })).toEqual(host);
  });

  it('refuses a host name that is a pattern or a list', () => {
    for (
      const name of [ 'github.com,x', '*', '*.com', 'git?.example.com', '!a.io', '[a.io]:22', 'a.io b', 'a.io\nb', '' ]
    ) {
      expect(TrustHostRequestSchema.safeParse({ ...host, host: name }).success).toBe(false);
    }
    for (const name of [ 'git.example.com', 'GIT.example.com', '192.0.2.1', '2001:db8::1' ]) {
      expect(TrustHostRequestSchema.safeParse({ ...host, host: name }).success).toBe(true);
    }
  });

  it('refuses an unknown key type', () => {
    expect(TrustHostRequestSchema.safeParse({ ...host, type: 'ssh-dss' }).success).toBe(false);
    expect(TrustHostRequestSchema.safeParse({ ...host, type: 'ssh-ed25519\n@cert-authority' }).success).toBe(false);
  });

  it('refuses a key that is not base64', () => {
    for (const key of [ 'AAAA BBBB', 'AAAA\ngithub.com ssh-ed25519 BBBB', 'AA*A', 'AAAA=A' ]) {
      expect(TrustHostRequestSchema.safeParse({ ...host, key }).success).toBe(false);
    }
  });

  it('refuses a port out of range', () => {
    expect(TrustHostRequestSchema.safeParse({ ...host, port: 0 }).success).toBe(false);
    expect(TrustHostRequestSchema.safeParse({ ...host, port: 65_536 }).success).toBe(false);
  });
});

describe('CREDENTIALS_FIELD_CODES', () => {
  it('names the problems of a pasted key and a taken name', () => {
    expect(CREDENTIALS_FIELD_CODES).toContain('wrong-passphrase');
    expect(CREDENTIALS_FIELD_CODES).toContain('name-taken');
  });
});

describe('ids', () => {
  it.each(
    [
      [ NewHttpsCredentialsSchema, 'NewHttpsCredentials' ],
      [ NewSshKeySchema, 'NewSshKey' ],
      [ SavedHttpsCredentialsSchema, 'SavedHttpsCredentials' ],
      [ SavedSshKeySchema, 'SavedSshKey' ],
      [ SavedCredentialsSchema, 'SavedCredentials' ],
      [ GenerateSshKeyRequestSchema, 'GenerateSshKeyRequest' ],
      [ GeneratedSshKeySchema, 'GeneratedSshKey' ],
      [ UnlockSshKeyRequestSchema, 'UnlockSshKeyRequest' ],
      [ HostKeySchema, 'HostKey' ],
      [ TrustHostRequestSchema, 'TrustHostRequest' ]
    ] as const
  )('names %#', (schema, id) => {
    expect(z.globalRegistry.get(schema)?.id).toBe(id);
  });
});
