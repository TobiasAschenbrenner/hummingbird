import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from './app.routes';
import { Login } from './pages/login/login';
import { Register } from './pages/register/register';
import { Home } from './pages/home/home';
import { NotFound } from './pages/not-found/not-found';
import { ArticleDetail } from './pages/article-detail/article-detail';
import { ArticleCreate } from './pages/article-create/article-create';
import { Auth } from './services/auth/auth';
import { articleFixture, articlePageFixture } from '../testing/article-fixtures';

describe('Application routes', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('opens the homepage at the root URL', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', Home);
    http.expectOne('/api/articles?page=1&pageSize=12').flush(articlePageFixture());
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(
      'The Hummingbird Blog',
    );
    expect(document.title).toBe('Hummingbird | Home');
  });

  it('opens the account pages with their own titles and accessible headings', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login', Login);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Log in');
    expect(document.title).toBe('Hummingbird | Log in');
    await harness.navigateByUrl('/register', Register);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Create an account');
    expect(document.title).toBe('Hummingbird | Register');
  });

  it('shows the registration confirmation on the login page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login?registered=1', Login);
    expect(harness.routeNativeElement?.querySelector('[role="status"]')?.textContent).toContain(
      'Account created',
    );
  });

  it('opens an article directly and updates its title after loading', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/articles/article-1', ArticleDetail);
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture() });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Article 1');
    expect(document.title).toBe('Hummingbird | Article 1');
  });

  it('preserves page two through an article visit and the back-to-articles link', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/?page=2', Home);
    http.expectOne('/api/articles?page=2&pageSize=12').flush(articlePageFixture(2, 13));
    await harness.fixture.whenStable();
    const articleLink = harness.routeNativeElement?.querySelector('h3 a')?.getAttribute('href');
    expect(articleLink).toBe('/articles/article-13?page=2');
    await harness.navigateByUrl(articleLink!, ArticleDetail);
    http
      .expectOne('/api/articles/article-13')
      .flush({ article: articleFixture({ id: 13, slug: 'article-13', title: 'Article 13' }) });
    await harness.fixture.whenStable();
    const backLink = harness.routeNativeElement?.querySelector('.back-link')?.getAttribute('href');
    expect(backLink).toBe('/?page=2');
    await harness.navigateByUrl(backLink!, Home);
    http.expectOne('/api/articles?page=2&pageSize=12').flush(articlePageFixture(2, 13));
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('h3')?.textContent).toContain('Article 13');
    expect(document.title).toBe('Hummingbird | Home');
  });

  it('shows a useful fallback for unknown URLs and links back home', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/missing/page', NotFound);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Page not found');
    expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(document.title).toBe('Hummingbird | Page not found');
  });

  it('opens the editor with a sign-in prompt at its own URL', async () => {
    TestBed.inject(Auth).restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/new-article', ArticleCreate);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('New article');
    expect(document.title).toBe('Hummingbird | New article');
    expect(harness.routeNativeElement?.querySelector('form')).toBeNull();
    http.expectNone('/api/categories');
  });

  it('still reads an article whose slug is new rather than opening the editor', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/articles/new', ArticleDetail);
    http.expectOne('/api/articles/new').flush({ article: articleFixture({ slug: 'new' }) });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('.article-body')).not.toBeNull();
  });
});
