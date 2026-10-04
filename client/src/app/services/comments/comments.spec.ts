import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Observable } from 'rxjs';
import { commentFixture, commentPageFixture } from '../../../testing/comment-fixtures';
import { CommentsApi } from './comments';

describe('CommentsApi', () => {
  let api: CommentsApi;
  let http: HttpTestingController;
  const input = {
    articleId: 1,
    body: '  Thank you 🐦!\n\nPlain text.  ',
    requestId: 'a1111111-b222-4333-8444-c55555555555',
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CommentsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('loads a bounded public cursor page and strips private fields', async () => {
    const result = firstValueFrom(api.list('article-1', 1, 2));
    const request = http.expectOne('/api/articles/article-1/comments?before=2');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('X-Hummingbird-Request')).toBe(false);
    const page = commentPageFixture();
    request.flush({
      ...page,
      comments: [
        {
          ...page.comments[0],
          requestId: input.requestId,
          author: {
            ...page.comments[0]!.author,
            email: 'private@example.test',
            passwordHash: 'private',
          },
        },
      ],
    });
    await expect(result).resolves.toEqual(page);
  });

  it('rejects wrong identities, invalid dates, duplicated/out-of-order IDs and inconsistent cursors', async () => {
    const page = commentPageFixture();
    for (const payload of [
      null,
      {},
      { ...page, articleId: 2 },
      { ...page, total: -1 },
      { ...page, nextCursor: 1 },
      { ...page, comments: [commentFixture({ articleId: 2 })] },
      { ...page, comments: [commentFixture({ createdAt: 'yesterday' })] },
      { ...page, comments: [commentFixture(), commentFixture()] },
      { ...page, total: 2, comments: [commentFixture(), commentFixture({ id: 2 })] },
    ]) {
      const result = firstValueFrom(api.list('article-1', 1));
      const rejected = expect(result).rejects.toThrow('Unexpected comment API response.');
      http.expectOne('/api/articles/article-1/comments').flush(payload);
      await rejected;
    }
    const cursorResult = firstValueFrom(api.list('article-1', 1, 1));
    const rejected = expect(cursorResult).rejects.toThrow('Unexpected comment API response.');
    http.expectOne('/api/articles/article-1/comments?before=1').flush(page);
    await rejected;
  });

  it('sends only comment fields with the session and header, accepting creation and replay statuses', async () => {
    for (const status of [201, 200]) {
      const untrustedInput = { ...input, authorId: 99 };
      const result = firstValueFrom(api.publish('article-1', untrustedInput, 1));
      const request = http.expectOne('/api/articles/article-1/comments');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(input);
      expect(request.request.withCredentials).toBe(true);
      expect(request.request.headers.get('X-Hummingbird-Request')).toBe('1');
      const comment = commentFixture({ body: input.body });
      request.flush({ comment }, { status, statusText: 'Saved' });
      await expect(result).resolves.toEqual(comment);
    }
  });

  it('rejects malformed or mismatched publication confirmation without retrying', async () => {
    for (const comment of [
      { id: 1 },
      commentFixture({ body: 'Different body.' }),
      commentFixture({ body: input.body, author: { id: 2, username: 'Other' } }),
      commentFixture({ body: input.body, articleId: 2 }),
    ]) {
      const result = firstValueFrom(api.publish('article-1', input, 1));
      const rejected = expect(result).rejects.toThrow('Unexpected comment API response.');
      http
        .expectOne('/api/articles/article-1/comments')
        .flush({ comment }, { status: 201, statusText: 'Created' });
      await rejected;
    }
    const result = firstValueFrom(api.publish('article-1', input, 1));
    const rejected = expect(result).rejects.toThrow('Unexpected comment creation response.');
    http
      .expectOne('/api/articles/article-1/comments')
      .flush({}, { status: 202, statusText: 'Accepted' });
    await rejected;
    http.expectNone('/api/articles/article-1/comments');
  });

  it('rejects invalid route, identity, cursor, body and request ID before HTTP access', async () => {
    await expect(firstValueFrom(api.list('../auth/logout', 1))).rejects.toThrow();
    await expect(firstValueFrom(api.list('article-1', 0))).rejects.toThrow();
    for (const before of [0, 1.5, 2147483648])
      await expect(firstValueFrom(api.list('article-1', 1, before))).rejects.toThrow();
    for (const fields of [
      { body: ' ' },
      { body: '\ud800' },
      { body: '🐦'.repeat(2001) },
      { body: 'bad\u0000text' },
      { requestId: 'not-uuid' },
      { articleId: 0 },
    ])
      await expect(
        firstValueFrom(api.publish('article-1', { ...input, ...fields }, 1)),
      ).rejects.toThrow('Invalid comment input.');
    http.expectNone((request) => request.url.includes('/comments'));
  });

  it('cancels timed-out reads and writes without automatic retries', async () => {
    vi.useFakeTimers();
    for (const operation of [
      () => api.list('article-1', 1) as Observable<unknown>,
      () => api.publish('article-1', input, 1) as Observable<unknown>,
    ]) {
      const result = firstValueFrom(operation());
      const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      const request = http.expectOne('/api/articles/article-1/comments');
      await vi.advanceTimersByTimeAsync(10000);
      await rejected;
      expect(request.cancelled).toBe(true);
      http.expectNone('/api/articles/article-1/comments');
    }
  });
  it('deletes only the selected comment with the current article ID, session and required header', async () => {
    const untrustedInput = { articleId: 1, authorId: 99, body: 'not sent' };
    const result = firstValueFrom(api.remove('article-1', 2, untrustedInput));
    const request = http.expectOne('/api/articles/article-1/comments/2');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ articleId: 1 });
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-Hummingbird-Request')).toBe('1');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await expect(result).resolves.toBeUndefined();
  });
  it('rejects invalid deletion routes and IDs before HTTP access', async () => {
    for (const id of [0, -1, 1.5, 2147483648]) {
      await expect(firstValueFrom(api.remove('article-1', id, { articleId: 1 }))).rejects.toThrow(
        'Invalid comment deletion target.',
      );
      await expect(firstValueFrom(api.remove('article-1', 1, { articleId: id }))).rejects.toThrow();
    }
    await expect(
      firstValueFrom(api.remove('../auth/logout', 1, { articleId: 1 })),
    ).rejects.toThrow();
    http.expectNone((request) => request.method === 'DELETE');
  });
  it('accepts only a 204 deletion confirmation and never retries failed or ambiguous deletions', async () => {
    for (const status of [200, 202, 401, 403, 404, 409, 429, 500]) {
      const result = firstValueFrom(api.remove('article-1', 1, { articleId: 1 }));
      const rejected = expect(result).rejects.toThrow();
      http
        .expectOne('/api/articles/article-1/comments/1')
        .flush({}, { status, statusText: 'Response' });
      await rejected;
      http.expectNone((request) => request.method === 'DELETE');
    }
  });
  it('cancels a timed-out deletion without sending another request', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(api.remove('article-1', 1, { articleId: 1 }));
    const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    const request = http.expectOne('/api/articles/article-1/comments/1');
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(request.cancelled).toBe(true);
    http.expectNone((request) => request.method === 'DELETE');
  });
});
