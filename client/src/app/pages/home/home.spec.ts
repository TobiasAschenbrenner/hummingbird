import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { CatalogsApi } from '../../services/catalogs/catalogs';
import { BehaviorSubject, of } from 'rxjs';

import { articlePageFixture } from '../../../testing/article-fixtures';
import { Home } from './home';

const listUrl = (page = 1) => `/api/articles?page=${page}&pageSize=12`;

describe('Home article list', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: CatalogsApi,
          useValue: {
            articleOptions: () =>
              of({
                categories: [{ id: 1, slug: 'tech', name: 'Tech' }],
                tags: [{ id: 1, slug: 'databases', name: 'Databases' }],
              }),
          },
        },
        { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Home);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('shows loading before displaying cards, relations and UTC dates', async () => {
    expect(element.textContent).toContain('Loading articles');
    expect(element.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    http.expectOne(listUrl()).flush(articlePageFixture());
    await fixture.whenStable();
    expect(element.querySelector('h3')?.textContent).toContain('Article 1');
    expect(element.textContent).toContain('Author 🐦');
    expect(element.textContent).toContain('Tech');
    expect(element.textContent).toContain('Databases');
    expect(element.textContent).toContain('1 comment');
    expect(element.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-01T09:00:00.000Z',
    );
    expect(element.querySelector('a[href="/articles/article-1"]')).not.toBeNull();
    expect(element.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(element.querySelector('[aria-label="Next article page"]')).toBeNull();
    http.expectNone('/api/health');
  });

  it('shows an empty catalog without pagination or broken image placeholders', async () => {
    http.expectOne(listUrl()).flush(articlePageFixture(1, 0));
    await fixture.whenStable();
    expect(element.textContent).toContain('No articles yet');
    expect(element.querySelector('app-article-card')).toBeNull();
    expect(element.querySelector('nav')).toBeNull();
    expect(element.querySelector('img')).toBeNull();
  });

  it('keeps pagination in the URL and carries the second page into article links', async () => {
    const first = http.expectOne(listUrl());
    first.flush(articlePageFixture(1, 13));
    await fixture.whenStable();
    expect(element.querySelector('[aria-label="Next article page"]')?.getAttribute('href')).toBe(
      '/?page=2',
    );
    params.next(convertToParamMap({ page: '2' }));
    http.expectOne(listUrl(2)).flush(articlePageFixture(2, 13));
    await fixture.whenStable();
    expect(element.querySelectorAll('app-article-card').length).toBe(1);
    expect(element.querySelector('h3 a')?.getAttribute('href')).toBe('/articles/article-13?page=2');
    expect(
      element.querySelector('[aria-label="Previous article page"]')?.getAttribute('href'),
    ).toBe('/');
    expect(element.textContent).toContain('Page 2 of 2');
    expect(element.querySelector('[aria-label="Next article page"]')).toBeNull();
  });

  it('offers the first page when a valid page is beyond the catalog', async () => {
    const first = http.expectOne(listUrl());
    params.next(convertToParamMap({ page: '4' }));
    expect(first.cancelled).toBe(true);
    http.expectOne(listUrl(4)).flush(articlePageFixture(4, 3));
    await fixture.whenStable();
    expect(element.textContent).toContain('No articles on this page');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(element.querySelector('nav')).toBeNull();
  });

  it('rejects invalid or repeated page parameters without forwarding them to the API', async () => {
    const first = http.expectOne(listUrl());
    for (const page of ['', '0', '-1', '01', '1.5', '1e2', '10001', ['1', '2']]) {
      params.next(convertToParamMap({ page }));
      await fixture.whenStable();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('1 to 10,000');
      http.expectNone((request) => request.url === '/api/articles');
    }
    expect(first.cancelled).toBe(true);
    params.next(convertToParamMap({ page: '10000' }));
    http.expectOne(listUrl(10000)).flush(articlePageFixture(10000, 1));
    await fixture.whenStable();
    expect(element.textContent).toContain('No articles on this page');
  });

  it('shows safe failures and allows a single retry without exposing server details', async () => {
    http
      .expectOne(listUrl())
      .flush({ error: { message: 'private SQL details' } }, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Please try again');
    expect(element.textContent).not.toContain('private SQL');
    const retry = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Try again',
    )!;
    retry.click();
    retry.click();
    fixture.detectChanges();
    http.expectOne(listUrl()).flush(articlePageFixture());
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('h3')?.textContent).toContain('Article 1');
  });

  it('renders untrusted article labels as text, not HTML', async () => {
    const data = articlePageFixture();
    data.articles[0]!.title = '<img src=x onerror=alert(1)> Article';
    data.articles[0]!.description = '<script>unsafe()</script>';
    http.expectOne(listUrl()).flush(data);
    await fixture.whenStable();
    expect(element.textContent).toContain('<img src=x');
    expect(element.textContent).toContain('<script>unsafe()');
    expect(element.querySelector('img, script')).toBeNull();
  });

  it('cancels stale page requests and pending requests on destruction', async () => {
    const first = http.expectOne(listUrl());
    params.next(convertToParamMap({ page: '2' }));
    expect(first.cancelled).toBe(true);
    const second = http.expectOne(listUrl(2));
    fixture.destroy();
    expect(second.cancelled).toBe(true);
  });

  it('hydrates combined filters and keeps them on pagination and detail links', async () => {
    const original = http.expectOne(listUrl());
    params.next(convertToParamMap({ page: '2', q: ' SQL ', category: 'tech', tag: 'databases' }));
    expect(original.cancelled).toBe(true);
    const request = http.expectOne((request) => request.url === '/api/articles');
    expect(request.request.params.get('q')).toBe('SQL');
    expect(request.request.params.get('category')).toBe('tech');
    expect(request.request.params.get('tag')).toBe('databases');
    request.flush(articlePageFixture(2, 25));
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('SQL');
    expect(element.querySelector('h3 a')?.getAttribute('href')).toBe(
      '/articles/article-13?page=2&q=SQL&category=tech&tag=databases',
    );
    expect(
      element.querySelector('[aria-label="Previous article page"]')?.getAttribute('href'),
    ).toBe('/?q=SQL&category=tech&tag=databases');
    expect(element.querySelector('[aria-label="Next article page"]')?.getAttribute('href')).toBe(
      '/?page=3&q=SQL&category=tech&tag=databases',
    );
    expect(element.textContent).toContain('25 articles matching your filters');
  });

  it('applies filters only on submit and resets pagination, then clears all filters', async () => {
    http.expectOne(listUrl()).flush(articlePageFixture());
    await fixture.whenStable();
    params.next(convertToParamMap({ page: '2' }));
    http.expectOne(listUrl(2)).flush(articlePageFixture(2, 13));
    await fixture.whenStable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const input = element.querySelector<HTMLInputElement>('input')!;
    input.value = '  SQL  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const category = element.querySelector<HTMLSelectElement>('#category-filter')!;
    category.value = 'tech';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const tag = element.querySelector<HTMLSelectElement>('#tag-filter')!;
    tag.value = 'databases';
    tag.dispatchEvent(new Event('change', { bubbles: true }));
    http.expectNone((request) => request.url === '/api/articles');
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/'], {
      queryParams: { q: 'SQL', category: 'tech', tag: 'databases' },
    });
    element.querySelector<HTMLButtonElement>('.clear')!.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenLastCalledWith(['/'], { queryParams: {} });
  });

  it('distinguishes no matching results from an empty unfiltered catalog', async () => {
    const original = http.expectOne(listUrl());
    params.next(convertToParamMap({ q: 'missing' }));
    expect(original.cancelled).toBe(true);
    http.expectOne((request) => request.url === '/api/articles').flush(articlePageFixture(1, 0));
    await fixture.whenStable();
    expect(element.textContent).toContain('No articles match these filters');
    expect(element.textContent).not.toContain('No articles yet');
    expect(element.querySelector('nav')).toBeNull();
  });

  it('rejects malformed or repeated filters and recovers when browser history restores a valid URL', async () => {
    const original = http.expectOne(listUrl());
    for (const query of [
      { q: ['first', 'second'] },
      { q: 'a'.repeat(101) },
      { q: 'bad\ntext' },
      { category: '' },
      { category: 'Tech' },
      { tag: ['databases', 'web'] },
      { tag: 'two--hyphens' },
      { unknown: 'ignored' },
      { 'category[]': 'tech' },
    ]) {
      params.next(convertToParamMap(query));
      await fixture.whenStable();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('valid search/filter');
      http.expectNone((request) => request.url === '/api/articles');
    }
    expect(original.cancelled).toBe(true);
    params.next(convertToParamMap({ q: '🐦'.repeat(100), tag: 'databases' }));
    const restored = http.expectOne((request) => request.url === '/api/articles');
    expect(restored.request.params.get('q')).toBe('🐦'.repeat(100));
    restored.flush(articlePageFixture());
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('returns an out-of-range filtered page to page one without dropping its filters', async () => {
    http.expectOne(listUrl());
    params.next(convertToParamMap({ page: '4', category: 'tech' }));
    http.expectOne((request) => request.url === '/api/articles').flush(articlePageFixture(4, 3));
    await fixture.whenStable();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/?category=tech');
  });

  it('cancels older filter reads and retries the applied query without resetting an unsubmitted search', async () => {
    const original = http.expectOne(listUrl());
    params.next(convertToParamMap({ q: 'first' }));
    const first = http.expectOne((request) => request.url === '/api/articles');
    params.next(convertToParamMap({ q: 'second' }));
    expect(original.cancelled).toBe(true);
    expect(first.cancelled).toBe(true);
    http
      .expectOne((request) => request.params.get('q') === 'second')
      .flush(null, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    const field = element.querySelector<HTMLInputElement>('input')!;
    field.value = 'Unsubmitted';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Try again')!
      .click();
    http.expectOne((request) => request.params.get('q') === 'second').flush(articlePageFixture());
    await fixture.whenStable();
    expect(field.value).toBe('Unsubmitted');
  });

  it('keeps current results and shows a safe message when filter navigation fails', async () => {
    http.expectOne(listUrl()).flush(articlePageFixture());
    await fixture.whenStable();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockRejectedValue(
      new Error('Internal navigation details'),
    );
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(element.textContent).toContain('We couldn’t update the filters');
    expect(element.textContent).not.toContain('Internal navigation');
    expect(element.querySelector('h3')?.textContent).toContain('Article 1');
    http.expectNone((request) => request.url === '/api/articles');
  });
});
