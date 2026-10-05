import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  finalize,
  map,
  of,
  startWith,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { ArticleFields } from '../../components/article-fields/article-fields';
import { ArticleDetail, ArticleFieldErrors } from '../../models/article.model';
import { ArticleOptions } from '../../models/catalog.model';
import { ArticlesApi } from '../../services/articles/articles';
import { readArticleUpdateError } from '../../services/articles/article-error';
import { Auth } from '../../services/auth/auth';
import { CatalogsApi } from '../../services/catalogs/catalogs';
import { createArticleForm } from '../../validators/article-form.validator';
import { articleListParams, readArticleListQuery } from '../../validators/article-list.validator';
import { isArticleSlug } from '../../validators/article.validator';

type EditState =
  { status: 'loading' | 'error' | 'not-found' } | { status: 'ready'; article: ArticleDetail };

@Component({
  selector: 'app-article-edit',
  imports: [ReactiveFormsModule, RouterLink, ArticleFields],
  templateUrl: './article-edit.html',
  styleUrl: './article-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleEdit implements OnInit {
  protected readonly auth = inject(Auth);
  private readonly api = inject(ArticlesApi);
  private readonly catalogs = inject(CatalogsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retry = new Subject<void>();
  private readonly cancelRequests = new Subject<void>();
  protected readonly state = signal<EditState>({ status: 'loading' });
  protected readonly article = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.article : null;
  });
  protected readonly options = signal<ArticleOptions>({ categories: [], tags: [] });
  protected readonly optionStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly form = createArticleForm(inject(FormBuilder), () => this.options());
  protected readonly serverFields = signal<ArticleFieldErrors>({});
  protected readonly editorOpened = signal(false);
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  protected readonly saved = signal<ArticleDetail | null>(null);
  protected readonly needsReview = signal(false);
  protected readonly latest = signal<ArticleDetail | null>(null);
  protected readonly latestStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly forbidden = signal(false);
  protected readonly removed = signal(false);
  protected readonly ownsArticle = computed(
    () =>
      this.auth.status() === 'authenticated' &&
      !!this.article() &&
      this.auth.user()?.id === this.article()?.author.id,
  );
  protected readonly versionLimit = computed(
    () => this.article()?.version === '9223372036854775807',
  );
  protected readonly editorDisabled = computed(
    () =>
      !this.ownsArticle() ||
      this.auth.pending() ||
      this.pending() ||
      this.forbidden() ||
      this.removed() ||
      this.versionLimit(),
  );
  private readonly listContext = toSignal(
    this.route.queryParamMap.pipe(map((params) => readArticleListQuery(params) ?? { page: 1 })),
    { initialValue: { page: 1 } },
  );
  protected readonly listQuery = computed(() => articleListParams(this.listContext()));

  constructor() {
    effect(() => {
      const article = this.article();
      if (
        article &&
        this.auth.status() === 'authenticated' &&
        this.auth.user()?.id === article.author.id
      ) {
        this.editorOpened.set(true);
        if (this.optionStatus() === 'idle' && !this.auth.pending())
          untracked(() => this.loadOptions());
      }
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.serverFields.set({});
      if (!this.needsReview()) this.message.set('');
    });
  }

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.retry.pipe(startWith(undefined))])
      .pipe(
        tap(() => {
          this.cancelRequests.next();
          this.editorOpened.set(false);
          this.message.set('');
          this.needsReview.set(false);
          this.latest.set(null);
          this.latestStatus.set('idle');
          this.forbidden.set(false);
          this.removed.set(false);
          this.saved.set(null);
          this.serverFields.set({});
        }),
        switchMap(([params]) => {
          const slug = params.get('slug');
          if (!isArticleSlug(slug)) return of<EditState>({ status: 'not-found' });
          return this.api.detail(slug).pipe(
            map((article): EditState => ({ status: 'ready', article })),
            startWith<EditState>({ status: 'loading' }),
            catchError((error: unknown) =>
              of<EditState>({
                status:
                  error instanceof HttpErrorResponse && error.status === 404
                    ? 'not-found'
                    : 'error',
              }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        this.state.set(state);
        if (state.status === 'ready') this.resetForm(state.article);
      });
  }

  private resetForm(article: ArticleDetail): void {
    this.form.reset({
      title: article.title,
      slug: article.slug,
      description: article.description,
      body: article.body,
      categoryId: article.category.id,
      tagIds: article.tags.map((tag) => tag.id),
    });
  }

  protected tryAgain(): void {
    if (this.state().status === 'error') this.retry.next();
  }
  protected retrySession(): void {
    if (this.pending() || this.auth.pending() || this.auth.status() === 'checking') return;
    this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
  protected loadOptions(): void {
    if (this.editorDisabled() || this.optionStatus() === 'loading') return;
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

  protected submit(): void {
    const article = this.article();
    if (
      !article ||
      this.editorDisabled() ||
      this.needsReview() ||
      this.saved() ||
      this.optionStatus() !== 'ready' ||
      !this.options().categories.length
    )
      return;
    this.form.controls.title.setValue(this.form.controls.title.value.trim());
    this.form.controls.description.setValue(this.form.controls.description.value.trim());
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.message.set('Please check the highlighted fields.');
      return;
    }
    const { slug: _slug, ...content } = this.form.getRawValue();
    this.pending.set(true);
    this.message.set('');
    this.serverFields.set({});
    this.api
      .update(article.slug, { ...content, version: article.version })
      .pipe(
        takeUntil(this.cancelRequests),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (saved) => {
          this.saved.set(saved);
          void this.router
            .navigate(['/articles', saved.slug], { queryParams: this.listQuery() })
            .catch(() => this.message.set('Open the saved article using the link below.'));
        },
        error: (error: unknown) => {
          const result = readArticleUpdateError(error);
          this.message.set(result.message);
          this.serverFields.set(result.fields);
          this.needsReview.set(result.needsReview);
          this.forbidden.set(result.forbidden);
          this.removed.set(result.missing);
          if (result.sessionExpired) this.auth.expireSession();
        },
      });
  }

  protected loadLatest(): void {
    const original = this.article();
    if (
      !original ||
      this.editorDisabled() ||
      !this.needsReview() ||
      this.latestStatus() === 'loading'
    )
      return;
    this.latestStatus.set('loading');
    this.latest.set(null);
    this.api
      .detail(original.slug)
      .pipe(takeUntil(this.cancelRequests), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (latest) => {
          if (latest.id !== original.id || latest.author.id !== original.author.id) {
            this.latestStatus.set('error');
            return;
          }
          this.latest.set(latest);
          this.latestStatus.set('ready');
        },
        error: () => this.latestStatus.set('error'),
      });
  }

  protected useLatest(keepDraft: boolean): void {
    const latest = this.latest();
    if (!latest || this.editorDisabled() || this.latestStatus() !== 'ready') return;
    this.state.set({ status: 'ready', article: latest });
    if (!keepDraft) this.resetForm(latest);
    this.needsReview.set(false);
    this.latest.set(null);
    this.latestStatus.set('idle');
    this.message.set('');
    this.serverFields.set({});
  }
}
