import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { codeOf, errorCode } from './error-code';

describe('codeOf', () => {
  it('reads the code of an error body', () => {
    expect(codeOf({ code: 'low-storage' })).toBe('low-storage');
  });

  it.each([ null, 'text', 3, {} ])('is undefined for %j', body => {
    expect(codeOf(body)).toBeUndefined();
  });
});

describe('errorCode', () => {
  it('reads a JSON body', async () => {
    const error = new HttpErrorResponse({ status: 507, error: { code: 'low-storage' } });

    expect(await firstValueFrom(errorCode(error))).toBe('low-storage');
  });

  it('reads a Blob body', async () => {
    const error = new HttpErrorResponse({ status: 401, error: new Blob([ '{"code":"auth-token-expired"}' ]) });

    expect(await firstValueFrom(errorCode(error))).toBe('auth-token-expired');
  });

  it('is undefined for a Blob that is not JSON', async () => {
    const error = new HttpErrorResponse({ status: 502, error: new Blob([ '<html>' ]) });

    expect(await firstValueFrom(errorCode(error))).toBeUndefined();
  });
});
