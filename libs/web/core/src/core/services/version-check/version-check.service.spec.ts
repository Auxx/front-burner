import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { APP_VERSION } from '../../tokens/app-version';
import { PAGE_RELOAD, VersionCheckService } from './version-check.service';

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

  it('forgets what a page registered once the page is gone', async () => {
    const fixture = TestBed.createComponent(Page);
    const page = fixture.componentInstance;
    fixture.destroy();

    await service.reload();

    expect(page.saved).toEqual([]);
    expect(reload).toHaveBeenCalledOnce();
  });
});
