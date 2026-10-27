import { inspect } from 'node:util';
import type { ParsedKey } from 'ssh2';
import { mpint, sshString } from './wire';

/** A DER `Ecdsa-Sig-Value` (two INTEGERs) as SSH's `mpint r, mpint s` (RFC 5656 section 3.1.2). */
function ecdsaSignature(der: Buffer): Buffer {
  let offset = 2;
  if ((der[1] ?? 0) & 0x80) {
    offset += (der[1] ?? 0) & 0x7f;
  }
  const integers: Buffer[] = [];
  for (let i = 0; i < 2; i++) {
    const length = der[offset + 1] ?? 0;
    integers.push(der.subarray(offset + 2, offset + 2 + length));
    offset += 2 + length;
  }
  return Buffer.concat(integers.map(mpint));
}

/**
 * A decrypted private key, held only in the backend's memory (AR-17, AR-31,
 * A-5.5). It can sign but never gives the private key back, and shows itself
 * as `[UnlockedKey]` in JSON, logs and the inspector.
 */
export class UnlockedKey {
  readonly #key: ParsedKey;
  /** The public key in SSH wire format, as in `authorized_keys`. */
  readonly publicBlob: Buffer;
  /** The key type, such as `ssh-ed25519` or `ecdsa-sha2-nistp256`. */
  readonly algorithm: string;

  constructor(key: ParsedKey) {
    this.#key = key;
    this.publicBlob = key.getPublicSSH();
    this.algorithm = key.type;
  }

  /**
   * Signs `data` and returns the SSH signature blob (`string algorithm, string
   * signature`). `hash` chooses `rsa-sha2-256` or `rsa-sha2-512` for RSA keys;
   * without it RSA signs with SHA-1 (`ssh-rsa`). Other key types ignore it.
   */
  sign(data: Buffer, hash?: 'sha256' | 'sha512'): Buffer {
    let name = this.algorithm;
    let algo: string | undefined;
    if (this.algorithm === 'ssh-rsa') {
      name = hash === undefined ? 'ssh-rsa' : `rsa-sha2-${hash.slice(3)}`;
      algo = hash ?? 'sha1';
    }
    const signature: Buffer | Error = this.#key.sign(data, algo);
    if (signature instanceof Error) {
      throw new Error('signing failed');
    }
    return Buffer.concat([
      sshString(name),
      sshString(this.algorithm.startsWith('ecdsa-') ? ecdsaSignature(signature) : signature)
    ]);
  }

  toJSON(): string {
    return '[UnlockedKey]';
  }

  [inspect.custom](): string {
    return '[UnlockedKey]';
  }
}
