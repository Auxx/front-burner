import { unlockPrivateKey } from '@front-burner/server-core-git';
import { sshKeyFixture } from '@front-burner/server-core-git/testing';
import { JobKeys } from './job-keys';

describe('JobKeys', () => {
  const key = unlockPrivateKey(sshKeyFixture('ed25519'));

  it('hands a held key to its job', () => {
    const keys = new JobKeys();
    keys.hold(7, 3, key);
    expect(keys.take(7, 3)).toBe(key);
    expect(keys.take(8, 3)).toBeUndefined();
  });

  it('hands a held key only for the credential it was held for', () => {
    const keys = new JobKeys();
    keys.hold(7, 3, key);

    // The repository's credentials were replaced after the job was queued.
    expect(keys.take(7, 4)).toBeUndefined();
  });

  it('forgets a released key', () => {
    const keys = new JobKeys();
    keys.hold(7, 3, key);
    keys.release(7);
    expect(keys.take(7, 3)).toBeUndefined();
  });
});
