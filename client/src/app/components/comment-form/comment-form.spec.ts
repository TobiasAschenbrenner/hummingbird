import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../services/auth/auth';
import { commentFixture } from '../../../testing/comment-fixtures';
import { CommentForm } from './comment-form';

describe('CommentForm', () => {
  let fixture: ComponentFixture<CommentForm>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let auth: Auth;
  let posted = vi.fn<(comment: unknown) => void>();
  const button = (text: string) =>
    [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    )!;
  const text = () => element.querySelector<HTMLTextAreaElement>('textarea')!;
  async function session(id = 1): Promise<void> {
    auth.restoreSession().subscribe();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id, username: 'Reader', email: 'reader@example.test' } });
    await fixture.whenStable();
  }
  async function write(body: string): Promise<void> {
    text().value = body;
    text().dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }
  function submit(): void {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  function request() {
    return http.expectOne('/api/articles/article-1/comments');
  }
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommentForm],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    fixture = TestBed.createComponent(CommentForm);
    element = fixture.nativeElement;
    fixture.componentRef.setInput('slug', 'article-1');
    fixture.componentRef.setInput('articleId', 1);
    posted = vi.fn();
    fixture.componentInstance.posted.subscribe(posted);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('prompts public readers to sign in and opens a form only after authentication', async () => {
    expect(element.querySelector('form')).toBeNull();
    auth.expireSession();
    await fixture.whenStable();
    expect(element.textContent).toContain('Sign in to join');
    expect(element.querySelector('a')?.getAttribute('target')).toBe('_blank');
    await session();
    expect(element.querySelector('form')).not.toBeNull();
  });
  it('validates blank, malformed, unsafe and oversized text, counting Unicode characters correctly', async () => {
    await session();
    for (const body of [' \t\n ', '\ud800', 'bad\u0000text', '🐦'.repeat(2001)]) {
      await write(body);
      submit();
      await fixture.whenStable();
      http.expectNone((request) => request.method === 'POST');
      expect(element.querySelector('[aria-invalid="true"]')).not.toBeNull();
    }
    await write('🐦'.repeat(2000));
    expect(element.textContent).toContain('2000 / 2,000');
    submit();
    const req = request();
    expect(req.request.body.body).toBe('🐦'.repeat(2000));
    req.flush(
      { comment: commentFixture({ body: '🐦'.repeat(2000) }) },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
  });
  it('preserves whitespace, prevents duplicate submits, clears only confirmed drafts and starts the next comment with a new key', async () => {
    await session();
    const body = '  Thank you 🐦!\n\nPlain text.  ';
    await write(body);
    submit();
    submit();
    fixture.detectChanges();
    const first = request();
    expect(first.request.body.articleId).toBe(1);
    expect(first.request.body.body).toBe(body);
    expect(first.request.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(button('Posting…').disabled).toBe(true);
    expect(text().readOnly).toBe(true);
    expect(posted).not.toHaveBeenCalled();
    first.flush({ comment: commentFixture({ body }) }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(text().value).toBe('');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Comment posted');
    expect(posted).toHaveBeenCalledTimes(1);
    await write(body);
    submit();
    const next = request();
    expect(next.request.body.requestId).not.toBe(first.request.body.requestId);
    next.flush(
      { comment: commentFixture({ id: 2, body }) },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
  });
  it('freezes an uncertain draft and reuses the exact key and text only on explicit retry', async () => {
    await session();
    const body = 'Retry without duplication.';
    await write(body);
    submit();
    const original = request();
    original.flush({ error: { message: 'private SQL' } }, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(text().value).toBe(body);
    expect(text().readOnly).toBe(true);
    expect(element.textContent).not.toContain('private SQL');
    expect(button('Post comment').disabled).toBe(true);
    submit();
    http.expectNone((request) => request.method === 'POST');
    button('Retry same comment').click();
    const retry = request();
    expect(retry.request.body).toEqual(original.request.body);
    retry.flush({ comment: commentFixture({ body }) }, { status: 200, statusText: 'Replayed' });
    await fixture.whenStable();
    expect(posted).toHaveBeenCalledTimes(1);
    expect(text().value).toBe('');
  });
  it('retains uncertainty through session expiry and allows retry only as the original account', async () => {
    await session();
    await write('Keep this uncertain submission.');
    submit();
    const first = request();
    first.error(new ProgressEvent('network'));
    await fixture.whenStable();
    button('Retry same comment').click();
    request().flush(null, { status: 401, statusText: 'Expired' });
    await fixture.whenStable();
    expect(auth.status()).toBe('anonymous');
    expect(text().value).toBe('Keep this uncertain submission.');
    button('Check session').click();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 2, username: 'Other', email: 'other@example.test' } });
    await fixture.whenStable();
    expect(button('Retry same comment').disabled).toBe(true);
    expect(element.textContent).toContain('account that submitted');
    await session();
    button('Retry same comment').click();
    const retry = request();
    expect(retry.request.body).toEqual(first.request.body);
    retry.flush(
      { comment: commentFixture({ body: 'Keep this uncertain submission.' }) },
      { status: 200, statusText: 'Replayed' },
    );
    await fixture.whenStable();
  });
  it('preserves a definitely rejected draft through login and does not submit during session checking', async () => {
    await session();
    await write('Keep my draft.');
    submit();
    request().flush(null, { status: 401, statusText: 'Expired' });
    await fixture.whenStable();
    expect(text().value).toBe('Keep my draft.');
    expect(button('Post comment').disabled).toBe(true);
    button('Check session').click();
    submit();
    http.expectNone((request) => request.method === 'POST');
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 1, username: 'Reader', email: 'reader@example.test' } });
    await fixture.whenStable();
    expect(button('Post comment').disabled).toBe(false);
  });
  it('treats malformed success as uncertain rather than clearing or publishing a draft', async () => {
    await session();
    await write('Keep after invalid confirmation.');
    submit();
    request().flush({ comment: { id: 1 } }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(text().value).toBe('Keep after invalid confirmation.');
    expect(button('Retry same comment')).toBeDefined();
    expect(posted).not.toHaveBeenCalled();
  });
  it('retains text and prevents further posts after forbidden, missing or conflicting targets', async () => {
    for (const status of [403, 404, 409, 415]) {
      fixture.componentRef.setInput('articleId', status);
      await fixture.whenStable();
      await session();
      await write('Copy this draft.');
      submit();
      request().flush({ error: { message: 'private' } }, { status, statusText: 'Rejected' });
      await fixture.whenStable();
      expect(text().value).toBe('Copy this draft.');
      expect(button('Post comment').disabled).toBe(true);
      expect(element.textContent).not.toContain('private');
      submit();
      http.expectNone((request) => request.method === 'POST');
    }
  });
  it('permits a manual retry after rate limiting with the same key and allows correcting definite field rejection', async () => {
    await session();
    await write('First draft.');
    submit();
    const first = request();
    first.flush(null, { status: 429, statusText: 'Limited' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Wait a minute');
    submit();
    const second = request();
    expect(second.request.body.requestId).toBe(first.request.body.requestId);
    second.flush(null, { status: 400, statusText: 'Invalid' });
    await fixture.whenStable();
    await write('Corrected draft.');
    submit();
    const corrected = request();
    expect(corrected.request.body.requestId).not.toBe(first.request.body.requestId);
    corrected.flush(
      { comment: commentFixture({ body: 'Corrected draft.' }) },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
  });
  it('disables posts while unavailable and cancels requests when changing articles or destroying the form', async () => {
    await session();
    await write('A draft.');
    fixture.componentRef.setInput('available', false);
    await fixture.whenStable();
    submit();
    http.expectNone((request) => request.method === 'POST');
    fixture.componentRef.setInput('available', true);
    await fixture.whenStable();
    submit();
    const first = request();
    fixture.componentRef.setInput('articleId', 2);
    fixture.componentRef.setInput('slug', 'article-2');
    await fixture.whenStable();
    expect(first.cancelled).toBe(true);
    expect(text().value).toBe('');
    await write('Another draft.');
    submit();
    const next = http.expectOne('/api/articles/article-2/comments');
    fixture.destroy();
    expect(next.cancelled).toBe(true);
    expect(posted).not.toHaveBeenCalled();
  });
});
