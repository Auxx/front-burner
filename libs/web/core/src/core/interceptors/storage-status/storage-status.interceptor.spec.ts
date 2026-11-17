import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { StorageStatusService } from '../../services/storage-status/storage-status.service';
import { storageStatusInterceptor } from './storage-status.interceptor';

describe('storageStatusInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let refresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refresh = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([ storageStatusInterceptor ])),
        provideHttpClientTesting(),
        { provide: StorageStatusService, useValue: { refresh } }
      ]
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const fail = async (status: number, code: string) => {
    const answer = firstValueFrom(http.post('/api/v1/repositories', {})).catch(() => undefined);
    backend.expectOne('/api/v1/repositories').flush({ code, params: {}, requestId: 'r', message: '' }, {
      status,
      statusText: 'Error'
    });
    await answer;
  };

  it('reads the storage state again after a low-storage error', async () => {
    await fail(507, 'low-storage');

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores other errors and answers', async () => {
    await fail(409, 'git-busy');
    const answer = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush({});
    await answer;

    expect(refresh).not.toHaveBeenCalled();
  });
});
