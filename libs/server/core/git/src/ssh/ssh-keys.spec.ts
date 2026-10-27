import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import {
  fingerprintOf,
  generateEd25519Key,
  inspectPrivateKey,
  SshKeyError,
  SshKeyProblem,
  unlockPrivateKey
} from './ssh-keys';

const FIXTURES = join(import.meta.dirname, '../testing/fixtures/keys');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** `SHA256:…` as `ssh-keygen -lf` prints it. */
function keygenFingerprint(name: string): string {
  return execFileSync('ssh-keygen', [ '-lf', join(FIXTURES, `${name}.pub`) ], { encoding: 'utf8' }).split(' ')[1] ?? '';
}

function problemOf(run: () => unknown): { problem: SshKeyProblem; field: string; } | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof SshKeyError) {
      return { problem: error.problem, field: error.field };
    }
    throw error;
  }
  return undefined;
}

describe('inspectPrivateKey', () => {
  it('inspects an Ed25519 key', () => {
    const info = inspectPrivateKey(fixture('ed25519'));

    expect(info).toEqual({
      type: 'ed25519',
      bits: 256,
      publicKey: fixture('ed25519.pub').trim(),
      fingerprint: keygenFingerprint('ed25519'),
      encrypted: false
    });
  });

  it('inspects ECDSA and RSA keys', () => {
    expect(inspectPrivateKey(fixture('ecdsa-p256'))).toMatchObject({
      type: 'ecdsa',
      bits: 256,
      fingerprint: keygenFingerprint('ecdsa-p256')
    });
    expect(inspectPrivateKey(fixture('rsa-2048'))).toMatchObject({
      type: 'rsa',
      bits: 2048,
      fingerprint: keygenFingerprint('rsa-2048')
    });
  });

  it('accepts a PEM RSA key', () => {
    expect(inspectPrivateKey(fixture('rsa-2048-pem'))).toMatchObject({
      type: 'rsa',
      bits: 2048,
      publicKey: fixture('rsa-2048-pem.pub').trim()
    });
  });

  it('inspects an encrypted key with its passphrase', () => {
    expect(inspectPrivateKey(fixture('ed25519-passphrase'), 'correct horse')).toMatchObject({
      type: 'ed25519',
      encrypted: true,
      fingerprint: keygenFingerprint('ed25519-passphrase')
    });
  });

  it('refuses DSA', () => {
    expect(problemOf(() => inspectPrivateKey(fixture('dsa')))).toEqual({
      problem: 'unsupported-type',
      field: 'privateKey'
    });
  });

  it('refuses RSA under 2048 bits', () => {
    expect(problemOf(() => inspectPrivateKey(fixture('rsa-1024')))).toEqual({
      problem: 'rsa-too-short',
      field: 'privateKey'
    });
  });

  it('refuses text that is not a key', () => {
    for (const text of [ 'hello', '', fixture('ed25519.pub') ]) {
      expect(problemOf(() => inspectPrivateKey(text))).toEqual({ problem: 'invalid-key', field: 'privateKey' });
    }
  });

  it('refuses an encrypted key without a passphrase', () => {
    expect(problemOf(() => inspectPrivateKey(fixture('ed25519-passphrase')))).toEqual({
      problem: 'passphrase-required',
      field: 'passphrase'
    });
    expect(problemOf(() => inspectPrivateKey(fixture('ed25519-passphrase'), ''))).toEqual({
      problem: 'passphrase-required',
      field: 'passphrase'
    });
  });

  it('refuses a wrong passphrase', () => {
    expect(problemOf(() => inspectPrivateKey(fixture('ed25519-passphrase'), 'wrong horse'))).toEqual({
      problem: 'wrong-passphrase',
      field: 'passphrase'
    });
  });

  it('refuses a passphrase for a key that is not encrypted', () => {
    expect(problemOf(() => inspectPrivateKey(fixture('ed25519'), 'correct horse'))).toEqual({
      problem: 'passphrase-not-needed',
      field: 'passphrase'
    });
  });

  it('refuses a key over 16 KiB', () => {
    const text = fixture('ed25519') + '\n'.repeat(16 * 1024);

    expect(problemOf(() => inspectPrivateKey(text))).toEqual({ problem: 'invalid-key', field: 'privateKey' });
  });
});

describe('unlockPrivateKey', () => {
  it('signs with the key', () => {
    const key = unlockPrivateKey(fixture('ed25519-passphrase'), 'correct horse');
    const publicKey = fixture('ed25519-passphrase.pub').trim();

    expect(key.algorithm).toBe('ssh-ed25519');
    expect(key.publicBlob.toString('base64')).toBe(publicKey.split(' ')[1]);
    expect(key.sign(Buffer.from('data')).length).toBeGreaterThan(64);
  });

  it('runs the same checks', () => {
    expect(problemOf(() => unlockPrivateKey(fixture('ed25519-passphrase'), 'wrong horse'))).toEqual({
      problem: 'wrong-passphrase',
      field: 'passphrase'
    });
  });

  it('never shows the private key', () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const secret = fixture('ed25519').split('\n')[1] ?? '';

    expect(JSON.stringify({ key })).toBe('{"key":"[UnlockedKey]"}');
    expect(inspect(key, { showHidden: true, depth: 10 })).toBe('[UnlockedKey]');
    expect(inspect({ key })).not.toContain(secret.slice(0, 20));
  });
});

describe('generateEd25519Key', () => {
  it('generates an Ed25519 key with the comment', () => {
    const { privateKey, publicKey } = generateEd25519Key('front-burner@example.com');
    const dir = mkdtempSync(join(tmpdir(), 'fb-keygen-'));
    try {
      const path = join(dir, 'id');
      writeFileSync(path, privateKey, { mode: 0o600 });
      const derived = execFileSync('ssh-keygen', [ '-y', '-f', path ], { encoding: 'utf8' }).trim();

      expect(publicKey).toMatch(/^ssh-ed25519 \S+ front-burner@example\.com$/);
      expect(derived.split(' ').slice(0, 2)).toEqual(publicKey.split(' ').slice(0, 2));
      expect(inspectPrivateKey(privateKey)).toMatchObject({ type: 'ed25519', encrypted: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fingerprintOf', () => {
  it('matches ssh-keygen', () => {
    expect(fingerprintOf(fixture('rsa-2048.pub'))).toBe(keygenFingerprint('rsa-2048'));
  });
});
