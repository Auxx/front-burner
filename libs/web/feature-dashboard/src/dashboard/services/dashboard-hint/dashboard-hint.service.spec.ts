import { TestBed } from '@angular/core/testing';

import { DashboardHintService } from './dashboard-hint.service';

describe('DashboardHintService', () => {
  let service: DashboardHintService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(DashboardHintService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('knows nothing at first', () => {
    expect(service.hadRepositories(1)).toBe(false);
  });

  it('remembers per user', () => {
    service.remember(1, true);

    expect(service.hadRepositories(1)).toBe(true);
    expect(service.hadRepositories(2)).toBe(false);
    expect(localStorage.getItem('front-burner.dashboard.has-repositories.1')).not.toBeNull();
  });

  it('forgets when the user has none any more', () => {
    service.remember(1, true);
    service.remember(1, false);

    expect(service.hadRepositories(1)).toBe(false);
  });

  it('works without localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'QuotaExceededError');
    });

    expect(() => service.remember(1, true)).not.toThrow();
    expect(service.hadRepositories(1)).toBe(false);
  });
});
