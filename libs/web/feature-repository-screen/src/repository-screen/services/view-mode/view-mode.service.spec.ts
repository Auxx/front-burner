import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { CurrentUserService } from '@front-burner/web-core';
import { BehaviorSubject, map } from 'rxjs';

import { ViewModeService } from './view-mode.service';

const ada: CurrentUser = {
  id: 4,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'user',
  allowedGitLevels: [ 'advanced' ]
};

describe('ViewModeService', () => {
  let narrow: BehaviorSubject<boolean>;

  function create(): ViewModeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ViewModeService,
        { provide: CurrentUserService, useValue: { user: signal<CurrentUser | undefined>(ada) } },
        {
          provide: BreakpointObserver,
          useValue: {
            isMatched: () => narrow.value,
            observe: () => narrow.pipe(map(matches => ({ matches, breakpoints: {} })))
          }
        }
      ]
    });
    const mode = TestBed.inject(ViewModeService);
    TestBed.tick();
    return mode;
  }

  beforeEach(() => {
    localStorage.clear();
    narrow = new BehaviorSubject(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults to Split on wide and Edit on narrow', () => {
    const mode = create();
    expect(mode.mode()).toBe('split');
    expect(mode.editorShown()).toBe(true);
    expect(mode.previewShown()).toBe(true);

    narrow.next(true);

    expect(mode.mode()).toBe('edit');
    expect(mode.previewShown()).toBe(false);
  });

  it('remembers each size\'s mode', () => {
    const first = create();
    first.set('preview');
    narrow.next(true);
    first.set('preview');
    narrow.next(false);
    first.set('edit');

    expect(localStorage.getItem('fb.4.viewMode.wide')).toBe('edit');
    expect(localStorage.getItem('fb.4.viewMode.narrow')).toBe('preview');
    const second = create();
    expect(second.mode()).toBe('edit');
    narrow.next(true);
    expect(second.mode()).toBe('preview');
  });

  it('ignores a remembered mode that the screen size does not allow', () => {
    localStorage.setItem('fb.4.viewMode.narrow', 'split');
    localStorage.setItem('fb.4.viewMode.wide', 'sideways');
    narrow.next(true);

    const mode = create();

    expect(mode.mode()).toBe('edit');
    mode.set('split');
    expect(mode.mode()).toBe('edit');
    narrow.next(false);
    expect(mode.mode()).toBe('split');
  });

  it('works without localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const mode = create();
    mode.set('preview');

    expect(mode.mode()).toBe('preview');
  });

  it('switches to the other size\'s mode when the screen size changes', () => {
    const mode = create();
    mode.set('edit');

    narrow.next(true);
    mode.set('preview');
    narrow.next(false);

    expect(mode.mode()).toBe('edit');
  });
});
