import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('stores an Argon2id hash', async () => {
    expect(await hasher.hash('abcdefghi1')).toMatch(/^\$argon2id\$/);
  });

  it('uses a fresh salt', async () => {
    expect(await hasher.hash('abcdefghi1')).not.toBe(await hasher.hash('abcdefghi1'));
  });

  it('verifies the same password and refuses another', async () => {
    const hash = await hasher.hash('abcdefghi1');
    expect(await hasher.verify(hash, 'abcdefghi1')).toBe(true);
    expect(await hasher.verify(hash, 'abcdefghi2')).toBe(false);
  });

  it('verifies NFD against an NFC hash and the other way round', async () => {
    const nfc = 'café crème';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(await hasher.verify(await hasher.hash(nfd), nfc)).toBe(true);
    expect(await hasher.verify(await hasher.hash(nfc), nfd)).toBe(true);
  });

  it('does not trim', async () => {
    expect(await hasher.verify(await hasher.hash('  abcdefghi1  '), 'abcdefghi1')).toBe(false);
  });
});
