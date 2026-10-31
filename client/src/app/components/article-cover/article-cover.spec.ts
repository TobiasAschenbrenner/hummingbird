import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { articleFixture } from '../../../testing/article-fixtures';
import { Auth } from '../../services/auth/auth';
import { ArticleCover } from './article-cover';

const cover = {
  url: 'https://res.cloudinary.com/test/image/upload/v1/hummingbird/test/article-covers/example.webp',
  width: 800,
  height: 400,
};
const owner = { id: 1, username: 'Author', email: 'author@example.test' };

describe('ArticleCover', () => {
  let fixture: ComponentFixture<ArticleCover>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let changed = vi.fn<(value: unknown) => void>();
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleCover],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ArticleCover);
    fixture.componentRef.setInput('article', articleFixture());
    changed = vi.fn<(value: unknown) => void>();
    fixture.componentInstance.changed.subscribe(changed);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => http.verify());
  async function signIn(user = owner) {
    TestBed.inject(Auth).restoreSession().subscribe();
    http.expectOne('/api/auth/me').flush({ user });
    await fixture.whenStable();
  }
  function select(file = new File(['image'], 'cover.png', { type: 'image/png' })) {
    const input = element.querySelector<HTMLInputElement>('input')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  }
  function submit() {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }
  function button(label: string) {
    return Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    )!;
  }

  it('shows controls only to the article author', async () => {
    expect(element.querySelector('form')).toBeNull();
    await signIn({ ...owner, id: 2 });
    expect(element.querySelector('form')).toBeNull();
    await signIn();
    expect(element.querySelector('label')?.textContent).toContain('Select cover image');
  });
  it('uploads a selected file once with exact target headers and applies the confirmed article', async () => {
    await signIn();
    select();
    submit();
    submit();
    const request = http.expectOne('/api/articles/article-1/cover');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toBeInstanceOf(File);
    expect(request.request.headers.get('X-Hummingbird-Article-Version')).toBe('1');
    const saved = articleFixture({ coverImage: cover, version: '2' });
    request.flush({ article: saved });
    await fixture.whenStable();
    expect(changed).toHaveBeenCalledExactlyOnceWith(saved);
    expect(element.textContent).toContain('Cover uploaded');
    expect(element.textContent).not.toContain('Selected:');
  });
  it('rejects invalid types, empty images and oversized selections without an upload', async () => {
    await signIn();
    for (const file of [
      new File(['svg'], 'cover.svg', { type: 'image/svg+xml' }),
      new File([], 'empty.png', { type: 'image/png' }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ]) {
      select(file);
      submit();
      expect(element.textContent).toContain('5 MiB');
      http.expectNone('/api/articles/article-1/cover');
    }
  });
  it('confirms removal explicitly and lets cancellation keep the existing cover', async () => {
    fixture.componentRef.setInput('article', articleFixture({ coverImage: cover }));
    await signIn();
    button('Remove cover').click();
    await fixture.whenStable();
    http.expectNone('/api/articles/article-1/cover');
    expect(document.activeElement).toBe(button('Cancel'));
    button('Cancel').click();
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Confirm removal');
    expect(document.activeElement).toBe(button('Remove cover'));
    button('Remove cover').click();
    await fixture.whenStable();
    button('Confirm removal').click();
    fixture.detectChanges();
    const request = http.expectOne('/api/articles/article-1/cover');
    expect(request.request.method).toBe('DELETE');
    request.flush({ article: articleFixture({ version: '2', coverImage: null }) });
    await fixture.whenStable();
    expect(changed).toHaveBeenCalledOnce();
    expect(element.textContent).toContain('queued for cleanup');
  });
  it('requires a fresh read after an uncertain result and never automatically repeats an upload', async () => {
    await signIn();
    select();
    submit();
    http
      .expectOne('/api/articles/article-1/cover')
      .flush({ error: { message: 'private SDK secret' } }, { status: 500, statusText: 'Failed' });
    await fixture.whenStable();
    expect(element.textContent).not.toContain('private SDK');
    expect(element.textContent).toContain('could not be confirmed');
    submit();
    http.expectNone('/api/articles/article-1/cover');
    button('Reload article').click();
    fixture.detectChanges();
    const latest = articleFixture({ version: '2', coverImage: cover });
    http.expectOne('/api/articles/article-1').flush({ article: latest });
    await fixture.whenStable();
    expect(changed).toHaveBeenCalledWith(latest);
    http.expectNone('/api/articles/article-1/cover');
  });
  it('keeps a file after session expiry but cannot upload as a different signed-in user', async () => {
    await signIn();
    select();
    submit();
    http
      .expectOne('/api/articles/article-1/cover')
      .flush(null, { status: 401, statusText: 'Expired' });
    await fixture.whenStable();
    expect(element.textContent).toContain('cover.png');
    expect(element.querySelector('a[target="_blank"]')).not.toBeNull();
    await signIn({ ...owner, id: 2 });
    submit();
    http.expectNone('/api/articles/article-1/cover');
  });
  it('blocks another upload until review and keeps review required if reload fails or URL is reused', async () => {
    await signIn();
    select();
    submit();
    http
      .expectOne('/api/articles/article-1/cover')
      .flush(null, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    button('Reload article').click();
    fixture.detectChanges();
    http.expectOne('/api/articles/article-1').flush({ article: articleFixture({ id: 99 }) });
    await fixture.whenStable();
    expect(element.textContent).toContain('another article');
    submit();
    http.expectNone('/api/articles/article-1/cover');
  });
  it('cancels a pending upload on navigation or destruction', async () => {
    await signIn();
    select();
    submit();
    const request = http.expectOne('/api/articles/article-1/cover');
    fixture.componentRef.setInput('article', articleFixture({ id: 2, slug: 'article-2' }));
    await fixture.whenStable();
    expect(request.cancelled).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    select();
    submit();
    const second = http.expectOne('/api/articles/article-2/cover');
    fixture.destroy();
    expect(second.cancelled).toBe(true);
  });
});
