import { createHash, createPublicKey, generateKeyPairSync, KeyObject, randomBytes } from 'node:crypto';
import { ParsedKey, utils } from 'ssh2';
import { UnlockedKey } from './unlocked-key';
import { sshString, uint32, WireReader } from './wire';

/** AR-26. */
const MAX_KEY_BYTES = 16 * 1024;
/** AR-27. */
const MIN_RSA_BITS = 2048;
/**
 * bcrypt KDF rounds run on the event loop and cost about 9 ms each, so a key's
 * own round count must not stall the instance. `ssh-keygen` uses 16 by
 * default; 100 still allows the usual hardening advice. _(Plan 10's call.)_
 */
const MAX_KDF_ROUNDS = 100;
const OPENSSH_MAGIC = 'openssh-key-v1\0';

export const SSH_KEY_PROBLEMS = [
  'invalid-key',
  'unsupported-type',
  'rsa-too-short',
  'passphrase-required',
  'wrong-passphrase',
  'passphrase-not-needed',
  'kdf-rounds-too-high'
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

/**
 * The bcrypt KDF round count of an encrypted OpenSSH key, read from its
 * envelope (`PROTOCOL.key`); undefined for other formats and unencrypted keys.
 */
function kdfRounds(text: string): number | undefined {
  const match = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(text);
  if (match === null) {
    return undefined;
  }
  const body = Buffer.from((match[1] ?? '').replace(/\s+/g, ''), 'base64');
  if (body.subarray(0, OPENSSH_MAGIC.length).toString('latin1') !== OPENSSH_MAGIC) {
    return undefined;
  }
  try {
    const reader = new WireReader(body.subarray(OPENSSH_MAGIC.length));
    reader.string();
    if (reader.string().toString('latin1') !== 'bcrypt') {
      return undefined;
    }
    const options = new WireReader(reader.string());
    options.string();
    return options.uint32();
  } catch {
    // Truncated: ssh2 refuses it as invalid.
    return undefined;
  }
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
  if ((kdfRounds(text) ?? 0) > MAX_KDF_ROUNDS) {
    throw new SshKeyError('kdf-rounds-too-high');
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

/**
 * A new Ed25519 key pair in OpenSSH format, without a passphrase (AR-29).
 * `privateKey` is the key to write, for tests; a new one by default.
 *
 * The OpenSSH format is written here rather than by ssh2's
 * `utils.generateKeyPairSync`, which drops the leading zero bytes of a public
 * key that starts with one (about one key in 256), so that the key it writes
 * cannot be read back.
 */
export function generateEd25519Key(
  comment: string,
  privateKey: KeyObject = generateKeyPairSync('ed25519').privateKey
): { privateKey: string; publicKey: string; } {
  const jwk = privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d ?? '', 'base64url');
  const pub = Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x ?? '', 'base64url');
  const blob = Buffer.concat([ sshString('ssh-ed25519'), sshString(pub) ]);
  const check = randomBytes(4);
  const keys = Buffer.concat([
    check,
    check,
    sshString('ssh-ed25519'),
    sshString(pub),
    sshString(Buffer.concat([ seed, pub ])),
    sshString(comment)
  ]);
  // The private section is padded with 1, 2, 3, … to the cipher block size, 8 without a cipher.
  const padding = Buffer.from(Array.from({ length: (8 - (keys.length % 8)) % 8 }, (_, i) => i + 1));
  const body = Buffer.concat([
    Buffer.from(OPENSSH_MAGIC),
    sshString('none'),
    sshString('none'),
    sshString(''),
    uint32(1),
    sshString(blob),
    sshString(Buffer.concat([ keys, padding ]))
  ]);
  const lines = body.toString('base64').match(/.{1,70}/g) ?? [];
  return {
    privateKey: [ '-----BEGIN OPENSSH PRIVATE KEY-----', ...lines, '-----END OPENSSH PRIVATE KEY-----', '' ].join('\n'),
    publicKey: `ssh-ed25519 ${blob.toString('base64')} ${comment}`
  };
}

/** The SHA256 fingerprint of an `authorized_keys` line, as `ssh-keygen -l` prints it. */
export function fingerprintOf(publicKeyLine: string): string {
  const blob = Buffer.from(publicKeyLine.trim().split(/\s+/)[1] ?? '', 'base64');
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}
