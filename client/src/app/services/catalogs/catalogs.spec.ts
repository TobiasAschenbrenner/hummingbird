import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CatalogsApi } from './catalogs';

const entry = { id: 1, slug: 'tech', name: 'Tech' };

describe('CatalogsApi', () => {
  let service: CatalogsApi;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CatalogsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('loads both public option lists and discards unknown response fields', async () => {
    const result = firstValueFrom(service.articleOptions());
    const categories = http.expectOne('/api/categories');
    const tags = http.expectOne('/api/tags');
    expect(categories.request.method).toBe('GET');
    expect(tags.request.headers.has('X-Hummingbird-Request')).toBe(false);
    categories.flush({ categories: [{ ...entry, private: 'ignored' }] });
    tags.flush({ tags: [{ ...entry, private: 'ignored' }] });
    await expect(result).resolves.toEqual({ categories: [entry], tags: [entry] });
  });

  it('accepts empty categories and tag catalogs without inventing options', async () => {
    const result = firstValueFrom(service.articleOptions());
    http.expectOne('/api/categories').flush({ categories: [] });
    http.expectOne('/api/tags').flush({ tags: [] });
    await expect(result).resolves.toEqual({ categories: [], tags: [] });
  });

  it('rejects malformed, duplicated and unsafe catalog entries', async () => {
    for (const tags of [
      null,
      [{ ...entry, id: -1 }],
      [{ ...entry, id: '1' }],
      [{ ...entry, name: '' }],
      [{ ...entry, slug: '../auth/logout' }],
      [entry, entry],
      [entry, { ...entry, id: 2 }],
    ]) {
      const result = firstValueFrom(service.articleOptions());
      const rejected = expect(result).rejects.toThrow('Unexpected catalog API response.');
      http.expectOne('/api/categories').flush({ categories: [entry] });
      http.expectOne('/api/tags').flush({ tags });
      await rejected;
    }
  });

  it('fails the combined load and cancels the other request when a catalog fails', async () => {
    const result = firstValueFrom(service.articleOptions());
    const failure = expect(result).rejects.toMatchObject({ status: 503 });
    const categories = http.expectOne('/api/categories');
    const tags = http.expectOne('/api/tags');
    categories.flush(null, { status: 503, statusText: 'Unavailable' });
    await failure;
    expect(tags.cancelled).toBe(true);
  });

  it('cancels stalled option requests after ten seconds without retrying', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(service.articleOptions());
    const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    const requests = http.match(() => true);
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    expect(requests.every((request) => request.cancelled)).toBe(true);
    http.expectNone(() => true);
  });
});
