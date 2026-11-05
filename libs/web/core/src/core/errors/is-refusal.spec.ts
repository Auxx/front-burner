import { HttpErrorResponse } from '@angular/common/http';

import { isRefusal } from './is-refusal';

describe('isRefusal', () => {
  it.each([ 400, 403, 404, 409, 422 ])('counts %i as a refusal, which another try would not change', status => {
    expect(isRefusal(new HttpErrorResponse({ status }))).toBe(true);
  });

  it.each([ 0, 408, 429, 500, 503 ])('counts %i as passing', status => {
    expect(isRefusal(new HttpErrorResponse({ status }))).toBe(false);
  });

  it('counts anything else that was thrown as passing', () => {
    expect(isRefusal(new Error('no'))).toBe(false);
  });
});
