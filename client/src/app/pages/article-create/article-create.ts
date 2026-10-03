import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { ArticleDetail, ArticleField, ArticleFieldErrors } from '../../models/article.model';
import { ArticleOptions } from '../../models/catalog.model';
import { ArticlesApi } from '../../services/articles/articles';
import { readPublicationError } from '../../services/articles/article-error';
import { Auth } from '../../services/auth/auth';
import { CatalogsApi } from '../../services/catalogs/catalogs';
import {
  articleBody,
  articleDescription,
  articleSlug,
  articleTitle,
  selectedCategory,
  selectedTags,
} from '../../validators/article-form.validator';
import { slugFromTitle } from '../../validators/article.validator';

@Component({
  selector: 'app-article-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './article-create.html',
  styleUrl: './article-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleCreate {
  protected readonly auth = inject(Auth);
  private readonly articles = inject(ArticlesApi);
  private readonly catalogs = inject(CatalogsApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly options = signal<ArticleOptions>({ categories: [], tags: [] });
  protected readonly optionStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly editorOpened = signal(false);
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  protected readonly checkArticle = signal<string | null>(null);
  protected readonly published = signal<ArticleDetail | null>(null);
  private readonly serverFields = signal<ArticleFieldErrors>({});
  protected readonly editorDisabled = computed(
    () => this.pending() || this.auth.pending() || this.auth.status() !== 'authenticated',
  );
  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', articleTitle],
    slug: ['', articleSlug],
    description: ['', articleDescription],
    body: ['', articleBody],
    categoryId: [0, selectedCategory(() => this.options().categories)],
    tagIds: inject(FormBuilder).nonNullable.control<number[]>(
      [],
      selectedTags(() => this.options().tags),
    ),
  });

  constructor() {
    effect(() => {
      if (this.auth.user() && this.auth.status() === 'authenticated' && !this.auth.pending()) {
        this.editorOpened.set(true);
        if (this.optionStatus() === 'idle') untracked(() => this.loadOptions());
      }
    });
    this.form.controls.title.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((title) => {
        if (!this.form.controls.slug.dirty)
          this.form.controls.slug.setValue(slugFromTitle(title), { emitEvent: false });
      });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.checkArticle()) this.message.set('');
      this.serverFields.set({});
    });
  }

  protected loadOptions(): void {
    if (this.optionStatus() === 'loading' || this.editorDisabled()) return;
    this.optionStatus.set('loading');
    this.catalogs
      .articleOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.options.set(options);
          this.form.controls.categoryId.updateValueAndValidity();
          this.form.controls.tagIds.updateValueAndValidity();
          this.optionStatus.set('ready');
        },
        error: () => this.optionStatus.set('error'),
      });
  }

  protected retrySession(): void {
    if (this.pending() || this.auth.pending() || this.auth.status() === 'checking') return;
    this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  protected toggleTag(id: number, event: Event): void {
    if (
      this.editorDisabled() ||
      this.optionStatus() !== 'ready' ||
      !(event.target instanceof HTMLInputElement)
    )
      return;
    const control = this.form.controls.tagIds;
    const selected = control.value.filter((value) => value !== id);
    if (event.target.checked && selected.length < 10) selected.push(id);
    control.setValue(selected);
    control.markAsDirty();
    control.markAsTouched();
  }

  protected hasUnavailableTags(): boolean {
    return (
      this.optionStatus() === 'ready' &&
      this.form.controls.tagIds.value.some(
        (id) => !this.options().tags.some((tag) => tag.id === id),
      )
    );
  }

  protected removeUnavailableTags(): void {
    if (this.editorDisabled() || this.optionStatus() !== 'ready') return;
    const control = this.form.controls.tagIds;
    control.setValue(
      control.value.filter((id) => this.options().tags.some((tag) => tag.id === id)),
    );
    control.markAsDirty();
    control.markAsTouched();
  }

  protected fieldError(field: ArticleField): string {
    const control = this.form.controls[field];
    const messages: Record<ArticleField, string> = {
      title: 'Use 1–55 characters without control characters.',
      slug: 'Use 1–80 lowercase letters, digits and single hyphens.',
      description: 'Use 1–250 characters without control characters.',
      body: 'Use 1–20,000 characters. Tabs and line breaks are allowed.',
      categoryId: 'Select an existing category.',
      tagIds: 'Select up to 10 distinct existing tags.',
    };
    return (
      this.serverFields()[field] ?? (control.touched && control.invalid ? messages[field] : '')
    );
  }

  protected submit(): void {
    if (
      this.editorDisabled() ||
      this.optionStatus() !== 'ready' ||
      !this.options().categories.length ||
      this.published()
    )
      return;
    this.form.controls.title.setValue(this.form.controls.title.value.trim());
    this.form.controls.slug.setValue(this.form.controls.slug.value.trim());
    this.form.controls.description.setValue(this.form.controls.description.value.trim());
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.message.set('Please check the highlighted fields.');
      return;
    }
    const input = this.form.getRawValue();
    this.message.set('');
    this.checkArticle.set(null);
    this.serverFields.set({});
    this.pending.set(true);
    this.articles
      .publish(input)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (article) => {
          this.published.set(article);
          void this.router
            .navigate(['/articles', article.slug])
            .catch(() => this.message.set('Open the published article using the link below.'));
        },
        error: (error: unknown) => {
          const result = readPublicationError(error);
          this.message.set(result.message);
          this.serverFields.set(result.fields);
          if (result.checkArticle) this.checkArticle.set(input.slug);
          if (result.sessionExpired) this.auth.expireSession();
        },
      });
  }
}
