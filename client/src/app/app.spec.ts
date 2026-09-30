import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

describe('App', () => {
  it('renders shared navigation, main content and footer', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Main navigation');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(element.querySelector('main router-outlet')).not.toBeNull();
    expect(element.querySelector('footer')?.textContent).toContain('Hummingbird');
  });
});
