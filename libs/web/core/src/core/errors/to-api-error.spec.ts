import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { toApiError } from './to-api-error';

const body = { code: 'not-found', params: { id: 1 }, requestId: 'r1', message: 'Not found' };

describe('toApiError', () => {
  it('returns the body of an API error response', () => {
    expect(toApiError(new HttpErrorResponse({ status: 404, error: body }))).toEqual(body);
  });

  it('maps status 0 to a network error', () => {
    expect(toApiError(new HttpErrorResponse({ status: 0 }))).toEqual({
      code: 'network',
      params: {},
      requestId: '',
      message: 'Network error'
    });
  });

  it('maps a response with an HTML body to internal, keeping the request id header', () => {
    const error = new HttpErrorResponse({
      status: 500,
      error: '<html>Bad gateway</html>',
      headers: new HttpHeaders({ 'X-Request-Id': 'req-9' })
    });
    expect(toApiError(error)).toMatchObject({ code: 'internal', requestId: 'req-9' });
  });

  it('maps an HTML body without the header to internal with an empty request id', () => {
    const result = toApiError(new HttpErrorResponse({ status: 500, error: '<html></html>' }));
    expect(result).toMatchObject({ code: 'internal', requestId: '' });
  });

  it('maps anything else to internal', () => {
    expect(toApiError(new Error('boom'))).toMatchObject({ code: 'internal', requestId: '' });
  });
});
