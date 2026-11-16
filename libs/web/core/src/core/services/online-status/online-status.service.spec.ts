import { TestBed } from '@angular/core/testing';

import { OnlineStatusService } from './online-status.service';

describe('OnlineStatusService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts with what the browser knows', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    expect(TestBed.inject(OnlineStatusService).online()).toBe(false);
  });

  it('follows the browser going offline and back', () => {
    const status = TestBed.inject(OnlineStatusService);
    expect(status.online()).toBe(true);

    window.dispatchEvent(new Event('offline'));
    expect(status.online()).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(status.online()).toBe(true);
  });
});
