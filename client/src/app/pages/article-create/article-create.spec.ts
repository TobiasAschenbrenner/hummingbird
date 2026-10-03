import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Auth } from '../../services/auth/auth';
import { articleFixture } from '../../../testing/article-fixtures';
import { ArticleCreate } from './article-create';

const user = { id: 1, username: 'Author 🐦', email: 'author@example.test' };
const category = { id: 1, slug: 'tech', name: 'Tech' };
const tag = { id: 1, slug: 'databases', name: 'Databases' };

describe('ArticleCreate', () => {
  let fixture: ComponentFixture<ArticleCreate>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let auth: Auth;
  let router: Router;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleCreate],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    router = TestBed.inject(Router);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function start(
    status: 'authenticated' | 'anonymous' | 'checking' | 'unavailable' = 'authenticated',
  ) {
    if (status !== 'checking') {
      auth.restoreSession().subscribe();
      const request = http.expectOne('/api/auth/me');
      if (status === 'authenticated') request.flush({ user });
      else
        request.flush(null, {
          status: status === 'anonymous' ? 401 : 503,
          statusText: 'Unavailable',
        });
    }
    fixture = TestBed.createComponent(ArticleCreate);
    element = fixture.nativeElement;
    fixture.detectChanges();
  }
  async function options(categories = [category], tags = [tag]) {
    http.expectOne('/api/categories').flush({ categories });
    http.expectOne('/api/tags').flush({ tags });
    await fixture.whenStable();
  }
  function setInput(name: string, value: string) {
    const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[name="${name}"]`,
    )!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }
  function fill() {
    setInput('title', '  My first SQL 🐦 post  ');
    setInput('description', '  A short introduction.  ');
    setInput('body', '  First paragraph.\n\n\tSecond paragraph.  ');
    const select = element.querySelector<HTMLSelectElement>('select')!;
    select.value = Array.from(select.options).find(
      (option) => option.textContent === 'Tech',
    )!.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  }
  function submit() {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }
  const publishButton = () => element.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  it('waits for session restoration and offers sign-in without loading catalogs to anonymous users', async () => {
    start('checking');
    expect(element.textContent).toContain('Checking your session');
    expect(element.querySelector('form')).toBeNull();
    auth.restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(element.querySelector('a[href="/login"]')).not.toBeNull();
    expect(element.querySelector('form')).toBeNull();
    http.expectNone('/api/categories');
    http.expectNone('/api/articles');
  });

  it('can recover an unavailable session before opening the editor', async () => {
    start('unavailable');
    element.querySelector<HTMLButtonElement>('button')!.click();
    const request = http.expectOne('/api/auth/me');
    request.flush({ user });
    await fixture.whenStable();
    await options();
    expect(element.querySelector('form')).not.toBeNull();
    expect(publishButton().disabled).toBe(false);
  });

  it('loads categories and tags before allowing publication', async () => {
    start();
    expect(element.textContent).toContain('Loading categories and tags');
    expect(publishButton().disabled).toBe(true);
    await options();
    expect(element.querySelector('select')?.textContent).toContain('Tech');
    expect(element.textContent).toContain('Databases');
    expect(publishButton().disabled).toBe(false);
  });

  it('keeps typed text while retrying failed option loads and blocks duplicate reloads', async () => {
    start();
    setInput('title', 'Keep this draft');
    const categoryRequest = http.expectOne('/api/categories');
    const tagRequest = http.expectOne('/api/tags');
    categoryRequest.flush(null, { status: 500, statusText: 'Failure' });
    expect(tagRequest.cancelled).toBe(true);
    await fixture.whenStable();
    expect(element.textContent).toContain('Your text is kept here');
    const retry = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry options'),
    )!;
    retry.click();
    retry.click();
    fixture.detectChanges();
    await options();
    expect(element.querySelector<HTMLInputElement>('[name="title"]')!.value).toBe(
      'Keep this draft',
    );
  });

  it('explains empty catalogs, disables publishing without a category and allows no tags', async () => {
    start();
    await options([], []);
    expect(element.textContent).toContain('No categories are available');
    expect(publishButton().disabled).toBe(true);
    submit();
    http.expectNone('/api/articles');
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Refresh categories'))!
      .click();
    await options([category], []);
    expect(element.textContent).toContain('You can publish without tags');
    expect(publishButton().disabled).toBe(false);
  });

  it('suggests ASCII slugs from titles and stops replacing a manually edited slug', async () => {
    start();
    await options();
    setInput('title', ' Café, SQL & 🐦! ');
    expect(element.querySelector<HTMLInputElement>('[name="slug"]')!.value).toBe('cafe-sql');
    setInput('slug', 'custom-url');
    setInput('title', 'A changed title');
    expect(element.querySelector<HTMLInputElement>('[name="slug"]')!.value).toBe('custom-url');
  });

  it('shows accessible field errors and blocks invalid text and URL submissions', async () => {
    start();
    await options();
    submit();
    await fixture.whenStable();
    for (const field of ['title', 'slug', 'description', 'body', 'categoryId']) {
      expect(element.querySelector(`[name="${field}"]`)?.getAttribute('aria-invalid')).toBe('true');
    }
    fill();
    for (const [field, value] of [
      ['title', '🐦'.repeat(56)],
      ['description', 'bad\u0000text'],
      ['body', 'x'.repeat(20_001)],
      ['body', '\ud800'],
      ['slug', 'Bad--URL'],
    ] as const) {
      setInput(field, value);
      submit();
      await fixture.whenStable();
      expect(element.querySelector(`[name="${field}"]`)?.getAttribute('aria-invalid')).toBe('true');
      fill();
      setInput('slug', 'valid-slug');
    }
    http.expectNone('/api/articles');
  });

  it('publishes exactly once with normalized labels, untouched body text and selected tags', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    start();
    await options();
    fill();
    element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    submit();
    const request = http.expectOne('/api/articles');
    expect(request.request.body).toEqual({
      title: 'My first SQL 🐦 post',
      slug: 'my-first-sql-post',
      description: 'A short introduction.',
      body: '  First paragraph.\n\n\tSecond paragraph.  ',
      categoryId: 1,
      tagIds: [1],
    });
    expect(element.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    expect(publishButton().disabled).toBe(true);
    submit();
    http.expectNone('/api/articles');
    request.flush({ article: articleFixture({ ...request.request.body, commentCount: 0 }) });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/articles', 'my-first-sql-post']);
    expect(element.textContent).toContain('Your article was published');
    expect(storage).not.toHaveBeenCalled();
    expect(element.querySelector('form')).toBeNull();
  });

  it('accepts Unicode boundaries and keeps confirmed publication visible if navigation fails', async () => {
    vi.spyOn(router, 'navigate').mockRejectedValue(new Error('Navigation failed'));
    start();
    await options();
    fill();
    setInput('title', '🐦'.repeat(55));
    setInput('slug', 'unicode-article');
    setInput('description', '🐦'.repeat(250));
    setInput('body', '🐦'.repeat(20_000));
    submit();
    const request = http.expectOne('/api/articles');
    request.flush({
      article: articleFixture({ ...request.request.body, tags: [], commentCount: 0 }),
    });
    await fixture.whenStable();
    expect(element.querySelector('a[href="/articles/unicode-article"]')).not.toBeNull();
    expect(element.textContent).toContain('Your article was published');
  });

  it('limits checkbox selections to ten and permits deselecting before choosing another tag', async () => {
    start();
    await options(
      [category],
      Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        slug: `tag-${index + 1}`,
        name: `Tag ${index + 1}`,
      })),
    );
    const checkboxes = Array.from(
      element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    for (const box of checkboxes.slice(0, 10)) {
      box.click();
      fixture.detectChanges();
    }
    expect(checkboxes[10]!.disabled).toBe(true);
    checkboxes[0]!.click();
    fixture.detectChanges();
    expect(checkboxes[10]!.disabled).toBe(false);
    checkboxes[10]!.click();
    fixture.detectChanges();
    expect(checkboxes.filter((box) => box.checked).length).toBe(10);
  });

  it('preserves draft choices but rejects removed categories or tags after a refresh', async () => {
    start();
    await options();
    fill();
    element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Refresh categories'))!
      .click();
    await options([{ id: 2, slug: 'design', name: 'Design' }], []);
    submit();
    await fixture.whenStable();
    expect(element.querySelector('#category-error')).not.toBeNull();
    expect(element.querySelector('#tags-error')).not.toBeNull();
    expect(element.querySelector<HTMLInputElement>('[name="title"]')!.value).toBe(
      'My first SQL 🐦 post',
    );
    http.expectNone('/api/articles');
  });

  it('renders server field errors as text, preserves the draft and offers the conflicting URL', async () => {
    start();
    await options();
    fill();
    submit();
    http.expectOne('/api/articles').flush(
      {
        error: {
          message: 'unused',
          fields: { slug: '<img src=x> Choose another slug.', private: 'secret' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(element.querySelector('#slug-error')?.textContent).toContain('<img src=x>');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).not.toContain('secret');
    const link = element.querySelector('a[href="/articles/my-first-sql-post"]');
    expect(link?.getAttribute('target')).toBe('_blank');
    setInput('slug', 'another-url');
    await fixture.whenStable();
    expect(element.querySelector('#slug-error')).toBeNull();
    expect(element.querySelector<HTMLTextAreaElement>('[name="body"]')!.value).toContain(
      'Second paragraph',
    );
    http.expectNone('/api/articles');
  });

  it('expires the local session on 401 while retaining the editor draft for reauthentication', async () => {
    start();
    await options();
    fill();
    submit();
    http.expectOne('/api/articles').flush(null, { status: 401, statusText: 'Expired' });
    await fixture.whenStable();
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(publishButton().disabled).toBe(true);
    expect(element.querySelector('a[href="/login"]')?.getAttribute('target')).toBe('_blank');
    expect(element.querySelector<HTMLTextAreaElement>('[name="body"]')!.value).toContain(
      'Second paragraph',
    );
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Check session'))!
      .click();
    http.expectOne('/api/auth/me').flush({ user });
    await fixture.whenStable();
    expect(publishButton().disabled).toBe(false);
    expect(element.querySelector<HTMLInputElement>('[name="slug"]')!.value).toBe(
      'my-first-sql-post',
    );
    http.expectNone('/api/articles');
  });

  it('does not assume a failed or malformed confirmation means the article was never saved', async () => {
    start();
    await options();
    fill();
    submit();
    http
      .expectOne('/api/articles')
      .flush({ error: { message: 'private SQL' } }, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Check the article URL before trying again');
    expect(element.textContent).not.toContain('private SQL');
    expect(element.querySelector('a[href="/articles/my-first-sql-post"]')).not.toBeNull();
    expect(publishButton().disabled).toBe(false);
    http.expectNone('/api/articles');
    submit();
    http.expectOne('/api/articles').flush({ article: { id: 1 } });
    await fixture.whenStable();
    expect(element.textContent).toContain('couldn’t confirm publication');
  });

  it('explains rejected, oversized and rate-limited requests without revealing internal messages', async () => {
    start();
    await options();
    fill();
    for (const [status, expected] of [
      [400, 'check your article'],
      [403, 'blocked'],
      [409, 'options changed'],
      [413, 'too large'],
      [415, 'format was rejected'],
      [429, 'Wait a minute'],
    ] as const) {
      submit();
      http
        .expectOne('/api/articles')
        .flush({ error: { message: 'private information' } }, { status, statusText: 'Rejected' });
      await fixture.whenStable();
      expect(element.textContent).toContain(expected);
      expect(element.textContent).not.toContain('private information');
      expect(publishButton().disabled).toBe(false);
    }
  });

  it('blocks submission during a session check and keeps text if that check becomes unavailable', async () => {
    start();
    await options();
    fill();
    auth.restoreSession().subscribe();
    const session = http.expectOne('/api/auth/me');
    fixture.detectChanges();
    expect(publishButton().disabled).toBe(true);
    submit();
    http.expectNone('/api/articles');
    session.flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.querySelector<HTMLTextAreaElement>('[name="body"]')!.value).toContain(
      'Second paragraph',
    );
    expect(publishButton().disabled).toBe(true);
  });

  it('cancels pending publishing when destroyed without automatically resubmitting', async () => {
    start();
    await options();
    fill();
    submit();
    const request = http.expectOne('/api/articles');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
    http.expectNone('/api/articles');
  });

  it('cancels both pending catalog loads when the editor is destroyed', () => {
    start();
    const requests = http.match((request) =>
      ['/api/categories', '/api/tags'].includes(request.url),
    );
    fixture.destroy();
    expect(requests.every((request) => request.cancelled)).toBe(true);
  });

  it('loads options after an account request already in progress fails', async () => {
    auth.restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush({ user });
    auth.logout().subscribe({ error: () => undefined });
    const logout = http.expectOne('/api/auth/logout');
    fixture = TestBed.createComponent(ArticleCreate);
    element = fixture.nativeElement;
    fixture.detectChanges();
    http.expectNone('/api/categories');
    logout.flush(null, { status: 500, statusText: 'Failure' });
    await fixture.whenStable();
    await options();
    expect(publishButton().disabled).toBe(false);
  });

  it('lets the writer remove unavailable tags without discarding tags that still exist', async () => {
    const second = { id: 2, slug: 'web', name: 'Web' };
    start();
    await options([category], [tag, second]);
    fill();
    for (const checkbox of element.querySelectorAll<HTMLInputElement>('[type="checkbox"]')) {
      checkbox.click();
    }
    fixture.detectChanges();
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Refresh categories'))!
      .click();
    await options([category], [second]);
    submit();
    http.expectNone('/api/articles');
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Remove unavailable tags'))!
      .click();
    fixture.detectChanges();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    submit();
    const request = http.expectOne('/api/articles');
    expect(request.request.body.tagIds).toEqual([2]);
    request.flush(articleFixture(request.request.body), { status: 201, statusText: 'Created' });
    await fixture.whenStable();
  });
});
