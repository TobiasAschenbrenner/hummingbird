import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  catchError,
  defer,
  EMPTY,
  finalize,
  map,
  Observable,
  of,
  Subject,
  takeUntil,
  tap,
  throwError,
  timeout,
} from 'rxjs';

import {
  LoginInput,
  RegistrationInput,
  SessionStatus,
  User,
  UserResponse,
} from '../../models/auth.model';

function readUser(response: UserResponse): User {
  const user = response?.user;
  if (
    !user ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    typeof user.username !== 'string' ||
    typeof user.email !== 'string'
  ) {
    throw new Error('Unexpected account response.');
  }
  return { id: user.id, username: user.username, email: user.email };
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly currentUser = signal<User | null>(null);
  private readonly sessionStatus = signal<SessionStatus>('checking');
  private readonly mutationPending = signal(false);
  private readonly cancelRestore = new Subject<void>();
  readonly user = this.currentUser.asReadonly();
  readonly status = this.sessionStatus.asReadonly();
  readonly pending = this.mutationPending.asReadonly();

  restoreSession(): Observable<void> {
    return defer(() => {
      if (this.pending()) return EMPTY;
      this.cancelRestore.next();
      this.sessionStatus.set('checking');
      return this.http.get<UserResponse>('/api/auth/me', { withCredentials: true }).pipe(
        timeout(5000),
        takeUntil(this.cancelRestore),
        map(readUser),
        tap((user) => this.setSession(user)),
        catchError((error: unknown) => {
          this.currentUser.set(null);
          this.sessionStatus.set(
            error instanceof HttpErrorResponse && error.status === 401
              ? 'anonymous'
              : 'unavailable',
          );
          return of(null);
        }),
        map(() => undefined),
      );
    });
  }

  register(input: RegistrationInput): Observable<User> {
    return this.runMutation(
      () =>
        this.http
          .post<UserResponse>('/api/auth/register', input, { withCredentials: true })
          .pipe(map(readUser)),
      false,
    );
  }

  login(input: LoginInput): Observable<User> {
    return this.runMutation(() =>
      this.http
        .post<UserResponse>('/api/auth/login', input, {
          withCredentials: true,
          headers: { 'X-Hummingbird-Request': '1' },
        })
        .pipe(
          map(readUser),
          tap((user) => this.setSession(user)),
        ),
    );
  }

  logout(): Observable<void> {
    return this.runMutation(() =>
      this.http
        .post<void>('/api/auth/logout', null, {
          withCredentials: true,
          headers: { 'X-Hummingbird-Request': '1' },
        })
        .pipe(tap(() => this.setSession(null))),
    );
  }

  private runMutation<T>(request: () => Observable<T>, changesSession = true): Observable<T> {
    return defer(() => {
      if (this.pending())
        return throwError(() => new Error('An account request is already pending.'));
      this.mutationPending.set(true);
      if (changesSession) {
        // An old /me response can clear a newly issued cookie; cancel it before changing sessions.
        this.cancelRestore.next();
        if (this.status() === 'checking')
          this.sessionStatus.set(this.user() ? 'authenticated' : 'unavailable');
      }
      return request().pipe(
        timeout(10_000),
        finalize(() => this.mutationPending.set(false)),
      );
    });
  }

  private setSession(user: User | null): void {
    this.currentUser.set(user);
    this.sessionStatus.set(user ? 'authenticated' : 'anonymous');
  }
}
