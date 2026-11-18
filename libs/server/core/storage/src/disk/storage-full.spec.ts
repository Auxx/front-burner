import { isStorageFull } from './storage-full';

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('isStorageFull', () => {
  it('ENOSPC and EDQUOT are storage full', () => {
    expect(isStorageFull(errno('ENOSPC'))).toBe(true);
    expect(isStorageFull(errno('EDQUOT'))).toBe(true);
  });

  it('SQLite\'s SQLITE_FULL is storage full', () => {
    expect(isStorageFull(errno('SQLITE_FULL'))).toBe(true);
  });

  it('any other error is not', () => {
    expect(isStorageFull(errno('EACCES'))).toBe(false);
    expect(isStorageFull(new Error('No space left on device'))).toBe(false);
    expect(isStorageFull(null)).toBe(false);
    expect(isStorageFull({ code: 28 })).toBe(false);
  });
});
