import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { CurrentUserService } from '@front-burner/web-core';

import { PaneMemoryService } from './pane-memory.service';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

describe('PaneMemoryService', () => {
  let user: ReturnType<typeof signal<CurrentUser | undefined>>;

  function create(): PaneMemoryService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ PaneMemoryService, { provide: CurrentUserService, useValue: { user } } ]
    });
    const memory = TestBed.inject(PaneMemoryService);
    TestBed.tick();
    return memory;
  }

  beforeEach(() => {
    localStorage.clear();
    user = signal<CurrentUser | undefined>(ada);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('starts with the default sizes', () => {
    const memory = create();

    expect(memory.sideSize()).toBe(20);
    expect(memory.sideOpen()).toBe(true);
  });

  it('remembers the pane size and the collapsed tree', () => {
    const first = create();
    first.sideSize.set(35);
    first.sideOpen.set(false);
    TestBed.tick();

    expect(localStorage.getItem('fb.4.repositoryScreen.sideSize')).toBe('35');
    expect(localStorage.getItem('fb.4.repositoryScreen.sideOpen')).toBe('false');

    const second = create();
    expect(second.sideSize()).toBe(35);
    expect(second.sideOpen()).toBe(false);
  });

  it('keeps each user\'s memory apart', () => {
    localStorage.setItem('fb.5.repositoryScreen.sideSize', '50');

    expect(create().sideSize()).toBe(20);
  });

  it('reads the memory once the user has loaded', () => {
    localStorage.setItem('fb.4.repositoryScreen.sideOpen', 'false');
    user.set(undefined);
    const memory = create();
    expect(memory.sideOpen()).toBe(true);

    user.set(ada);
    TestBed.tick();

    expect(memory.sideOpen()).toBe(false);
  });

  it.each([ 'wide', '-3', '250', '' ])('ignores a stored size of %j', stored => {
    localStorage.setItem('fb.4.repositoryScreen.sideSize', stored);

    expect(create().sideSize()).toBe(20);
  });

  it('works without localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const memory = create();
    expect(memory.sideSize()).toBe(20);
    expect(memory.sideOpen()).toBe(true);

    memory.sideSize.set(40);
    expect(() => TestBed.tick()).not.toThrow();
    expect(memory.sideSize()).toBe(40);
  });
});
