import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { APP_VERSION } from '../../tokens/app-version';
import { BEFORE_RELOAD_TIMEOUT_MS, PAGE_RELOAD, VersionCheckService } from './version-check.service';

@Component({ template: '' })
class Page {
  readonly saved: string[] = [];

  constructor() {
    inject(VersionCheckService).beforeReload(async () => {
      this.saved.push('README.md');
    });
  }
}

describe('VersionCheckService', () => {
  let reload: ReturnType<typeof vi.fn>;
  let service: VersionCheckService;

  beforeEach(() => {
    reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [ { provide: APP_VERSION, useValue: '1.4.2' }, { provide: PAGE_RELOAD, useValue: reload } ]
    });
    service = TestBed.inject(VersionCheckService);
  });

  afterEach(() => vi.useRealTimers());

  it('turns on when a response carries another version, and stays on', () => {
    service.seen('1.4.2');
    expect(service.newVersion()).toBe(false);

    service.seen('1.5.0');
    expect(service.newVersion()).toBe(true);

    service.seen('1.4.2');
    expect(service.newVersion()).toBe(true);
  });

  it('ignores a response without the header', () => {
    service.seen(null);

    expect(service.newVersion()).toBe(false);
  });

  it('runs what the pages registered before reloading', async () => {
    const fixture = TestBed.createComponent(Page);
    reload.mockImplementation(() => expect(fixture.componentInstance.saved).toEqual([ 'README.md' ]));

    await service.reload();

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when what a page registered fails', async () => {
    TestBed.runInInjectionContext(() => service.beforeReload(() => Promise.reject(new Error('offline'))));

    await service.reload();

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when what a page registered does not finish in time', async () => {
    vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
    TestBed.runInInjectionContext(() => service.beforeReload(() => new Promise<void>(() => undefined)));

    const reloading = service.reload();
    await vi.advanceTimersByTimeAsync(BEFORE_RELOAD_TIMEOUT_MS - 1);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await reloading;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('is reloading until the browser stays on the page, then can reload again', async () => {
    vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
    let saved: () => void = () => undefined;
    TestBed.runInInjectionContext(() => service.beforeReload(() => new Promise<void>(resolve => (saved = resolve))));

    const reloading = service.reload();
    expect(service.reloading()).toBe(true);
    // A second click while the first waits does nothing more.
    await service.reload();
    saved();
    await reloading;
    expect(reload).toHaveBeenCalledOnce();
    // The browser may still ask "Leave page?" after reload() returns.
    expect(service.reloading()).toBe(true);

    // Still here: such as Stay on another page's question.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.reloading()).toBe(false);
    const again = service.reload();
    saved();
    await again;
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('forgets what a page registered once the page is gone', async () => {
    const fixture = TestBed.createComponent(Page);
    const page = fixture.componentInstance;
    fixture.destroy();

    await service.reload();

    expect(page.saved).toEqual([]);
    expect(reload).toHaveBeenCalledOnce();
  });
});
