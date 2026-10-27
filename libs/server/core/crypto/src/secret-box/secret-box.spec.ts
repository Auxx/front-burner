import { SecretBinding, SecretBox, SecretDecryptionError } from './secret-box';

const KEY = 'secret-box-spec-encryption-key-0123456789abcdef';
const OTHER_KEY = 'another-secret-box-spec-encryption-key-01234567';
const PLAINTEXT = 'ghp_token-for-the-secret-box-spec';
const BINDING: SecretBinding = { table: 'saved_credentials', recordId: 7, userId: 3 };

describe('SecretBox', () => {
  const box = new SecretBox(KEY);

  it('decrypts what it encrypted', () => {
    expect(box.decrypt(box.encrypt(PLAINTEXT, BINDING), BINDING)).toBe(PLAINTEXT);
  });

  it('uses a fresh nonce every time', () => {
    expect(box.encrypt(PLAINTEXT, BINDING)).not.toBe(box.encrypt(PLAINTEXT, BINDING));
  });

  it('refuses a value bound to another record', () => {
    const stored = box.encrypt(PLAINTEXT, BINDING);
    for (
      const other of [
        { ...BINDING, recordId: 8 },
        { ...BINDING, userId: 4 },
        { ...BINDING, userId: undefined },
        { ...BINDING, table: 'system_settings' }
      ]
    ) {
      expect(() => box.decrypt(stored, other)).toThrow(SecretDecryptionError);
    }
  });

  it('refuses another key', () => {
    const stored = new SecretBox(OTHER_KEY).encrypt(PLAINTEXT, BINDING);
    let error: unknown;
    try {
      box.decrypt(stored, BINDING);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SecretDecryptionError);
    const text = `${(error as Error).message} ${String(error)}`;
    for (const secret of [ KEY, OTHER_KEY, PLAINTEXT ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('refuses a tampered value', () => {
    const stored = box.encrypt(PLAINTEXT, BINDING);
    const body = Buffer.from(stored.split('.')[2] ?? '', 'base64url');
    body[body.length - 1] ^= 1;
    const tampered = `${stored.split('.').slice(0, 2).join('.')}.${body.toString('base64url')}`;
    expect(() => box.decrypt(tampered, BINDING)).toThrow(SecretDecryptionError);
    expect(() => box.decrypt('fb2.whatever.AAAA', BINDING)).toThrow(SecretDecryptionError);
    expect(() => box.decrypt('not a stored value', BINDING)).toThrow(SecretDecryptionError);
  });

  it('starts with the format and the key ID', () => {
    const stored = box.encrypt(PLAINTEXT, BINDING);
    expect(stored).toMatch(/^fb1\.[\w-]{8}\./);
    expect(stored.split('.')[1]).toBe(box.keyId);
    expect(new SecretBox(OTHER_KEY).keyId).not.toBe(box.keyId);
  });
});
