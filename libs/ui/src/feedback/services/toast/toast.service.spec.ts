import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';

import { TOAST_DURATION_MS, TOAST_LIMIT, ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;
  let announce: ReturnType<typeof vi.fn>;

  const messages = () => service.toasts().map(toast => toast.message);

  beforeEach(() => {
    vi.useFakeTimers();
    announce = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    });
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces each toast politely, and danger assertively', () => {
    service.show({ message: 'Pushed 2 commits to origin/main', status: 'success', dismissLabel: 'Dismiss' });
    expect(announce).toHaveBeenLastCalledWith('Pushed 2 commits to origin/main', 'polite');

    service.show({ message: 'Push failed', status: 'danger', dismissLabel: 'Dismiss' });
    expect(announce).toHaveBeenLastCalledWith('Push failed', 'assertive');
  });

  it('removes a toast without actions after its duration', () => {
    service.show({ message: 'Already up to date', dismissLabel: 'Dismiss' });

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(messages()).toEqual([ 'Already up to date' ]);

    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('pauses while paused', () => {
    service.show({ message: 'Already up to date', dismissLabel: 'Dismiss' });
    const [ { id } ] = service.toasts();

    service.pause(id, 'hover');
    vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    expect(messages()).toEqual([ 'Already up to date' ]);

    service.resume(id, 'hover');
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(messages()).toEqual([]);
  });

  it('keeps a toast with actions until dismissed or acted on', () => {
    const push = vi.fn();
    service.show({
      message: 'Merge committed. Push to publish it.',
      dismissLabel: 'Dismiss',
      actions: [ { label: 'Push', run: push }, { label: 'Undo merge', run: vi.fn() } ]
    });

    vi.advanceTimersByTime(60_000);
    expect(messages()).toEqual([ 'Merge committed. Push to publish it.' ]);

    const [ toast ] = service.toasts();
    service.run(toast.id, toast.actions?.[0] ?? { label: '', run: () => undefined });

    expect(push).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([]);
  });

  it('replaces a toast with the same key', () => {
    service.show({ message: 'This file was updated.', key: 'file-updated', dismissLabel: 'Dismiss' });
    vi.advanceTimersByTime(3000);
    service.show({ message: 'This file was updated.', key: 'file-updated', dismissLabel: 'Dismiss' });

    expect(messages()).toEqual([ 'This file was updated.' ]);

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(messages()).toEqual([ 'This file was updated.' ]);
  });

  it('shows at most three', () => {
    for (const n of [ 1, 2, 3, 4 ]) {
      service.show({ message: `Toast ${n}`, dismissLabel: 'Dismiss' });
    }

    expect(TOAST_LIMIT).toBe(3);
    expect(messages()).toEqual([ 'Toast 2', 'Toast 3', 'Toast 4' ]);
  });

  it('stays paused until neither hover nor focus holds it', () => {
    service.show({ message: 'Already up to date', dismissLabel: 'Dismiss' });
    const [ { id } ] = service.toasts();

    service.pause(id, 'focus');
    service.pause(id, 'hover');
    service.resume(id, 'hover');
    vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    expect(messages()).toEqual([ 'Already up to date' ]);

    service.resume(id, 'focus');
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(messages()).toEqual([]);
  });

  it('keeps toasts with actions over the limit and drops the oldest without', () => {
    service.show({ message: 'Undo', dismissLabel: 'Dismiss', actions: [ { label: 'Undo merge', run: vi.fn() } ] });
    for (const n of [ 1, 2, 3 ]) {
      service.show({ message: `Toast ${n}`, dismissLabel: 'Dismiss' });
    }

    expect(messages()).toEqual([ 'Undo', 'Toast 2', 'Toast 3' ]);
  });

  it('keeps a toast that holds the focus over the limit', () => {
    service.show({ message: 'Toast 1', dismissLabel: 'Dismiss' });
    service.pause(service.toasts()[0].id, 'focus');
    for (const n of [ 2, 3, 4 ]) {
      service.show({ message: `Toast ${n}`, dismissLabel: 'Dismiss' });
    }

    expect(messages()).toEqual([ 'Toast 1', 'Toast 3', 'Toast 4' ]);
  });

  it('queues a toast while every shown toast must stay', () => {
    for (const n of [ 1, 2, 3 ]) {
      service.show({ message: `Action ${n}`, dismissLabel: 'Dismiss', actions: [ { label: 'Push', run: vi.fn() } ] });
    }
    service.show({ message: 'Pulled 3 commits', dismissLabel: 'Dismiss' });

    expect(messages()).toEqual([ 'Action 1', 'Action 2', 'Action 3' ]);
    expect(announce).not.toHaveBeenCalledWith('Pulled 3 commits', expect.anything());

    service.dismiss(service.toasts()[0].id);

    expect(messages()).toEqual([ 'Action 2', 'Action 3', 'Pulled 3 commits' ]);
    expect(announce).toHaveBeenLastCalledWith('Pulled 3 commits', 'polite');
  });

  it('keeps the id and the pause of a toast it replaces by key', () => {
    service.show({ message: '3 new commits on origin/main', key: 'remote', dismissLabel: 'Dismiss' });
    const [ { id } ] = service.toasts();
    service.pause(id, 'hover');

    service.show({ message: '5 new commits on origin/main', key: 'remote', dismissLabel: 'Dismiss' });
    vi.advanceTimersByTime(TOAST_DURATION_MS * 2);

    expect(service.toasts().map(toast => [ toast.id, toast.message ])).toEqual([ [
      id,
      '5 new commits on origin/main'
    ] ]);
  });

  it('dismisses through the returned handle', () => {
    const handle = service.show({ message: 'Pulled 3 commits', dismissLabel: 'Dismiss' });

    handle.dismiss();

    expect(messages()).toEqual([]);
  });
});
