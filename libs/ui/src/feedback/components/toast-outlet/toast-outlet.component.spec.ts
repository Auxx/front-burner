import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TOAST_DURATION_MS, ToastService } from '../../services/toast/toast.service';
import { ToastOutletComponent } from './toast-outlet.component';

@Component({
  imports: [ ToastOutletComponent ],
  template: `<button>Pull</button><ui-toast-outlet label="Notifications" />`
})
class HostComponent {}

describe('ToastOutletComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let service: ToastService;

  const outlet = () => fixture.nativeElement.querySelector('ui-toast-outlet') as HTMLElement;
  const toasts = () => outlet().querySelectorAll('li') as NodeListOf<HTMLElement>;
  const pull = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  const button = (text: string) =>
    [ ...outlet().querySelectorAll('button') ].find(
      element => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === text
    ) as HTMLButtonElement;
  const render = () => fixture.detectChanges();
  const showWithAction = () =>
    service.show({
      message: 'The remote has new commits. Pull first.',
      status: 'warning',
      dismissLabel: 'Dismiss',
      actions: [ { label: 'Pull now', run: () => undefined } ]
    });
  // The focus moves into the toast from Pull, as with Tab or F6.
  const focusFromPull = (target: HTMLElement) => {
    pull().focus();
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: pull() }));
    target.focus();
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [ HostComponent ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce: vi.fn().mockResolvedValue(undefined) } } ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    service = TestBed.inject(ToastService);
    render();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a labelled region listing the toasts', () => {
    service.show({ message: 'Pulled 3 commits', status: 'success', dismissLabel: 'Dismiss' });
    render();

    expect(outlet().getAttribute('role')).toBe('region');
    expect(outlet().getAttribute('aria-label')).toBe('Notifications');
    expect(toasts().length).toBe(1);
    expect(toasts()[0].textContent).toContain('Pulled 3 commits');
    expect(toasts()[0].querySelector('ui-status-icon')).not.toBeNull();
    expect(button('Dismiss')).toBeDefined();
  });

  it('never takes the focus', () => {
    pull().focus();
    showWithAction();
    render();

    expect(document.activeElement).toBe(pull());
  });

  it('pauses on hover and focus', () => {
    service.show({ message: 'Pulled 3 commits', dismissLabel: 'Dismiss' });
    render();

    toasts()[0].dispatchEvent(new MouseEvent('pointerenter'));
    vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    render();
    expect(toasts().length).toBe(1);

    toasts()[0].dispatchEvent(new MouseEvent('pointerleave'));
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    render();
    expect(toasts().length).toBe(0);
  });

  it('returns the focus when the toast holding it goes away', () => {
    showWithAction();
    render();
    focusFromPull(button('Pull now'));
    button('Pull now').click();
    render();
    vi.runOnlyPendingTimers();
    render();

    expect(toasts().length).toBe(0);
    expect(document.activeElement).toBe(pull());

    showWithAction();
    render();
    focusFromPull(button('Dismiss'));
    button('Dismiss').click();
    render();
    vi.runOnlyPendingTimers();
    render();

    expect(document.activeElement).toBe(pull());
  });
});
