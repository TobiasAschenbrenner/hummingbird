import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { articleFixture } from '../../../testing/article-fixtures';
import { Auth } from '../../services/auth/auth';
import { ArticleDelete } from './article-delete';

describe('ArticleDelete', () => {
  let fixture: ComponentFixture<ArticleDelete>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let auth: Auth;
  let removed = vi.fn<(result: 'deleted' | 'not-found') => void>();
  let reload = vi.fn<() => void>();
  const button = (text: string) =>
    [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === text,
    )!;
  const confirm = () => button('Permanently delete').click();
  async function session(id = 1): Promise<void> {
    auth.restoreSession().subscribe();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id, username: 'Author', email: 'author@example.test' } });
    await fixture.whenStable();
  }
  async function open(): Promise<void> {
    button('Delete article').click();
    await fixture.whenStable();
  }
  async function reject(status: number): Promise<void> {
    confirm();
    http
      .expectOne('/api/articles/article-1')
      .flush('private SQL details', { status, statusText: 'Rejected' });
    await fixture.whenStable();
  }
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleDelete],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    fixture = TestBed.createComponent(ArticleDelete);
    fixture.componentRef.setInput('article', articleFixture({ version: '9007199254740993' }));
    element = fixture.nativeElement;
    removed = vi.fn();
    reload = vi.fn();
    fixture.componentInstance.removed.subscribe(removed);
    fixture.componentInstance.reload.subscribe(reload);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('exposes deletion only after the session identifies the article author', async () => {
    expect(element.querySelector('button')).toBeNull();
    auth.expireSession();
    await fixture.whenStable();
    expect(element.querySelector('button')).toBeNull();
    await session(2);
    expect(element.querySelector('button')).toBeNull();
    await session();
    expect(button('Delete article').disabled).toBe(false);
    http.expectNone((request) => request.method === 'DELETE');
  });

  it('explains permanent child deletion, renders titles as text, focuses Cancel and can cancel without a request', async () => {
    fixture.componentRef.setInput(
      'article',
      articleFixture({ title: '<script>unsafe()</script>', commentCount: 2 }),
    );
    await session();
    await open();
    expect(element.textContent).toContain('2 comments');
    expect(element.textContent).toContain('Shared categories and tags remain');
    expect(element.textContent).toContain('This cannot be undone');
    expect(element.querySelector('h2')?.textContent).toContain('<script>unsafe()</script>');
    expect(element.querySelector('script')).toBeNull();
    expect(document.activeElement).toBe(button('Cancel'));
    http.expectNone((request) => request.method === 'DELETE');
    button('Cancel').click();
    await fixture.whenStable();
    expect(element.querySelector('section')).toBeNull();
    expect(document.activeElement).toBe(button('Delete article'));
    expect(removed).not.toHaveBeenCalled();
  });

  it('sends the exact reviewed ID/version once, disables actions in flight and emits success only after 204', async () => {
    await session();
    await open();
    confirm();
    confirm();
    fixture.detectChanges();
    const request = http.expectOne('/api/articles/article-1');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ articleId: 1, version: '9007199254740993' });
    expect(button('Deleting…').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(removed).not.toHaveBeenCalled();
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(removed).toHaveBeenCalledExactlyOnceWith('deleted');
    expect(element.querySelector('button')).toBeNull();
  });

  it('blocks stale deletion until a reload and fresh explicit confirmation', async () => {
    await session();
    await open();
    await reject(409);
    expect(element.textContent).toContain('This article changed');
    expect(button('Permanently delete').disabled).toBe(true);
    confirm();
    http.expectNone((request) => request.method === 'DELETE');
    button('Reload article').click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    fixture.componentRef.setInput(
      'article',
      articleFixture({ title: 'A newer edit', version: '9007199254740994' }),
    );
    await fixture.whenStable();
    expect(element.querySelector('section')).toBeNull();
    http.expectNone((request) => request.method === 'DELETE');
    await open();
    expect(element.textContent).toContain('A newer edit');
    confirm();
    const request = http.expectOne('/api/articles/article-1');
    expect(request.request.body.version).toBe('9007199254740994');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  });

  it('treats server and network failures as uncertain without leaking details or repeating a request', async () => {
    for (const status of [500, 0]) {
      fixture.componentRef.setInput('article', articleFixture());
      await fixture.whenStable();
      await session();
      await open();
      await reject(status);
      expect(element.textContent).toContain('We couldn’t confirm deletion');
      expect(element.textContent).not.toContain('private SQL');
      expect(button('Permanently delete').disabled).toBe(true);
      confirm();
      http.expectNone((request) => request.method === 'DELETE');
      expect(removed).not.toHaveBeenCalled();
    }
  });

  it('requires review for an unexpected success status instead of claiming deletion', async () => {
    await session();
    await open();
    confirm();
    http.expectOne('/api/articles/article-1').flush('', { status: 200, statusText: 'OK' });
    await fixture.whenStable();
    expect(element.textContent).toContain('We couldn’t confirm deletion');
    expect(button('Permanently delete').disabled).toBe(true);
    expect(removed).not.toHaveBeenCalled();
  });

  it('keeps the expired-session explanation and requires author login and a reload', async () => {
    await session();
    await open();
    await reject(401);
    expect(auth.status()).toBe('anonymous');
    expect(element.textContent).toContain('Your session expired');
    expect(element.querySelector('a')?.getAttribute('target')).toBe('_blank');
    button('Check session').click();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 2, username: 'Other', email: 'other@example.test' } });
    await fixture.whenStable();
    expect(button('Permanently delete').disabled).toBe(true);
    await session();
    expect(button('Permanently delete').disabled).toBe(true);
    expect(button('Reload article').disabled).toBe(false);
    http.expectNone((request) => request.method === 'DELETE');
  });

  it('reports an already missing article separately from a confirmed deletion', async () => {
    await session();
    await open();
    await reject(404);
    expect(removed).toHaveBeenCalledExactlyOnceWith('not-found');
    expect(element.querySelector('button')).toBeNull();
  });

  it('blocks a forbidden deletion and requires reloading even if local ownership still matches', async () => {
    await session();
    await open();
    await reject(403);
    expect(element.textContent).toContain('You cannot delete this article');
    expect(button('Permanently delete').disabled).toBe(true);
    confirm();
    http.expectNone((request) => request.method === 'DELETE');
  });

  it('permits only an explicit retry after the write limit rejects a request', async () => {
    await session();
    await open();
    await reject(429);
    expect(element.textContent).toContain('Wait a minute');
    expect(button('Permanently delete').disabled).toBe(false);
    http.expectNone((request) => request.method === 'DELETE');
    confirm();
    http
      .expectOne('/api/articles/article-1')
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(removed).toHaveBeenCalledExactlyOnceWith('deleted');
  });

  it('requires a reload after rejected input or format without showing server text', async () => {
    for (const status of [400, 413, 415]) {
      fixture.componentRef.setInput('article', articleFixture());
      await fixture.whenStable();
      await session();
      await open();
      await reject(status);
      expect(button('Permanently delete').disabled).toBe(true);
      expect(button('Reload article')).toBeDefined();
      expect(element.textContent).not.toContain('private SQL');
    }
  });

  it('cannot bypass a stale confirmation by cancelling and reopening', async () => {
    await session();
    await open();
    await reject(409);
    button('Cancel').click();
    await fixture.whenStable();
    expect(button('Delete article').disabled).toBe(true);
    expect(button('Reload article')).toBeDefined();
    button('Delete article').click();
    expect(element.querySelector('section')).toBeNull();
    http.expectNone((request) => request.method === 'DELETE');
  });

  it('cancels a pending deletion on article changes and requires a new confirmation for the new ID', async () => {
    await session();
    await open();
    confirm();
    const first = http.expectOne('/api/articles/article-1');
    fixture.componentRef.setInput('article', articleFixture({ id: 2, slug: 'article-2' }));
    await fixture.whenStable();
    expect(first.cancelled).toBe(true);
    expect(element.querySelector('section')).toBeNull();
    expect(removed).not.toHaveBeenCalled();
    await open();
    confirm();
    const next = http.expectOne('/api/articles/article-2');
    expect(next.request.body.articleId).toBe(2);
    next.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  });

  it('cancels a pending request when destroyed', async () => {
    await session();
    await open();
    confirm();
    const request = http.expectOne('/api/articles/article-1');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
    expect(removed).not.toHaveBeenCalled();
  });

  it('blocks confirmation during account changes and after local logout', async () => {
    await session();
    await open();
    auth.logout().subscribe();
    fixture.detectChanges();
    expect(button('Permanently delete').disabled).toBe(true);
    confirm();
    http.expectNone((request) => request.method === 'DELETE');
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(button('Permanently delete').disabled).toBe(true);
    expect(element.textContent).toContain('Sign in as the article’s author');
  });
});
