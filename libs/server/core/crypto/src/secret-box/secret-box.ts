import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const FORMAT = 'fb1';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

/** The record a stored secret belongs to; it is the associated data, so a value copied elsewhere does not decrypt (NF-8.3). */
export interface SecretBinding {
  table: string;
  recordId: string | number;
  userId?: number;
}

/** A stored value could not be decrypted. The message never contains the value or the key. */
export class SecretDecryptionError extends Error {
  constructor(reason: string) {
    super(`The stored secret could not be decrypted: ${reason}`);
    this.name = 'SecretDecryptionError';
  }
}

function derive(encryptionKey: string, info: string, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), info, length));
}

function associatedData(binding: SecretBinding): Buffer {
  return Buffer.from(`${binding.table}\0${binding.recordId}\0${binding.userId ?? ''}`, 'utf8');
}

/**
 * Encrypts stored secrets with AES-256-GCM and a key derived from
 * `FRONT_BURNER_ENCRYPTION_KEY` by HKDF (A-4.8). A stored value is
 * `fb1.<key ID>.<base64url(nonce ‖ ciphertext ‖ tag)>`.
 */
export class SecretBox {
  /** Identifies the key without revealing it (A-4.8). */
  readonly keyId: string;
  readonly #key: Buffer;

  constructor(encryptionKey: string) {
    this.#key = derive(encryptionKey, 'front-burner/secrets/v1', 32);
    this.keyId = derive(encryptionKey, 'front-burner/key-id', 6).toString('base64url');
  }

  encrypt(plaintext: string, binding: SecretBinding): string {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce, { authTagLength: TAG_LENGTH });
    cipher.setAAD(associatedData(binding));
    const ciphertext = Buffer.concat([ cipher.update(plaintext, 'utf8'), cipher.final() ]);
    const body = Buffer.concat([ nonce, ciphertext, cipher.getAuthTag() ]).toString('base64url');
    return `${FORMAT}.${this.keyId}.${body}`;
  }

  /** @throws SecretDecryptionError for another format, another key or a failed check. */
  decrypt(stored: string, binding: SecretBinding): string {
    const [ format, keyId, encoded, ...rest ] = stored.split('.');
    if (format !== FORMAT || encoded === undefined || rest.length > 0) {
      throw new SecretDecryptionError('unknown format');
    }
    if (keyId !== this.keyId) {
      throw new SecretDecryptionError('encrypted with another key');
    }
    const body = Buffer.from(encoded, 'base64url');
    if (body.length < NONCE_LENGTH + TAG_LENGTH) {
      throw new SecretDecryptionError('too short');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.#key, body.subarray(0, NONCE_LENGTH), {
      authTagLength: TAG_LENGTH
    });
    decipher.setAAD(associatedData(binding));
    decipher.setAuthTag(body.subarray(body.length - TAG_LENGTH));
    try {
      return Buffer.concat([
        decipher.update(body.subarray(NONCE_LENGTH, body.length - TAG_LENGTH)),
        decipher.final()
      ]).toString('utf8');
    } catch {
      throw new SecretDecryptionError('the integrity check failed');
    }
  }
}
