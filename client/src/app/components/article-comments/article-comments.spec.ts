import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../services/auth/auth';
import { commentFixture, commentPageFixture } from '../../../testing/comment-fixtures';
import { ArticleComments } from './article-comments';

describe('ArticleComments', () => {
  let fixture: ComponentFixture<ArticleComments>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let countChanged = vi.fn<(count: number) => void>();
  const button = (text: string) =>
    [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    )!;
  const read = () => http.expectOne('/api/articles/article-1/comments');
  const items = () => [...element.querySelectorAll<HTMLElement>('.comment-list > li')];
  async function session(): Promise<void> {
    TestBed.inject(Auth).restoreSession().subscribe();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 1, username: 'Reader', email: 'reader@example.test' } });
    await fixture.whenStable();
  }
  async function write(body: string): Promise<void> {
    const field = element.querySelector<HTMLTextAreaElement>('textarea')!;
    field.value = body;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleComments],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ArticleComments);
    element = fixture.nativeElement;
    fixture.componentRef.setInput('slug', 'article-1');
    fixture.componentRef.setInput('articleId', 1);
    countChanged = vi.fn();
    fixture.componentInstance.countChanged.subscribe(countChanged);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('renders public comments as plain text with author and UTC time, and handles an empty discussion', async () => {
    TestBed.inject(Auth).expireSession();
    const body = '<img src=x onerror=alert(1)>\n\n<script>unsafe()</script>';
    read().flush({ ...commentPageFixture(), comments: [commentFixture({ body })] });
    await fixture.whenStable();
    expect(items()).toHaveLength(1);
    expect(element.querySelector('.comment-body')?.textContent).toBe(body);
    expect(element.textContent).toContain('Reader');
    expect(element.querySelector('time')?.getAttribute('datetime')).toBe(
      commentFixture().createdAt,
    );
    expect(element.querySelector('img, script')).toBeNull();
    expect(countChanged).toHaveBeenLastCalledWith(1);
    expect(element.querySelector('textarea')).toBeNull();
    button('Refresh comments').click();
    read().flush({ articleId: 1, comments: [], total: 0, nextCursor: null });
    await fixture.whenStable();
    expect(items()).toHaveLength(0);
    expect(element.textContent).toContain('No comments yet');
    expect(countChanged).toHaveBeenLastCalledWith(0);
  });
  it('gates posting until a successful load and permits a safe retry after an initial failure', async () => {
    await session();
    expect(button('Post comment').disabled).toBe(true);
    read().flush(
      { error: { message: 'private database details' } },
      { status: 500, statusText: 'Failed' },
    );
    await fixture.whenStable();
    expect(element.textContent).toContain('We couldn’t load comments');
    expect(element.textContent).not.toContain('private database');
    expect(button('Post comment').disabled).toBe(true);
    button('Try again').click();
    button('Try again').click();
    read().flush(commentPageFixture());
    await fixture.whenStable();
    expect(button('Post comment').disabled).toBe(false);
    expect(countChanged).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('loads older cursor pages without duplicates or double requests and preserves rows after a failed page', async () => {
    const comments = Array.from({ length: 20 }, (_, index) => commentFixture({ id: 40 - index }));
    read().flush({ articleId: 1, comments, total: 40, nextCursor: 21 });
    await fixture.whenStable();
    button('Load older comments').click();
    button('Load older comments').click();
    http
      .expectOne('/api/articles/article-1/comments?before=21')
      .flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(items()).toHaveLength(20);
    expect(countChanged).toHaveBeenCalledTimes(1);
    button('Load older comments').click();
    http.expectOne('/api/articles/article-1/comments?before=21').flush({
      articleId: 1,
      comments: Array.from({ length: 20 }, (_, index) => commentFixture({ id: 20 - index })),
      total: 40,
      nextCursor: null,
    });
    await fixture.whenStable();
    expect(items().map((item) => item.id)).toEqual(
      Array.from({ length: 40 }, (_, index) => `comment-${40 - index}`),
    );
    expect(button('Load older comments')).toBeUndefined();
    expect(countChanged).toHaveBeenLastCalledWith(40);
  });
  it('keeps the current list and draft when refreshing fails, and blocks posting after article removal', async () => {
    read().flush(commentPageFixture());
    await fixture.whenStable();
    await session();
    await write('Keep my draft.');
    button('Refresh comments').click();
    read().flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(items()).toHaveLength(1);
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep my draft.');
    button('Try again').click();
    read().flush(null, { status: 404, statusText: 'Missing' });
    await fixture.whenStable();
    expect(element.textContent).toContain('This article no longer exists');
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.readOnly).toBe(true);
    expect(button('Post comment').disabled).toBe(true);
  });
  it('shows a confirmed post immediately and retains it when the count refresh fails', async () => {
    read().flush(commentPageFixture());
    await fixture.whenStable();
    await session();
    await write('A new comment.');
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    http
      .expectOne((request) => request.method === 'POST')
      .flush(
        { comment: commentFixture({ id: 2, body: 'A new comment.' }) },
        { status: 201, statusText: 'Created' },
      );
    await fixture.whenStable();
    expect(items().map((item) => item.id)).toEqual(['comment-2', 'comment-1']);
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    expect(countChanged).toHaveBeenCalledTimes(1);
    read().flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(items()).toHaveLength(2);
    expect(element.textContent).toContain('Comment posted');
    button('Try again').click();
    read().flush({
      articleId: 1,
      comments: [commentFixture({ id: 2, body: 'A new comment.' }), commentFixture()],
      total: 2,
      nextCursor: null,
    });
    await fixture.whenStable();
    expect(countChanged).toHaveBeenLastCalledWith(2);
    expect(items()).toHaveLength(2);
  });
  it('cancels a stale refresh on publication and refreshes the authoritative count without duplicating a replay', async () => {
    read().flush(commentPageFixture());
    await fixture.whenStable();
    await session();
    await write(commentFixture().body);
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const post = http.expectOne((request) => request.method === 'POST');
    button('Refresh comments').click();
    const stale = read();
    post.flush({ comment: commentFixture() }, { status: 200, statusText: 'Replayed' });
    await fixture.whenStable();
    expect(stale.cancelled).toBe(true);
    expect(items()).toHaveLength(1);
    expect(countChanged).toHaveBeenCalledTimes(1);
    read().flush(commentPageFixture());
    await fixture.whenStable();
    expect(countChanged).toHaveBeenLastCalledWith(1);
    expect(items()).toHaveLength(1);
  });
  it('cancels reads and resets the draft on article navigation, then cancels on destruction', async () => {
    const initial = read();
    fixture.componentRef.setInput('slug', 'article-2');
    fixture.componentRef.setInput('articleId', 2);
    await fixture.whenStable();
    expect(initial.cancelled).toBe(true);
    http.expectOne('/api/articles/article-2/comments').flush(commentPageFixture(2));
    await fixture.whenStable();
    await session();
    await write('Draft for article 2.');
    button('Refresh comments').click();
    const refresh = http.expectOne('/api/articles/article-2/comments');
    fixture.componentRef.setInput('slug', 'article-3');
    fixture.componentRef.setInput('articleId', 3);
    await fixture.whenStable();
    expect(refresh.cancelled).toBe(true);
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    expect(items()).toHaveLength(0);
    const next = http.expectOne('/api/articles/article-3/comments');
    fixture.destroy();
    expect(next.cancelled).toBe(true);
  });
  it('shows delete controls only for owned comments and cancellation leaves the list and draft intact', async () => {
    read().flush({
      articleId: 1,
      comments: [commentFixture({ id: 2, author: { id: 2, username: 'Other' } }), commentFixture()],
      total: 2,
      nextCursor: null,
    });
    await fixture.whenStable();
    expect(button('Delete comment')).toBeUndefined();
    await session();
    expect(element.querySelectorAll('app-comment-delete button')).toHaveLength(1);
    await write('Keep this draft.');
    button('Delete comment').click();
    await fixture.whenStable();
    button('Cancel').click();
    await fixture.whenStable();
    expect(items()).toHaveLength(2);
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep this draft.');
    http.expectNone((request) => request.method === 'DELETE');
  });
  it('removes a confirmed comment immediately, preserves other rows and drafts, then refreshes the authoritative count', async () => {
    const other = commentFixture({ id: 2, author: { id: 2, username: 'Other' } });
    read().flush({ articleId: 1, comments: [other, commentFixture()], total: 2, nextCursor: null });
    await fixture.whenStable();
    await session();
    await write('Do not lose my draft.');
    button('Delete comment').click();
    await fixture.whenStable();
    button('Permanently delete comment').click();
    const deletion = http.expectOne('/api/articles/article-1/comments/1');
    expect(items()).toHaveLength(2);
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(items().map((item) => item.id)).toEqual(['comment-2']);
    expect(element.textContent).toContain('Comment deleted.');
    expect(countChanged).toHaveBeenCalledTimes(1);
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      'Do not lose my draft.',
    );
    expect(document.activeElement?.textContent).toBe('Comment deleted.');
    read().flush({ articleId: 1, comments: [other], total: 1, nextCursor: null });
    await fixture.whenStable();
    expect(countChanged).toHaveBeenLastCalledWith(1);
    expect(items()).toHaveLength(1);
  });
  it('keeps a confirmed deletion removed when refreshing fails and distinguishes an already missing comment', async () => {
    read().flush(commentPageFixture());
    await fixture.whenStable();
    await session();
    button('Delete comment').click();
    await fixture.whenStable();
    button('Permanently delete comment').click();
    http
      .expectOne('/api/articles/article-1/comments/1')
      .flush(null, { status: 404, statusText: 'Missing' });
    await fixture.whenStable();
    expect(items()).toHaveLength(0);
    expect(element.textContent).toContain('This comment is no longer available');
    expect(element.textContent).not.toContain('Comment deleted.');
    read().flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(items()).toHaveLength(0);
    expect(countChanged).toHaveBeenCalledTimes(1);
    button('Try again').click();
    read().flush({ articleId: 1, comments: [], total: 0, nextCursor: null });
    await fixture.whenStable();
    expect(countChanged).toHaveBeenLastCalledWith(0);
  });
  it('cancels a stale in-flight read on deletion so it cannot restore the deleted row', async () => {
    read().flush(commentPageFixture());
    await fixture.whenStable();
    await session();
    button('Delete comment').click();
    await fixture.whenStable();
    button('Permanently delete comment').click();
    const deletion = http.expectOne('/api/articles/article-1/comments/1');
    button('Refresh comments').click();
    const stale = read();
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(stale.cancelled).toBe(true);
    expect(items()).toHaveLength(0);
    read().flush({ articleId: 1, comments: [], total: 0, nextCursor: null });
    await fixture.whenStable();
  });
  it('requires a successful refresh and another explicit confirmation after an uncertain deletion', async () => {
    read().flush(commentPageFixture());
    await fixture.whenStable();
    await session();
    button('Delete comment').click();
    await fixture.whenStable();
    button('Permanently delete comment').click();
    http
      .expectOne('/api/articles/article-1/comments/1')
      .flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(items()).toHaveLength(1);
    expect(button('Permanently delete comment').disabled).toBe(true);
    button('Reload comments').click();
    read().flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(button('Permanently delete comment').disabled).toBe(true);
    button('Reload comments').click();
    read().flush(commentPageFixture());
    await fixture.whenStable();
    expect(button('Permanently delete comment')).toBeUndefined();
    http.expectNone((request) => request.method === 'DELETE');
    button('Delete comment').click();
    await fixture.whenStable();
    button('Permanently delete comment').click();
    http
      .expectOne('/api/articles/article-1/comments/1')
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    read().flush({ articleId: 1, comments: [], total: 0, nextCursor: null });
    await fixture.whenStable();
  });
  it('does not resurrect a deleted row when an earlier creation replay returns late', async () => {
    read().flush({ articleId: 1, comments: [], total: 0, nextCursor: null });
    await fixture.whenStable();
    await session();
    await write(commentFixture().body);
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    http
      .expectOne((request) => request.method === 'POST')
      .flush(null, { status: 500, statusText: 'Unknown' });
    await fixture.whenStable();
    button('Refresh comments').click();
    read().flush(commentPageFixture());
    await fixture.whenStable();
    button('Retry same comment').click();
    const replay = http.expectOne((request) => request.method === 'POST');
    button('Delete comment').click();
    await fixture.whenStable();
    button('Permanently delete comment').click();
    http
      .expectOne('/api/articles/article-1/comments/1')
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    const stale = read();
    replay.flush({ comment: commentFixture() }, { status: 200, statusText: 'Replayed' });
    await fixture.whenStable();
    expect(stale.cancelled).toBe(true);
    expect(items()).toHaveLength(0);
    read().flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(items()).toHaveLength(0);
    expect(element.textContent).toContain('already removed');
  });
});
