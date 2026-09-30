import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { HealthApi } from './health';

describe('HealthApi', () => {
  let service: HealthApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('requests health through the same-origin API path', async () => {
    const result = firstValueFrom(service.getStatus());
    const request = http.expectOne('/api/health');
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'ok' });

    await expect(result).resolves.toEqual({ status: 'ok' });
  });

  it('passes failed requests to the caller', async () => {
    const result = firstValueFrom(service.getStatus());
    http.expectOne('/api/health').flush(null, { status: 503, statusText: 'Unavailable' });

    await expect(result).rejects.toMatchObject({ status: 503 });
  });

  it('rejects successful HTTP responses that do not report a healthy API', async () => {
    const result = firstValueFrom(service.getStatus());
    http.expectOne('/api/health').flush({ status: 'unexpected' });

    await expect(result).rejects.toThrow('Unexpected API health response.');
  });

  it('cancels stalled requests after five seconds', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(service.getStatus());
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    const request = http.expectOne('/api/health');

    await vi.advanceTimersByTimeAsync(5000);

    await rejection;
    expect(request.cancelled).toBe(true);
  });
});
