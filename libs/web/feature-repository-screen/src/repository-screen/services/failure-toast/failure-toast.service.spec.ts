import { TestBed } from '@angular/core/testing';
import { ToastService } from '@front-burner/ui';
import { toApiError } from '@front-burner/web-core';

import { apiError } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { FailureToastService } from './failure-toast.service';

const K = 'web-feature-repository-screen.FailureToastService';

describe('FailureToastService', () => {
  let service: FailureToastService;
  let show: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    show = vi.fn(() => ({ dismiss: vi.fn() }));
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({ 'errors.internal': 'Something went wrong.', [`${K}.reference`]: 'Ref {{ reference }}' })
      ],
      providers: [ { provide: ToastService, useValue: { show } } ]
    });
    service = TestBed.inject(FailureToastService);
  });

  it('says why, with the reference, as a danger toast', () => {
    service.show(toApiError(apiError(500, 'internal')));

    expect(show).toHaveBeenCalledExactlyOnceWith({
      message: 'Something went wrong. Ref abcdef01',
      dismissLabel: `${K}.dismiss`,
      status: 'danger'
    });
  });

  it('passes on actions and a key', () => {
    const actions = [ { label: 'Try again', run: () => undefined } ];

    service.show(toApiError(apiError(500, 'internal')), { actions, key: 'this' });

    expect(show.mock.calls[0][0]).toEqual(expect.objectContaining({ actions, key: 'this' }));
  });

  it('has no actions when given none, so that the toast goes by itself', () => {
    service.show(toApiError(apiError(500, 'internal')), { actions: [] });

    expect(show.mock.calls[0][0].actions).toBeUndefined();
  });

  it('says what it is told to say instead, without a reference', () => {
    service.show(toApiError(apiError(500, 'internal')), { text: 'In other words.' });

    expect(show.mock.calls[0][0].message).toBe('In other words.');
  });

  it('returns what dismisses the toast', () => {
    const dismiss = vi.fn();
    show.mockReturnValue({ dismiss });

    service.show(toApiError(apiError(500, 'internal'))).dismiss();

    expect(dismiss).toHaveBeenCalledOnce();
  });
});
