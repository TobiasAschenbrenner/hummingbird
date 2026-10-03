import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { Auth } from '../../services/auth/auth';
import { articleFixture } from '../../../testing/article-fixtures';
import { ArticleDetail } from './article-detail';

describe('ArticleDetail', () => {
  let fixture: ComponentFixture<ArticleDetail>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ slug: 'article-1' }));
    query = new BehaviorSubject(convertToParamMap({ page: '2' }));
    await TestBed.configureTestingModule({
      imports: [ArticleDetail],
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
    fixture = TestBed.createComponent(ArticleDetail);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('shows progress, then the article body, public relations and a descriptive title', async () => {
    expect(element.querySelector('h1')?.textContent).toContain('Loading article');
    expect(element.querySelector('[role="status"]')).not.toBeNull();
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article 1');
    expect(element.querySelector('.article-body')?.textContent).toBe(
      'First paragraph.\n\nSecond paragraph.',
    );
    expect(element.textContent).toContain('Author 🐦');
    expect(element.textContent).toContain('Tech');
    expect(element.textContent).toContain('Databases');
    expect(element.textContent).toContain('1 comment');
    expect(TestBed.inject(Title).getTitle()).toBe('Hummingbird | Article 1');
    expect(element.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('preserves the originating list page and updates the back link without refetching', async () => {
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await fixture.whenStable();
    expect(element.querySelector('.back-link')?.getAttribute('href')).toBe('/?page=2');
    query.next(convertToParamMap({ page: '3' }));
    await fixture.whenStable();
    expect(element.querySelector('.back-link')?.getAttribute('href')).toBe('/?page=3');
    query.next(convertToParamMap({ page: '0' }));
    await fixture.whenStable();
    expect(element.querySelector('.back-link')?.getAttribute('href')).toBe('/');
    http.expectNone('/api/articles/article-1');
  });

  it('renders angle brackets and script-like bodies as plain text', async () => {
    const body = '<img src=x onerror=alert(1)>\n\n<script>unsafe()</script>';
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture({ body }) });
    await fixture.whenStable();
    expect(element.querySelector('.article-body')?.textContent).toBe(body);
    expect(element.querySelector('img, script')).toBeNull();
  });

  it('shows a useful missing-article page for a 404 and can recover on slug navigation', async () => {
    http
      .expectOne('/api/articles/article-1')
      .flush({ error: { message: 'Article not found.' } }, { status: 404, statusText: 'Missing' });
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article not found');
    expect(element.querySelector('button')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Hummingbird | Article not found');
    params.next(convertToParamMap({ slug: 'article-2' }));
    http
      .expectOne('/api/articles/article-2')
      .flush({ article: articleFixture({ id: 2, slug: 'article-2', title: 'Article 2' }) });
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article 2');
  });

  it('does not send malformed slugs to the API', async () => {
    const initial = http.expectOne('/api/articles/article-1');
    for (const slug of ['../auth/logout', 'Uppercase', 'a'.repeat(81), 'article--1']) {
      params.next(convertToParamMap({ slug }));
      await fixture.whenStable();
      expect(element.querySelector('h1')?.textContent).toBe('Article not found');
      http.expectNone((request) => request.url.startsWith('/api/articles'));
    }
    expect(initial.cancelled).toBe(true);
  });

  it('uses safe error messages and permits a single retry after server failure', async () => {
    http
      .expectOne('/api/articles/article-1')
      .flush(
        { error: { message: 'private database details' } },
        { status: 500, statusText: 'Failed' },
      );
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article unavailable');
    expect(element.textContent).not.toContain('private database');
    const retry = element.querySelector<HTMLButtonElement>('button')!;
    retry.click();
    retry.click();
    fixture.detectChanges();
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article 1');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('turns a malformed success response into a retryable error rather than broken content', async () => {
    http.expectOne('/api/articles/article-1').flush({ article: { id: 1 } });
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article unavailable');
    expect(element.querySelector('.article-body')).toBeNull();
  });

  it('cancels the old slug request and clears stale content when the slug changes', async () => {
    const first = http.expectOne('/api/articles/article-1');
    params.next(convertToParamMap({ slug: 'article-2' }));
    expect(first.cancelled).toBe(true);
    http
      .expectOne('/api/articles/article-2')
      .flush({ article: articleFixture({ id: 2, slug: 'article-2', title: 'Article 2' }) });
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Article 2');
    params.next(convertToParamMap({ slug: 'article-3' }));
    fixture.detectChanges();
    expect(element.querySelector('h1')?.textContent).toContain('Loading article');
    expect(element.querySelector('.article-body')).toBeNull();
    http
      .expectOne('/api/articles/article-3')
      .flush({ article: articleFixture({ id: 3, slug: 'article-3', title: 'Article 3' }) });
    await fixture.whenStable();
  });

  it('cancels pending article loads when the page is destroyed', () => {
    const request = http.expectOne('/api/articles/article-1');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });

  it('shows the edit link only for the signed-in author and preserves the list page', async () => {
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await fixture.whenStable();
    expect(element.querySelector('a[href*="/edit"]')).toBeNull();
    const auth = TestBed.inject(Auth);
    auth.restoreSession().subscribe();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 1, username: 'Author', email: 'author@example.test' } });
    await fixture.whenStable();
    expect(element.querySelector('a[href*="/edit"]')?.getAttribute('href')).toBe(
      '/articles/article-1/edit?page=2',
    );
    auth.restoreSession().subscribe();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 2, username: 'Other', email: 'other@example.test' } });
    await fixture.whenStable();
    expect(element.querySelector('a[href*="/edit"]')).toBeNull();
  });
});
