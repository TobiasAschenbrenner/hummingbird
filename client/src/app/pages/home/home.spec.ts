import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

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
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Loading articles');
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
    const retry = element.querySelector<HTMLButtonElement>('button')!;
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
});
