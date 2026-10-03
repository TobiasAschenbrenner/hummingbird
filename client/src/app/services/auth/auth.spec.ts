import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { Auth } from './auth';

const user = { id: 1, username: 'Author', email: 'author@example.test' };
const credentials = { email: user.email, password: '  a lengthy 🔑 password  ' };

describe('Auth', () => {
  let auth: Auth;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function restoreSignedIn() {
    const restored = firstValueFrom(auth.restoreSession());
    const request = http.expectOne('/api/auth/me');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ user });
    await restored;
  }

  it('restores public account data from the cookie session', async () => {
    expect(auth.status()).toBe('checking');
    await restoreSignedIn();
    expect(auth.user()).toEqual(user);
    expect(auth.status()).toBe('authenticated');
  });

  it('treats an expired session as signed out without propagating an error', async () => {
    const restored = firstValueFrom(auth.restoreSession());
    http
      .expectOne('/api/auth/me')
      .flush(
        { error: { message: 'Please sign in.' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await restored;
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  it('distinguishes unavailable or malformed responses from an anonymous session', async () => {
    for (const malformed of [false, true]) {
      const restored = firstValueFrom(auth.restoreSession());
      const request = http.expectOne('/api/auth/me');
      if (malformed) request.flush({ user: { id: 1, email: user.email } });
      else request.flush(null, { status: 503, statusText: 'Unavailable' });
      await restored;
      expect(auth.status()).toBe('unavailable');
      expect(auth.user()).toBeNull();
    }
  });

  it('registers without signing in and preserves password spaces and Unicode', async () => {
    const result = firstValueFrom(auth.register({ username: user.username, ...credentials }));
    const request = http.expectOne('/api/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ username: user.username, ...credentials });
    request.flush({ user });
    await expect(result).resolves.toEqual(user);
    expect(auth.user()).toBeNull();
    expect(auth.pending()).toBe(false);
  });

  it('logs in through the API with the required header and keeps only public data', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const result = firstValueFrom(auth.login(credentials));
    expect(auth.pending()).toBe(true);
    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-Hummingbird-Request')).toBe('1');
    expect(request.request.body).toEqual(credentials);
    request.flush({ user: { ...user, passwordHash: 'not-public' }, token: 'not-public' });
    await expect(result).resolves.toEqual(user);
    expect(auth.user()).toEqual(user);
    expect(auth.status()).toBe('authenticated');
    expect(auth.pending()).toBe(false);
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('preserves the existing identity when login fails', async () => {
    await restoreSignedIn();
    const result = firstValueFrom(auth.login(credentials));
    http.expectOne('/api/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.user()).toEqual(user);
    expect(auth.pending()).toBe(false);
  });

  it('clears the identity only after successful server logout', async () => {
    await restoreSignedIn();
    const result = firstValueFrom(auth.logout());
    expect(auth.user()).toEqual(user);
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-Hummingbird-Request')).toBe('1');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await result;
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  it('preserves the identity and allows retry after failed logout', async () => {
    await restoreSignedIn();
    const result = firstValueFrom(auth.logout());
    http.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'Error' });
    await expect(result).rejects.toMatchObject({ status: 500 });
    expect(auth.user()).toEqual(user);
    expect(auth.pending()).toBe(false);
  });

  it('cancels an old session check before login and prevents new checks during the change', async () => {
    const completed = vi.fn();
    auth.restoreSession().subscribe({ complete: completed });
    const old = http.expectOne('/api/auth/me');
    const login = firstValueFrom(auth.login(credentials));
    expect(old.cancelled).toBe(true);
    expect(completed).toHaveBeenCalledOnce();
    auth.restoreSession().subscribe();
    http.expectNone('/api/auth/me');
    http.expectOne('/api/auth/login').flush({ user });
    await login;
    expect(auth.status()).toBe('authenticated');
  });

  it('rejects overlapping mutations before issuing a second request', async () => {
    const login = firstValueFrom(auth.login(credentials));
    await expect(firstValueFrom(auth.logout())).rejects.toThrow('already pending');
    http.expectNone('/api/auth/logout');
    http.expectOne('/api/auth/login').flush({ user });
    await login;
  });

  it('bounds session checks and form requests and releases pending state after timeouts', async () => {
    vi.useFakeTimers();
    const restored = firstValueFrom(auth.restoreSession());
    const me = http.expectOne('/api/auth/me');
    await vi.advanceTimersByTimeAsync(5000);
    await restored;
    expect(me.cancelled).toBe(true);
    expect(auth.status()).toBe('unavailable');
    const login = firstValueFrom(auth.login(credentials));
    const rejected = expect(login).rejects.toMatchObject({ name: 'TimeoutError' });
    const request = http.expectOne('/api/auth/login');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(request.cancelled).toBe(true);
    expect(auth.pending()).toBe(false);
  });

  it('clears an expired session and cancels an older restore without issuing another request', async () => {
    await restoreSignedIn();
    auth.restoreSession().subscribe();
    const stale = http.expectOne('/api/auth/me');
    auth.expireSession();
    expect(stale.cancelled).toBe(true);
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    http.expectNone('/api/auth/me');
  });
});
