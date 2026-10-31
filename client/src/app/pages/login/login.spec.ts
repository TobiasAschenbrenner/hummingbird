import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Auth } from '../../services/auth/auth';
import { Login } from './login';

const user = { id: 1, username: 'Author 🐦', email: 'author@example.test' };

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(Auth).restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    fixture = TestBed.createComponent(Login);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  function setInput(name: string, value: string) {
    const input = element.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }
  function fillForm() {
    setInput('email', 'AUTHOR@EXAMPLE.TEST');
    setInput('password', '  a lengthy 🔑 password  ');
  }
  function submit() {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('shows accessible validation errors and never submits an invalid form', async () => {
    submit();
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('highlighted fields');
    expect(element.querySelector('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector('input[name="email"]')?.getAttribute('aria-describedby')).toBe(
      'email-error',
    );
    expect(element.querySelector('input[name="password"]')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
    fillForm();
    setInput('email', 'Kauthor@example.test');
    setInput('password', 'x'.repeat(129));
    submit();
    await fixture.whenStable();
    expect(element.querySelector('#email-error')).not.toBeNull();
    expect(element.querySelector('#password-error')).not.toBeNull();
    http.expectNone('/api/auth/login');
  });

  it('submits once, preserves password whitespace and navigates after success', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fillForm();
    submit();
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({
      email: 'AUTHOR@EXAMPLE.TEST',
      password: '  a lengthy 🔑 password  ',
    });
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    submit();
    http.expectNone('/api/auth/login');
    request.flush({ user });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/');
    expect(TestBed.inject(Auth).user()).toEqual(user);
  });

  it('shows server errors and permits correction without another automatic submission', async () => {
    fillForm();
    submit();
    http
      .expectOne('/api/auth/login')
      .flush(
        { error: { message: 'Invalid email or password.' } },
        { status: 401, statusText: 'Rejected' },
      );
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Invalid email or password',
    );
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    setInput('email', 'new@example.test');
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    http.expectNone('/api/auth/login');
  });

  it('maps server field errors to the matching input and renders messages as text', async () => {
    fillForm();
    submit();
    http.expectOne('/api/auth/login').flush(
      {
        error: {
          message: 'Please check your details.',
          fields: { email: '<img src=x> Use another address.', ignored: 'not an account field' },
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    expect(element.querySelector('#email-error')?.textContent).toContain('<img src=x>');
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
    setInput('email', 'another@example.test');
    await fixture.whenStable();
    expect(element.querySelector('#email-error')).toBeNull();
  });

  it('uses a safe message for unexpected server failures and allows retry', async () => {
    fillForm();
    submit();
    http
      .expectOne('/api/auth/login')
      .flush(
        { error: { message: 'private SQL and password details' } },
        { status: 500, statusText: 'Error' },
      );
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Please try again');
    expect(element.textContent).not.toContain('private SQL');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    submit();
    const retry = http.expectOne('/api/auth/login');
    retry.flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
  });

  it('blocks submissions while session restoration is pending', async () => {
    fillForm();
    TestBed.inject(Auth).restoreSession().subscribe();
    const session = http.expectOne('/api/auth/me');
    fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    submit();
    http.expectNone('/api/auth/login');
    session.flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('shows the signed-in account instead of another authentication form', async () => {
    TestBed.inject(Auth).restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush({ user });
    await fixture.whenStable();
    expect(element.querySelector('form')).toBeNull();
    expect(element.textContent).toContain('already signed in as Author');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/');
  });

  it('cancels a pending submission when navigating away', () => {
    fillForm();
    submit();
    const request = http.expectOne('/api/auth/login');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
    expect(TestBed.inject(Auth).pending()).toBe(false);
  });
});
