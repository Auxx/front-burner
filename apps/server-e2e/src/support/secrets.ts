import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { utils } from 'ssh2';

/** The passphrase-protected key fixture, as a user pastes it. */
export const PROTECTED_KEY = sshKeyFixture('ed25519-passphrase');

/** The public half of {@link PROTECTED_KEY}, for a test server's `authorized_keys`. */
export const PROTECTED_PUBLIC = sshKeyFixture('ed25519-passphrase.pub').trim();

/** A distinctive part of the decrypted private key, as the backend holds it in memory. */
export function decryptedKeyBody(): string {
  const parsed = utils.parseKey(PROTECTED_KEY, FIXTURE_PASSPHRASE);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (key === undefined || key instanceof Error) {
    throw new Error('the fixture does not parse');
  }
  return key.getPrivatePEM().split('\n').filter(line => line !== '' && !line.startsWith('-----')).join('');
}

/**
 * The base64 lines of the encrypted private key as pasted, which no response
 * or log may repeat. Each is checked on its own: the first is mostly the
 * format's header, and the key material is in the others.
 */
export function pastedKeyLines(): string[] {
  return PROTECTED_KEY.split('\n').filter(line => line !== '' && !line.startsWith('-----'));
}
