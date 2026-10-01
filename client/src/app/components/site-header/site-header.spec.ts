import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Auth } from '../../services/auth/auth';
import { SiteHeader } from './site-header';

const user = { id: 1, username: 'Author', email: 'author@example.test' };

describe('SiteHeader', () => {
  let fixture: ComponentFixture<SiteHeader>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let auth: Auth;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteHeader],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    auth.restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    fixture = TestBed.createComponent(SiteHeader);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  async function signIn() {
    auth.restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush({ user });
    await fixture.whenStable();
  }

  it('offers registration and login to anonymous visitors', () => {
    expect(element.querySelector('a[href="/login"]')?.textContent).toContain('Log in');
    expect(element.querySelector('a[href="/register"]')?.textContent).toContain('Register');
    expect(element.textContent).not.toContain('Log out');
  });

  it('logs out once and returns home only after the API acknowledges logout', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await signIn();
    const button = element.querySelector<HTMLButtonElement>('button')!;
    button.click();
    fixture.detectChanges();
    const request = http.expectOne('/api/auth/logout');
    expect(button.disabled).toBe(true);
    expect(element.textContent).toContain('Signed in as Author');
    button.click();
    http.expectNone('/api/auth/logout');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/');
    expect(element.querySelector('a[href="/login"]')).not.toBeNull();
    expect(element.textContent).not.toContain('Signed in as');
  });

  it('keeps the signed-in header after logout fails and allows retry', async () => {
    await signIn();
    element.querySelector<HTMLButtonElement>('button')!.click();
    http.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Please try again');
    expect(element.textContent).toContain('Signed in as Author');
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
  });

  it('can retry an unavailable session check without assuming the user is signed out', async () => {
    auth.restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Session check unavailable');
    element.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Checking session');
    http.expectOne('/api/auth/me').flush({ user });
    await fixture.whenStable();
    expect(element.textContent).toContain('Signed in as Author');
    expect(element.textContent).not.toContain('Session check unavailable');
  });
});
