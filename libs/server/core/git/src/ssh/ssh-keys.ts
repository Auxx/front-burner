import { createHash } from 'node:crypto';
import { ParsedKey, utils } from 'ssh2';
import { UnlockedKey } from './unlocked-key';
import { WireReader } from './wire';

/** AR-26. */
const MAX_KEY_BYTES = 16 * 1024;
/** AR-27. */
const MIN_RSA_BITS = 2048;

export const SSH_KEY_PROBLEMS = [
  'invalid-key',
  'unsupported-type',
  'rsa-too-short',
  'passphrase-required',
  'wrong-passphrase',
  'passphrase-not-needed'
] as const;

export type SshKeyProblem = (typeof SSH_KEY_PROBLEMS)[number];

/** A private key or passphrase that cannot be used, with the form field to report it on (AR-27). */
export class SshKeyError extends Error {
  readonly field: 'privateKey' | 'passphrase';

  constructor(readonly problem: SshKeyProblem) {
    super(`unusable SSH key: ${problem}`);
    this.name = 'SshKeyError';
    this.field = problem.startsWith('passphrase-') || problem === 'wrong-passphrase' ? 'passphrase' : 'privateKey';
  }
}

export interface SshKeyInfo {
  type: 'ed25519' | 'ecdsa' | 'rsa';
  bits: number;
  /** An `authorized_keys` line without a comment. */
  publicKey: string;
  /** `SHA256:` and the unpadded base64 digest, as `ssh-keygen -l` prints it. */
  fingerprint: string;
  encrypted: boolean;
}

const ECDSA_BITS: Record<string, number> = {
  'ecdsa-sha2-nistp256': 256,
  'ecdsa-sha2-nistp384': 384,
  'ecdsa-sha2-nistp521': 521
};

/** The bit length of an RSA key's modulus, from its public blob (`string type, mpint e, mpint n`). */
function rsaBits(blob: Buffer): number {
  const reader = new WireReader(blob);
  reader.string();
  reader.string();
  const modulus = reader.string();
  let start = 0;
  while (start < modulus.length && modulus[start] === 0) {
    start++;
  }
  const first = modulus[start] ?? 0;
  return (modulus.length - start - 1) * 8 + (first === 0 ? 0 : Math.floor(Math.log2(first)) + 1);
}

function parse(text: string, passphrase?: string): ParsedKey | Error {
  const parsed: ParsedKey | ParsedKey[] | Error = utils.parseKey(text, passphrase);
  return Array.isArray(parsed) ? (parsed[0] ?? new Error('no key')) : parsed;
}

/** Parses and checks a private key in OpenSSH or PEM format (AR-26, AR-27). */
function parsePrivateKey(text: string, passphrase?: string): { key: ParsedKey; info: SshKeyInfo; } {
  if (Buffer.byteLength(text) > MAX_KEY_BYTES || !text.trim().startsWith('-----BEGIN ')) {
    throw new SshKeyError('invalid-key');
  }
  const plain = parse(text);
  const encrypted = plain instanceof Error && /no passphrase given/.test(plain.message);
  const given = passphrase === undefined || passphrase === '' ? undefined : passphrase;
  let key: ParsedKey | Error = plain;
  if (encrypted) {
    if (given === undefined) {
      throw new SshKeyError('passphrase-required');
    }
    key = parse(text, given);
    if (key instanceof Error) {
      throw new SshKeyError('wrong-passphrase');
    }
  }
  if (key instanceof Error || !key.isPrivateKey()) {
    throw new SshKeyError('invalid-key');
  }
  if (!encrypted && given !== undefined) {
    throw new SshKeyError('passphrase-not-needed');
  }

  const blob = key.getPublicSSH();
  let type: SshKeyInfo['type'];
  let bits: number;
  if (key.type === 'ssh-ed25519') {
    type = 'ed25519';
    bits = 256;
  } else if (key.type in ECDSA_BITS) {
    type = 'ecdsa';
    bits = ECDSA_BITS[key.type] ?? 0;
  } else if (key.type === 'ssh-rsa') {
    type = 'rsa';
    bits = rsaBits(blob);
    if (bits < MIN_RSA_BITS) {
      throw new SshKeyError('rsa-too-short');
    }
  } else {
    throw new SshKeyError('unsupported-type');
  }
  const publicKey = `${key.type} ${blob.toString('base64')}`;
  return { key, info: { type, bits, publicKey, fingerprint: fingerprintOf(publicKey), encrypted } };
}

/**
 * Checks a pasted or saved private key and describes it (AR-26, AR-27).
 *
 * @throws SshKeyError
 */
export function inspectPrivateKey(text: string, passphrase?: string): SshKeyInfo {
  return parsePrivateKey(text, passphrase).info;
}

/**
 * Checks a private key like {@link inspectPrivateKey} and returns it decrypted,
 * for the ssh-agent of git commands (AR-31, A-5.5).
 *
 * @throws SshKeyError
 */
export function unlockPrivateKey(text: string, passphrase?: string): UnlockedKey {
  return new UnlockedKey(parsePrivateKey(text, passphrase).key);
}

/** A new Ed25519 key pair in OpenSSH format, without a passphrase (AR-29). */
export function generateEd25519Key(comment: string): { privateKey: string; publicKey: string; } {
  const pair = utils.generateKeyPairSync('ed25519', { comment });
  return { privateKey: pair.private, publicKey: pair.public.trim() };
}

/** The SHA256 fingerprint of an `authorized_keys` line, as `ssh-keygen -l` prints it. */
export function fingerprintOf(publicKeyLine: string): string {
  const blob = Buffer.from(publicKeyLine.trim().split(/\s+/)[1] ?? '', 'base64');
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}
