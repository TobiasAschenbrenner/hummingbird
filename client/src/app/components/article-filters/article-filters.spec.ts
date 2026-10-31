import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArticleFilters } from './article-filters';

const options = {
  categories: [{ id: 1, slug: 'tech', name: 'Tech' }],
  tags: [{ id: 1, slug: 'databases', name: 'Databases' }],
};

describe('ArticleFilters', () => {
  let fixture: ComponentFixture<ArticleFilters>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let applied = vi.fn<(value: unknown) => void>();
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleFilters],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ArticleFilters);
    fixture.componentRef.setInput('filters', { q: 'SQL', category: 'tech', tag: 'databases' });
    element = fixture.nativeElement;
    applied = vi.fn<(value: unknown) => void>();
    fixture.componentInstance.applied.subscribe(applied);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());
  async function ready() {
    http.expectOne('/api/categories').flush({ categories: options.categories });
    http.expectOne('/api/tags').flush({ tags: options.tags });
    await fixture.whenStable();
  }
  function search(value: string) {
    const input = element.querySelector<HTMLInputElement>('#article-search')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function submit() {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('hydrates URL selections, loads public options and enables catalog controls', async () => {
    expect(element.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('SQL');
    await ready();
    expect(element.querySelector<HTMLSelectElement>('#category-filter')!.value).toBe('tech');
    expect(element.querySelector<HTMLSelectElement>('#tag-filter')!.value).toBe('databases');
    expect(element.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
    expect(element.querySelector('label[for="article-search"]')).not.toBeNull();
    expect(element.textContent).not.toContain('Unavailable');
  });

  it('waits for explicit submission, trims search and emits catalog slugs', async () => {
    await ready();
    search('  PostgreSQL 🐦  ');
    expect(applied).not.toHaveBeenCalled();
    submit();
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      q: 'PostgreSQL 🐦',
      category: 'tech',
      tag: 'databases',
    });
    http.expectNone((request) => request.url === '/api/articles');
  });

  it('counts Unicode characters and blocks oversized, malformed and control-character searches', async () => {
    await ready();
    for (const q of ['a'.repeat(101), '🐦'.repeat(101), 'bad\u007Fsearch', '\uD800']) {
      search(q);
      submit();
      expect(applied).not.toHaveBeenCalled();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain(
        '100 search characters',
      );
    }
    search('🐦'.repeat(100));
    submit();
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      q: '🐦'.repeat(100),
      category: 'tech',
      tag: 'databases',
    });
  });

  it('follows external URL changes and keeps unavailable slugs selectable rather than broadening results', async () => {
    await ready();
    search('Unsaved search');
    fixture.componentRef.setInput('filters', {
      q: 'Restored',
      category: 'removed-category',
      tag: 'removed-tag',
    });
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('Restored');
    expect(element.querySelector<HTMLSelectElement>('#category-filter')!.value).toBe(
      'removed-category',
    );
    expect(element.textContent).toContain('Unavailable category (removed-category)');
    submit();
    expect(applied).toHaveBeenCalledWith({
      q: 'Restored',
      category: 'removed-category',
      tag: 'removed-tag',
    });
  });

  it('clears both the search and catalog filters explicitly', async () => {
    await ready();
    element.querySelector<HTMLButtonElement>('.clear')!.click();
    await fixture.whenStable();
    expect(applied).toHaveBeenCalledExactlyOnceWith({});
    expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('');
    expect(element.querySelector<HTMLSelectElement>('#category-filter')!.value).toBe('');
    expect(element.querySelector<HTMLSelectElement>('#tag-filter')!.value).toBe('');
  });

  it('keeps search available when options fail and retries without losing draft text', async () => {
    const tags = http.expectOne('/api/tags');
    http
      .expectOne('/api/categories')
      .flush({ error: { message: 'private SQL details' } }, { status: 500, statusText: 'Failed' });
    expect(tags.cancelled).toBe(true);
    await fixture.whenStable();
    search('New search');
    expect(element.textContent).toContain('Search is still available');
    expect(element.textContent).not.toContain('private SQL');
    submit();
    expect(applied).toHaveBeenCalledWith({ q: 'New search', category: 'tech', tag: 'databases' });
    const retry = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Retry filter options',
    )!;
    retry.click();
    retry.click();
    fixture.detectChanges();
    await ready();
    expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('New search');
  });

  it('accepts empty catalogs and renders option labels as plain text', async () => {
    http.expectOne('/api/categories').flush({ categories: [] });
    http
      .expectOne('/api/tags')
      .flush({ tags: [{ ...options.tags[0], name: '<script>unsafe()</script>' }] });
    await fixture.whenStable();
    expect(element.textContent).toContain('<script>unsafe()</script>');
    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
  });

  it('cancels both pending option reads on destruction', () => {
    const categories = http.expectOne('/api/categories');
    const tags = http.expectOne('/api/tags');
    fixture.destroy();
    expect(categories.cancelled).toBe(true);
    expect(tags.cancelled).toBe(true);
  });
});
