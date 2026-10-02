import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { articleFixture, articlePageFixture } from '../../../testing/article-fixtures';
import { ArticlesApi } from './articles';

describe('ArticlesApi', () => {
  let service: ArticlesApi;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ArticlesApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('requests bounded list pages through the same-origin API and returns validated public fields', async () => {
    const data = articlePageFixture(2, 13);
    const result = firstValueFrom(service.list(2));
    const request = http.expectOne('/api/articles?page=2&pageSize=12');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('X-Hummingbird-Request')).toBe(false);
    request.flush({
      ...data,
      articles: [
        {
          ...data.articles[0],
          body: 'unwanted body',
          author: {
            ...data.articles[0]!.author,
            email: 'private@example.test',
            passwordHash: 'private-hash',
          },
        },
      ],
    });
    await expect(result).resolves.toEqual(data);
  });

  it('accepts empty catalogs and pages past the final article', async () => {
    for (const data of [articlePageFixture(1, 0), articlePageFixture(4, 1)]) {
      const result = firstValueFrom(service.list(data.pagination.page));
      http.expectOne(`/api/articles?page=${data.pagination.page}&pageSize=12`).flush(data);
      await expect(result).resolves.toEqual(data);
    }
  });

  it('rejects malformed pagination and article payloads', async () => {
    const page = articlePageFixture();
    const invalid = [
      null,
      {},
      { ...page, articles: null },
      { ...page, pagination: { ...page.pagination, page: 2 } },
      { ...page, pagination: { ...page.pagination, total: -1 } },
      { ...page, pagination: { ...page.pagination, pageSize: 50 } },
      { ...page, pagination: { ...page.pagination, totalPages: 2 } },
      { ...page, articles: [] },
      { ...page, articles: [{ ...page.articles[0], tags: null }] },
      { ...page, articles: [{ ...page.articles[0], createdAt: 'not a date' }] },
      { ...page, articles: [{ ...page.articles[0], commentCount: -1 }] },
      { ...page, articles: [{ ...page.articles[0], author: { id: 1 } }] },
      {
        ...page,
        articles: [
          { ...page.articles[0], tags: [page.articles[0]!.tags[0], page.articles[0]!.tags[0]] },
        ],
      },
    ];
    const duplicated = articlePageFixture(1, 2);
    duplicated.articles[1] = duplicated.articles[0]!;
    invalid.push(duplicated);
    for (const payload of invalid) {
      const result = firstValueFrom(service.list(1));
      const rejected = expect(result).rejects.toThrow('Unexpected article API response.');
      http.expectOne('/api/articles?page=1&pageSize=12').flush(payload);
      await rejected;
    }
  });

  it('keeps body text and bigint version strings unchanged in article detail', async () => {
    const article = articleFixture({
      body: 'Unicode 🐦 <script>plain text</script>\n\nNew paragraph.',
      version: '9007199254740993',
    });
    const result = firstValueFrom(service.detail(article.slug));
    const request = http.expectOne('/api/articles/article-1');
    expect(request.request.method).toBe('GET');
    request.flush({ article });
    await expect(result).resolves.toEqual(article);
  });

  it('rejects a different article slug, missing body and inexact version types', async () => {
    for (const article of [
      articleFixture({ slug: 'wrong-article' }),
      { ...articleFixture(), body: null },
      { ...articleFixture(), version: 1 },
      articleFixture({ version: '0' }),
    ]) {
      const result = firstValueFrom(service.detail('article-1'));
      const rejected = expect(result).rejects.toThrow('Unexpected article API response.');
      http.expectOne('/api/articles/article-1').flush({ article });
      await rejected;
    }
  });

  it('rejects invalid pages and slugs without sending a request', async () => {
    for (const page of [0, -1, 1.5, 10001, NaN])
      await expect(firstValueFrom(service.list(page))).rejects.toThrow('Invalid article page.');
    for (const slug of ['../auth/logout', 'Uppercase', 'article--1', 'a'.repeat(81)])
      await expect(firstValueFrom(service.detail(slug))).rejects.toThrow('Invalid article slug.');
    http.expectNone(() => true);
  });

  it('preserves HTTP status codes so callers can distinguish missing articles from failures', async () => {
    const missing = firstValueFrom(service.detail('article-1'));
    const notFound = expect(missing).rejects.toMatchObject({ status: 404 });
    http.expectOne('/api/articles/article-1').flush(null, { status: 404, statusText: 'Missing' });
    await notFound;
    const unavailable = firstValueFrom(service.list(1));
    const failure = expect(unavailable).rejects.toMatchObject({ status: 503 });
    http
      .expectOne('/api/articles?page=1&pageSize=12')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await failure;
  });

  it('cancels stalled list and detail requests after ten seconds', async () => {
    vi.useFakeTimers();
    const list = firstValueFrom(service.list(1));
    const detail = firstValueFrom(service.detail('article-1'));
    const assertions = [
      expect(list).rejects.toMatchObject({ name: 'TimeoutError' }),
      expect(detail).rejects.toMatchObject({ name: 'TimeoutError' }),
    ];
    const requests = http.match(() => true);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(assertions);
    expect(requests.every((request) => request.cancelled)).toBe(true);
  });
});
