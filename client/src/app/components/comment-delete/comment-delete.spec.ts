import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { commentFixture } from '../../../testing/comment-fixtures';
import { Auth } from '../../services/auth/auth';
import { CommentDelete } from './comment-delete';

describe('CommentDelete', () => {
  let fixture: ComponentFixture<CommentDelete>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let auth: Auth;
  let removed = vi.fn<(result: 'deleted' | 'not-found') => void>();
  let reload = vi.fn<() => void>();
  const button = (text: string) =>
    [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    )!;
  const confirm = () => button('Permanently delete comment').click();
  const request = () => http.expectOne('/api/articles/article-1/comments/1');
  async function session(id = 1): Promise<void> {
    auth.restoreSession().subscribe();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id, username: 'Reader', email: 'reader@example.test' } });
    await fixture.whenStable();
  }
  async function open(): Promise<void> {
    button('Delete comment').click();
    await fixture.whenStable();
  }
  async function reject(status: number): Promise<void> {
    confirm();
    request().flush('private SQL', { status, statusText: 'Rejected' });
    await fixture.whenStable();
  }
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommentDelete],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    fixture = TestBed.createComponent(CommentDelete);
    element = fixture.nativeElement;
    fixture.componentRef.setInput('slug', 'article-1');
    fixture.componentRef.setInput('comment', commentFixture());
    removed = vi.fn();
    reload = vi.fn();
    fixture.componentInstance.removed.subscribe(removed);
    fixture.componentInstance.reload.subscribe(reload);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());
  it('exposes deletion only to the signed-in comment author', async () => {
    expect(element.querySelector('button')).toBeNull();
    auth.expireSession();
    await fixture.whenStable();
    expect(element.querySelector('button')).toBeNull();
    await session(2);
    expect(element.querySelector('button')).toBeNull();
    await session();
    expect(button('Delete comment').disabled).toBe(false);
    http.expectNone((request) => request.method === 'DELETE');
  });
  it('explains permanent removal, uses distinct confirmation IDs, focuses Cancel and can cancel without deleting', async () => {
    await session();
    await open();
    expect(element.textContent).toContain('The article and other comments remain');
    expect(element.textContent).toContain('This cannot be undone');
    expect(element.querySelector('section')?.id).toBe('comment-deletion-1');
    expect(document.activeElement).toBe(button('Cancel'));
    button('Cancel').click();
    await fixture.whenStable();
    expect(element.querySelector('section')).toBeNull();
    expect(document.activeElement).toBe(button('Delete comment'));
    fixture.componentRef.setInput('comment', commentFixture({ id: 2 }));
    await fixture.whenStable();
    await open();
    expect(element.querySelector('section')?.id).toBe('comment-deletion-2');
    http.expectNone((request) => request.method === 'DELETE');
  });
  it('sends one reviewed target, disables actions while pending and emits success only after 204', async () => {
    await session();
    await open();
    confirm();
    confirm();
    fixture.detectChanges();
    const req = request();
    expect(req.request.body).toEqual({ articleId: 1 });
    expect(button('Deleting…').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(removed).not.toHaveBeenCalled();
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(removed).toHaveBeenCalledExactlyOnceWith('deleted');
    expect(element.querySelector('button')).toBeNull();
  });
  it('requires a reload and fresh confirmation after an uncertain response without exposing server details', async () => {
    await session();
    await open();
    await reject(500);
    expect(element.textContent).toContain('We couldn’t confirm deletion');
    expect(element.textContent).not.toContain('private SQL');
    expect(button('Permanently delete comment').disabled).toBe(true);
    confirm();
    http.expectNone((request) => request.method === 'DELETE');
    button('Reload comments').click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    fixture.componentRef.setInput('comment', commentFixture());
    await fixture.whenStable();
    expect(element.querySelector('section')).toBeNull();
    await open();
    confirm();
    request().flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  });
  it('treats network failure and unexpected success as uncertain without automatic retries', async () => {
    for (const status of [0, 200]) {
      fixture.componentRef.setInput('comment', commentFixture());
      await fixture.whenStable();
      await session();
      await open();
      await reject(status);
      expect(button('Permanently delete comment').disabled).toBe(true);
      expect(button('Reload comments')).toBeDefined();
      expect(removed).not.toHaveBeenCalled();
      http.expectNone((request) => request.method === 'DELETE');
    }
  });
  it('keeps the session-expiry explanation and requires the original account plus a fresh read', async () => {
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
    expect(button('Permanently delete comment').disabled).toBe(true);
    await session();
    expect(button('Permanently delete comment').disabled).toBe(true);
    button('Reload comments').click();
    expect(reload).toHaveBeenCalledTimes(1);
    http.expectNone((request) => request.method === 'DELETE');
  });
  it('reports an already missing comment without claiming to have deleted it', async () => {
    await session();
    await open();
    await reject(404);
    expect(removed).toHaveBeenCalledExactlyOnceWith('not-found');
    expect(element.querySelector('button')).toBeNull();
  });
  it('blocks forbidden or invalid deletions until a reload, including after cancel/reopen', async () => {
    for (const status of [400, 403, 413, 415]) {
      fixture.componentRef.setInput('comment', commentFixture());
      await fixture.whenStable();
      await session();
      await open();
      await reject(status);
      expect(button('Permanently delete comment').disabled).toBe(true);
      expect(element.textContent).not.toContain('private SQL');
      button('Cancel').click();
      await fixture.whenStable();
      expect(button('Delete comment').disabled).toBe(true);
      expect(button('Reload comments')).toBeDefined();
      button('Delete comment').click();
      expect(element.querySelector('section')).toBeNull();
      http.expectNone((request) => request.method === 'DELETE');
    }
  });
  it('requires reloading the article after a reused URL conflict, without dropping a comment', async () => {
    await session();
    await open();
    await reject(409);
    expect(button('Permanently delete comment').disabled).toBe(true);
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/articles/article-1');
    expect(element.textContent).toContain('Copy your draft');
    expect(removed).not.toHaveBeenCalled();
  });
  it('allows only an explicit retry after rate limiting', async () => {
    await session();
    await open();
    await reject(429);
    expect(element.textContent).toContain('Wait a minute');
    expect(button('Permanently delete comment').disabled).toBe(false);
    http.expectNone((request) => request.method === 'DELETE');
    confirm();
    request().flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  });
  it('does not cancel a pending deletion when another list refresh returns the same comment identity', async () => {
    await session();
    await open();
    confirm();
    const req = request();
    fixture.componentRef.setInput('comment', commentFixture());
    await fixture.whenStable();
    expect(req.cancelled).toBe(false);
    expect(button('Deleting…').disabled).toBe(true);
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(removed).toHaveBeenCalledExactlyOnceWith('deleted');
  });
  it('cancels on navigation or destruction and requires a new confirmation for another target', async () => {
    await session();
    await open();
    confirm();
    const first = request();
    fixture.componentRef.setInput('slug', 'article-2');
    fixture.componentRef.setInput('comment', commentFixture({ id: 2, articleId: 2 }));
    await fixture.whenStable();
    expect(first.cancelled).toBe(true);
    expect(element.querySelector('section')).toBeNull();
    expect(removed).not.toHaveBeenCalled();
    await open();
    confirm();
    const next = http.expectOne('/api/articles/article-2/comments/2');
    expect(next.request.body).toEqual({ articleId: 2 });
    fixture.destroy();
    expect(next.cancelled).toBe(true);
    expect(removed).not.toHaveBeenCalled();
  });
  it('blocks deletion while comments are refreshing, account changes are pending or the author is logged out', async () => {
    await session();
    fixture.componentRef.setInput('available', false);
    await fixture.whenStable();
    button('Delete comment').click();
    expect(element.querySelector('section')).toBeNull();
    fixture.componentRef.setInput('available', true);
    await fixture.whenStable();
    await open();
    auth.logout().subscribe();
    fixture.detectChanges();
    expect(button('Permanently delete comment').disabled).toBe(true);
    confirm();
    http.expectNone((request) => request.method === 'DELETE');
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(button('Permanently delete comment').disabled).toBe(true);
    expect(element.textContent).toContain('Sign in as the comment’s author');
  });
});
