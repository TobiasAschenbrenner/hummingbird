import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, DestroyRef, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../services/auth/auth';
import { createSessionCheck } from '../../services/auth/session-check';
import { SessionNotice } from './session-notice';

@Component({
  imports: [SessionNotice],
  template: `@if (auth.status() === 'anonymous') {
    <app-session-notice (checkRequested)="checkSession()"
      ><p>Sign in to continue.</p></app-session-notice
    >
  }`,
})
class SessionHost {
  readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);
  readonly checkSession = createSessionCheck(this.auth, this.destroyRef, () => false);
}

describe('SessionNotice', () => {
  it('keeps a session check alive when its notice disappears, and cancels it with the owning page', async () => {
    TestBed.configureTestingModule({
      imports: [SessionHost],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(SessionHost);
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.auth.expireSession();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    const request = http.expectOne('/api/auth/me');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-session-notice')).toBeNull();
    expect(request.cancelled).toBe(false);
    request.flush({ user: { id: 1, username: 'Author', email: 'author@example.test' } });
    await fixture.whenStable();
    expect(fixture.componentInstance.auth.status()).toBe('authenticated');
    fixture.componentInstance.auth.expireSession();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    const next = http.expectOne('/api/auth/me');
    fixture.destroy();
    expect(next.cancelled).toBe(true);
    http.verify();
  });
});
