import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUILT_IN_KNOWN_HOSTS } from './known-hosts';

/**
 * The deployment guide lists the built-in host keys for operators to copy into
 * `FRONT_BURNER_KNOWN_HOSTS_FILE` (AR-32). CI runs this on every change (`npm
 * run check:guide`), since a change to the guide alone affects no project.
 */
describe('the deployment guide', () => {
  it('lists every built-in host key', () => {
    const guide = readFileSync(resolve(import.meta.dirname, '../../../../../../docs/wiki/deployment.md'), 'utf8');
    const lines = new Set(guide.split('\n'));

    expect(BUILT_IN_KNOWN_HOSTS.filter(entry => !lines.has(entry))).toEqual([]);
  });
});
