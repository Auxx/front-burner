import { unlockPrivateKey } from '@front-burner/server-core-git';
import { sshKeyFixture } from '@front-burner/server-core-git/testing';
import { JobKeys } from './job-keys';

describe('JobKeys', () => {
  const key = unlockPrivateKey(sshKeyFixture('ed25519'));

  it('hands a held key to its job', () => {
    const keys = new JobKeys();
    keys.hold(7, key);
    expect(keys.take(7)).toBe(key);
    expect(keys.take(8)).toBeUndefined();
  });

  it('forgets a released key', () => {
    const keys = new JobKeys();
    keys.hold(7, key);
    keys.release(7);
    expect(keys.take(7)).toBeUndefined();
  });
});
