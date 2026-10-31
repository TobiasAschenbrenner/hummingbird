import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { ArticleFilters as Filters } from '../../models/article.model';
import { ArticleOptions } from '../../models/catalog.model';
import { CatalogsApi } from '../../services/catalogs/catalogs';
import { readArticleFilters } from '../../validators/article-list.validator';

@Component({
  selector: 'app-article-filters',
  imports: [ReactiveFormsModule],
  templateUrl: './article-filters.html',
  styleUrl: './article-filters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleFilters implements OnInit {
  readonly filters = input.required<Filters>();
  readonly applied = output<Filters>();
  private readonly api = inject(CatalogsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly options = signal<ArticleOptions>({ categories: [], tags: [] });
  protected readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly message = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    q: '',
    category: { value: '', disabled: true },
    tag: { value: '', disabled: true },
  });

  constructor() {
    effect(() => {
      const filters = this.filters();
      this.form.reset({
        q: filters.q ?? '',
        category: filters.category ?? '',
        tag: filters.tag ?? '',
      });
      this.message.set('');
    });
  }

  ngOnInit(): void {
    this.loadOptions();
  }

  protected loadOptions(): void {
    if (this.status() === 'loading') return;
    this.status.set('loading');
    this.form.controls.category.disable({ emitEvent: false });
    this.form.controls.tag.disable({ emitEvent: false });
    this.api
      .articleOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.options.set(options);
          this.status.set('ready');
          this.form.controls.category.enable({ emitEvent: false });
          this.form.controls.tag.enable({ emitEvent: false });
        },
        error: () => this.status.set('error'),
      });
  }

  protected missingOption(kind: 'categories' | 'tags', slug: string): boolean {
    return !!slug && !this.options()[kind].some((entry) => entry.slug === slug);
  }

  protected apply(): void {
    const value = this.form.getRawValue();
    const filters = readArticleFilters({
      q: value.q,
      category: value.category || undefined,
      tag: value.tag || undefined,
    });
    if (!filters) {
      this.message.set(
        'Use up to 100 search characters without control characters and valid category/tag slugs.',
      );
      return;
    }
    this.message.set('');
    this.form.controls.q.setValue(filters.q ?? '');
    this.applied.emit(filters);
  }

  protected clear(): void {
    this.form.reset({ q: '', category: '', tag: '' });
    this.message.set('');
    this.applied.emit({});
  }
}
