import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { BannerActionsComponent } from '../../components/banner-actions/banner-actions.component';
import { InlineBannerComponent } from './inline-banner.component';

@Component({
  imports: [ InlineBannerComponent, BannerActionsComponent, ButtonComponent ],
  template: `
    @if (shown()) {
      <ui-inline-banner status="warning" dismissLabel="Dismiss" announce (dismissed)="shown.set(false)">
        <strong>work-laptop</strong> is locked. Unlock it to fetch, pull and push.
        <div uiBannerActions><button uiButton size="small">Unlock</button></div>
      </ui-inline-banner>
    }
    <ui-inline-banner quiet>Some HTML isn't shown in the preview.</ui-inline-banner>
  `
})
class HostComponent {
  readonly shown = signal(true);
}

describe('InlineBannerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let announce: ReturnType<typeof vi.fn>;

  const banners = () => fixture.nativeElement.querySelectorAll('ui-inline-banner') as NodeListOf<HTMLElement>;
  const locked = () => banners()[0];
  const quiet = () => banners()[banners().length - 1];

  beforeEach(async () => {
    announce = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [ HostComponent ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('shows its message, its actions and its status', () => {
    expect(locked().dataset['status']).toBe('warning');
    expect(locked().querySelector('.message')?.textContent).toContain('is locked');
    expect(locked().querySelector('.actions button')?.textContent?.trim()).toBe('Unlock');
    expect(locked().querySelector('ui-status-icon ui-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('offers a dismiss button that reports and leaves removal to its owner', async () => {
    const dismiss = locked().querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;

    expect(dismiss.getAttribute('type')).toBe('button');

    dismiss.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.shown()).toBe(false);
    expect(banners().length).toBe(1);
  });

  it('has no dismiss button without a label', () => {
    expect(quiet().querySelector('button')).toBeNull();
    expect(quiet().dataset['quiet']).toBe('true');
  });

  it('announces its message once when asked to', async () => {
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('work-laptop is locked. Unlock it to fetch, pull and push.', 'polite');

    fixture.detectChanges();
    await fixture.whenStable();

    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('stays silent by default', () => {
    expect(announce).not.toHaveBeenCalledWith(expect.stringContaining('Some HTML'), expect.anything());
    for (const banner of banners()) {
      expect(banner.hasAttribute('role')).toBe(false);
      expect(banner.hasAttribute('aria-live')).toBe(false);
    }
  });
});
