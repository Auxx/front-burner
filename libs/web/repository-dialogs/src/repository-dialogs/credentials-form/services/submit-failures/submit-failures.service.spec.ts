import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SubmitFailuresService } from './submit-failures.service';

describe('SubmitFailuresService', () => {
  let service: SubmitFailuresService;
  const inputs = signal('a');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ SubmitFailuresService ] });
    service = TestBed.inject(SubmitFailuresService);
    inputs.set('a');
    service.watch(inputs);
  });

  it('shows a failure on its field while the inputs stay the same', () => {
    service.record([ { path: 'remoteUrl', key: 'remoteUrl.tls-untrusted', params: {} } ]);

    expect(service.forPath('remoteUrl')).toEqual({ key: 'remoteUrl.tls-untrusted', params: {} });
    expect(service.forPath('name')).toBeUndefined();
  });

  it('forgets the failures once the inputs change', () => {
    service.record([ { path: 'remoteUrl', key: 'remoteUrl.tls-untrusted', params: {} } ]);

    inputs.set('b');

    expect(service.forPath('remoteUrl')).toBeUndefined();
  });

  it('forgets them when cleared', () => {
    service.record([ { path: 'remoteUrl', key: 'remoteUrl.tls-untrusted', params: {} } ]);

    service.clear();

    expect(service.forPath('remoteUrl')).toBeUndefined();
  });
});
