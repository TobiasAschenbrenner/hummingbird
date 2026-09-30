import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Home } from './home';

describe('Home', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Home);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows progress before displaying a successful connection', async () => {
    const button = element.querySelector('button')!;
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Checking');
    expect(button.disabled).toBe(true);

    http.expectOne('/api/health').flush({ status: 'ok' });
    await fixture.whenStable();

    expect(element.querySelector('[role="status"]')?.textContent).toContain('API connected');
    expect(button.disabled).toBe(false);
    expect(element.textContent).toContain('The database is not connected yet.');
  });

  it('allows a failed connection to be retried', async () => {
    http.expectOne('/api/health').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();

    expect(element.querySelector('[role="status"]')?.textContent).toContain('API unavailable');
    const button = element.querySelector('button')!;
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(true);

    http.expectOne('/api/health').flush({ status: 'ok' });
    await fixture.whenStable();

    expect(element.querySelector('[role="status"]')?.textContent).toContain('API connected');
    expect(button.disabled).toBe(false);
  });

  it('cancels the pending request when the page is destroyed', () => {
    const request = http.expectOne('/api/health');
    fixture.destroy();

    expect(request.cancelled).toBe(true);
  });
});
