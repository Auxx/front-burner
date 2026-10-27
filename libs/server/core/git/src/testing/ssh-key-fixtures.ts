import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The passphrase of the `ed25519-passphrase` fixture. */
export const FIXTURE_PASSPHRASE = 'correct horse';

/** A test key from `fixtures/keys` (see its README), such as `ed25519` or `ed25519-passphrase.pub`. */
export function sshKeyFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'keys', name), 'utf8');
}
