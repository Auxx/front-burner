import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { DialogService } from '@front-burner/ui';
import { KnownHostsApi } from '@front-burner/web-api-client';
import { of, Subject } from 'rxjs';

import { TrustHostDialog } from '../../credentials-form/dialogs/trust-host/trust-host.dialog';
import { HostNotTrusted, HostTrustService } from './host-trust.service';

const hostKey = {
  host: 'git.example.com',
  port: 22,
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8'
};

const unknownHost = () =>
  new HttpErrorResponse({
    status: 409,
    error: { code: 'host-key-unknown', params: hostKey, requestId: 'r', message: 'unknown' }
  });

describe('HostTrustService', () => {
  let closed: Subject<boolean | undefined>;
  let open: ReturnType<typeof vi.fn>;
  let trust: ReturnType<typeof vi.fn>;
  let service: HostTrustService;

  beforeEach(() => {
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    trust = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      providers: [ { provide: DialogService, useValue: { open } }, { provide: KnownHostsApi, useValue: { trust } } ]
    });
    service = TestBed.inject(HostTrustService);
  });

  it('runs the request without asking when the host is known', async () => {
    await expect(service.trusting(async () => 'done')).resolves.toBe('done');

    expect(open).not.toHaveBeenCalled();
  });

  it('asks to trust an unknown host, saves it, and runs the request again', async () => {
    const request = vi.fn().mockRejectedValueOnce(unknownHost()).mockResolvedValueOnce('done');

    const result = service.trusting(request);
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(TrustHostDialog, { data: hostKey, size: 'small' }));
    closed.next(true);
    closed.complete();

    await expect(result).resolves.toBe('done');
    expect(trust).toHaveBeenCalledWith({ host: hostKey.host, port: 22, type: hostKey.type, key: hostKey.key });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('throws HostNotTrusted on Cancel, and saves nothing', async () => {
    const request = vi.fn().mockRejectedValue(unknownHost());

    const result = service.trusting(request);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    closed.next(false);
    closed.complete();

    await expect(result).rejects.toBeInstanceOf(HostNotTrusted);
    expect(trust).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it('passes any other failure on', async () => {
    const failure = new Error('boom');

    await expect(service.trusting(() => Promise.reject(failure))).rejects.toBe(failure);
  });
});
