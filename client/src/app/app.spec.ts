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
