import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { routes } from './app.routes';
import { Login } from './pages/login/login';
import { Register } from './pages/register/register';
import { Home } from './pages/home/home';
import { NotFound } from './pages/not-found/not-found';
import { HealthApi } from './services/health/health';

describe('Application routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: HealthApi, useValue: { getStatus: () => of({ status: 'ok' }) } },
      ],
    });
  });

  it('opens the homepage at the root URL', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', Home);

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

  it('shows a useful fallback for unknown URLs and links back home', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/missing/page', NotFound);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Page not found');
    expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(document.title).toBe('Hummingbird | Page not found');
  });
});
