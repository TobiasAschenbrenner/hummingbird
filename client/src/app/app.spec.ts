import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let element: HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(App);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('renders shared navigation, main content and footer for an anonymous visitor', async () => {
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Main navigation');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(element.querySelector('main router-outlet')).not.toBeNull();
    expect(element.querySelector('footer')?.textContent).toContain('Hummingbird');
    expect(element.querySelector('a[href="/login"]')).not.toBeNull();
    expect(element.querySelector('a[href="/register"]')).not.toBeNull();
  });

  it('restores an existing cookie session when the application opens', async () => {
    expect(element.textContent).toContain('Checking session');
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 1, username: 'Returning author', email: 'author@example.test' } });
    await fixture.whenStable();
    expect(element.textContent).toContain('Signed in as Returning author');
    expect(element.querySelector('a[href="/login"]')).toBeNull();
    expect(element.querySelector('button')?.textContent).toContain('Log out');
  });
});
