import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Auth } from '../../services/auth/auth';
import { articleFixture } from '../../../testing/article-fixtures';
import { ArticleEdit } from './article-edit';

const user = { id: 1, username: 'Author', email: 'author@example.test' };
const category = { id: 1, slug: 'tech', name: 'Tech' };
const design = { id: 2, slug: 'design', name: 'Design' };
const tag = { id: 1, slug: 'databases', name: 'Databases' };

describe('ArticleEdit', () => {
  let fixture: ComponentFixture<ArticleEdit>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let auth: Auth;
  let router: Router;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ slug: 'article-1' }));
    query = new BehaviorSubject(convertToParamMap({ page: '2' }));
    await TestBed.configureTestingModule({
      imports: [ArticleEdit],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: query.asObservable() },
        },
      ],
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
  function start(mode: 'authenticated' | 'anonymous' | 'other' | 'checking' = 'authenticated') {
    if (mode !== 'checking') {
      auth.restoreSession().subscribe();
      const session = http.expectOne('/api/auth/me');
      if (mode === 'anonymous') session.flush(null, { status: 401, statusText: 'Anonymous' });
      else session.flush({ user: mode === 'other' ? { ...user, id: 2 } : user });
    }
    fixture = TestBed.createComponent(ArticleEdit);
    element = fixture.nativeElement;
    fixture.detectChanges();
  }
  async function options(categories = [category, design], tags = [tag]) {
    http.expectOne('/api/categories').flush({ categories });
    http.expectOne('/api/tags').flush({ tags });
    await fixture.whenStable();
  }
  async function ready(article = articleFixture()) {
    http.expectOne('/api/articles/article-1').flush({ article });
    await fixture.whenStable();
    await options();
  }
  function input(name: string) {
    return element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  }
  function setInput(name: string, value: string) {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }
  function button(label: string) {
    return Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    )!;
  }
  function submit() {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }
  function selectCategory(label: string) {
    const select = element.querySelector<HTMLSelectElement>('select')!;
    select.value = Array.from(select.options).find((option) => option.textContent === label)!.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  }
  async function conflict() {
    submit();
    http
      .expectOne('/api/articles/article-1')
      .flush(
        { error: { fields: { version: 'Changed' } } },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
  }

  it('loads existing values, fixes the slug and validates the existing category and tag selection', async () => {
    start();
    expect(element.textContent).toContain('Loading article');
    await ready();
    expect(input('title').value).toBe('Article 1');
    expect(input('body').value).toBe('First paragraph.\n\nSecond paragraph.');
    expect((input('slug') as HTMLInputElement).readOnly).toBe(true);
    setInput('title', 'Changed title');
    expect(input('slug').value).toBe('article-1');
    expect(element.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
    expect(button('Save changes').disabled).toBe(false);
    expect(element.querySelector('a[href*="article-1?page=2"]')).not.toBeNull();
  });

  it.each(['anonymous', 'other', 'checking'] as const)(
    'does not open the editor or load catalogs for %s sessions',
    async (mode) => {
      start(mode);
      http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
      await fixture.whenStable();
      expect(element.querySelector('form')).toBeNull();
      if (mode === 'other') expect(element.textContent).toContain('Only the author');
      if (mode === 'anonymous') expect(element.querySelector('a[href="/login"]')).not.toBeNull();
      http.expectNone('/api/categories');
      http.expectNone((request) => request.method === 'PUT');
    },
  );

  it('shows missing and failed loads, retries failures and cancels reads when the slug changes', async () => {
    start();
    const first = http.expectOne('/api/articles/article-1');
    params.next(convertToParamMap({ slug: 'article-2' }));
    expect(first.cancelled).toBe(true);
    http.expectOne('/api/articles/article-2').flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    button('Try again').click();
    http.expectOne('/api/articles/article-2').flush(null, { status: 404, statusText: 'Missing' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Article not found');
    params.next(convertToParamMap({ slug: 'invalid--slug' }));
    await fixture.whenStable();
    http.expectNone((request) => request.url.startsWith('/api/articles'));
  });

  it('blocks invalid text and saves the exact version only once, preserving the list page', async () => {
    start();
    await ready(articleFixture({ version: '9007199254740993' }));
    setInput('title', '🐦'.repeat(56));
    submit();
    expect(element.querySelector('#title-error')).not.toBeNull();
    http.expectNone((request) => request.method === 'PUT');
    setInput('title', '  Edited title  ');
    setInput('body', '  Edited 🐦\n\n\tParagraph.  ');
    selectCategory('Design');
    element.querySelector<HTMLInputElement>('[type="checkbox"]')!.click();
    fixture.detectChanges();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    query.next(convertToParamMap({ page: '3', q: 'SQL', category: 'tech', tag: 'databases' }));
    await fixture.whenStable();
    submit();
    submit();
    const request = http.expectOne('/api/articles/article-1');
    expect(request.request.body).toEqual({
      title: 'Edited title',
      description: 'A useful introduction.',
      body: '  Edited 🐦\n\n\tParagraph.  ',
      categoryId: 2,
      tagIds: [],
      version: '9007199254740993',
    });
    expect(element.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    request.flush({
      article: articleFixture({ title: 'Edited title', version: '9007199254740994' }),
    });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/articles', 'article-1'], {
      queryParams: { page: 3, q: 'SQL', category: 'tech', tag: 'databases' },
    });
    expect(element.textContent).toContain('Your changes were saved');
    expect(element.querySelector('form')).toBeNull();
  });

  it('keeps a conflicting draft and requires an explicit review before using the latest version for a save', async () => {
    start();
    await ready();
    setInput('body', 'My unsaved draft.');
    await conflict();
    expect(input('body').value).toBe('My unsaved draft.');
    expect(button('Save changes').disabled).toBe(true);
    submit();
    http.expectNone((request) => request.method === 'PUT');
    button('Load latest saved version').click();
    const latest = articleFixture({
      version: '2',
      body: '<script>Latest saved text.</script>',
      title: 'Other edit',
    });
    http.expectOne('/api/articles/article-1').flush({ article: latest });
    await fixture.whenStable();
    expect(element.querySelector('.saved-body')?.textContent).toBe(latest.body);
    expect(element.querySelector('script')).toBeNull();
    expect(input('body').value).toBe('My unsaved draft.');
    expect(button('Save changes').disabled).toBe(true);
    button('Keep my draft after review').click();
    await fixture.whenStable();
    expect(input('body').value).toBe('My unsaved draft.');
    http.expectNone((request) => request.method === 'PUT');
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    submit();
    const request = http.expectOne('/api/articles/article-1');
    expect(request.request.body.version).toBe('2');
    expect(request.request.body.body).toBe('My unsaved draft.');
    request.flush({ article: articleFixture({ body: 'My unsaved draft.', version: '3' }) });
    await fixture.whenStable();
  });

  it('replaces the draft with the reviewed saved version only after the writer chooses it', async () => {
    start();
    await ready();
    setInput('body', 'Discard this draft intentionally.');
    await conflict();
    button('Load latest saved version').click();
    const latest = articleFixture({
      version: '2',
      body: 'Latest content',
      category: design,
      tags: [],
    });
    http.expectOne('/api/articles/article-1').flush({ article: latest });
    await fixture.whenStable();
    button('Use latest saved version').click();
    await fixture.whenStable();
    expect(input('body').value).toBe('Latest content');
    expect(element.querySelector('select')?.value).toContain('2');
    expect(element.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(false);
    expect(button('Save changes').disabled).toBe(false);
    http.expectNone((request) => request.method === 'PUT');
  });

  it('keeps uncertain saves blocked until review, including failed or mismatched confirmations', async () => {
    start();
    await ready();
    setInput('body', 'Keep this draft');
    submit();
    http
      .expectOne('/api/articles/article-1')
      .flush({ error: { message: 'private SQL' } }, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(element.textContent).toContain('couldn’t confirm the save');
    expect(element.textContent).not.toContain('private SQL');
    expect(button('Save changes').disabled).toBe(true);
    button('Load latest saved version').click();
    http
      .expectOne('/api/articles/article-1')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(input('body').value).toBe('Keep this draft');
    button('Load latest saved version').click();
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await fixture.whenStable();
    button('Keep my draft after review').click();
    await fixture.whenStable();
    submit();
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await fixture.whenStable();
    expect(button('Save changes').disabled).toBe(true);
    expect(input('body').value).toBe('Keep this draft');
  });

  it('preserves a draft after session expiry and only resumes editing for the article author', async () => {
    start();
    await ready();
    setInput('body', 'Session-expiry draft');
    submit();
    http.expectOne('/api/articles/article-1').flush(null, { status: 401, statusText: 'Expired' });
    await fixture.whenStable();
    expect(auth.user()).toBeNull();
    expect(input('body').value).toBe('Session-expiry draft');
    expect(element.querySelector('a[href="/login"]')?.getAttribute('target')).toBe('_blank');
    button('Check session').click();
    http.expectOne('/api/auth/me').flush({ user: { ...user, id: 2 } });
    await fixture.whenStable();
    expect(button('Save changes').disabled).toBe(true);
    submit();
    http.expectNone((request) => request.method === 'PUT');
    auth.restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush({ user });
    await fixture.whenStable();
    expect(button('Save changes').disabled).toBe(false);
    expect(input('body').value).toBe('Session-expiry draft');
  });

  it.each([403, 404])('retains text but disables further saves after HTTP %s', async (status) => {
    start();
    await ready();
    setInput('body', 'Do not lose this.');
    submit();
    http.expectOne('/api/articles/article-1').flush(null, { status, statusText: 'Rejected' });
    await fixture.whenStable();
    expect(input('body').value).toBe('Do not lose this.');
    expect(button('Save changes').disabled).toBe(true);
    submit();
    http.expectNone((request) => request.method === 'PUT');
  });

  it('shows safe validation and rate-limit messages and preserves the open draft', async () => {
    start();
    await ready();
    setInput('body', 'My draft');
    for (const status of [400, 413, 415, 429]) {
      submit();
      http.expectOne('/api/articles/article-1').flush(
        {
          error: {
            message: 'private',
            fields: { title: 'Review this title', authorId: 'private' },
          },
        },
        { status, statusText: 'Rejected' },
      );
      await fixture.whenStable();
      expect(input('body').value).toBe('My draft');
      expect(element.textContent).not.toContain('private');
      expect(button('Save changes').disabled).toBe(false);
    }
  });

  it('cancels an update on slug navigation and cancels a review read on component destruction', async () => {
    start();
    await ready();
    submit();
    const request = http.expectOne('/api/articles/article-1');
    params.next(convertToParamMap({ slug: 'article-2' }));
    expect(request.cancelled).toBe(true);
    http
      .expectOne('/api/articles/article-2')
      .flush({ article: articleFixture({ id: 2, slug: 'article-2' }) });
    await fixture.whenStable();
    submit();
    http
      .expectOne('/api/articles/article-2')
      .flush(
        { error: { fields: { version: 'Changed' } } },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    button('Load latest saved version').click();
    const review = http.expectOne('/api/articles/article-2');
    fixture.destroy();
    expect(review.cancelled).toBe(true);
  });

  it('keeps the saved confirmation and link if navigation fails', async () => {
    start();
    await ready();
    vi.spyOn(router, 'navigate').mockRejectedValue(new Error('Navigation failed'));
    submit();
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture({ version: '2' }) });
    await fixture.whenStable();
    expect(element.textContent).toContain('Your changes were saved');
    expect(element.querySelector('a[href="/articles/article-1?page=2"]')).not.toBeNull();
    expect(element.querySelector('form')).toBeNull();
  });
});
