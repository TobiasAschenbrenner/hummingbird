import { COVER_IMAGE_TYPES, isSupportedCoverFile } from '../../validators/cover.validator';
import { readCoverChangeError } from '../../services/articles/cover-error';
import { Observable } from 'rxjs';
import { SessionNotice } from '../session-notice/session-notice';
import { createSessionCheck } from '../../services/auth/session-check';
import { Button } from '../button/button';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  viewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, finalize, takeUntil } from 'rxjs';
import { ArticleDetail, MAX_ARTICLE_VERSION } from '../../models/article.model';
import { ArticlesApi } from '../../services/articles/articles';
import { Auth } from '../../services/auth/auth';

@Component({
  selector: 'app-article-cover',
  imports: [SessionNotice, Button],
  templateUrl: './article-cover.html',
  styleUrl: './article-cover.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleCover {
  readonly article = input.required<ArticleDetail>();
  readonly changed = output<ArticleDetail>();
  protected readonly auth = inject(Auth);
  private readonly api = inject(ArticlesApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly checkSession = createSessionCheck(this.auth, this.destroyRef, () =>
    this.pending(),
  );
  private readonly cancelRequests = new Subject<void>();
  private articleIdentity = '';
  private readonly injector = inject(Injector);
  private readonly removeButton = viewChild<unknown, ElementRef<HTMLButtonElement>>(
    'removeButton',
    {
      read: ElementRef,
    },
  );
  private readonly cancelButton = viewChild<unknown, ElementRef<HTMLButtonElement>>(
    'cancelButton',
    {
      read: ElementRef,
    },
  );
  private readonly reloadButton = viewChild<unknown, ElementRef<HTMLButtonElement>>(
    'reloadButton',
    {
      read: ElementRef,
    },
  );
  private readonly picker = viewChild<unknown, ElementRef<HTMLInputElement>>('coverPicker', {
    read: ElementRef,
  });
  protected readonly acceptedTypes = COVER_IMAGE_TYPES.join(',');
  protected readonly file = signal<File | null>(null);
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  protected readonly needsReview = signal(false);
  protected readonly confirming = signal(false);
  protected readonly opened = signal(false);
  protected readonly ownsArticle = computed(
    () =>
      this.auth.status() === 'authenticated' && this.auth.user()?.id === this.article().author.id,
  );
  protected readonly disabled = computed(
    () =>
      !this.ownsArticle() ||
      this.pending() ||
      this.auth.pending() ||
      this.article().version === MAX_ARTICLE_VERSION,
  );

  constructor() {
    effect(() => {
      const article = this.article();
      const key = `${article.id}:${article.slug}`;
      if (key !== this.articleIdentity) {
        this.articleIdentity = key;
        this.cancelRequests.next();
        this.clearFile();
        this.message.set('');
        this.needsReview.set(false);
        this.confirming.set(false);
        this.opened.set(false);
      }
      if (this.ownsArticle()) this.opened.set(true);
    });
  }

  private clearFile(): void {
    this.file.set(null);
    const input = this.picker()?.nativeElement;
    if (input) input.value = '';
  }

  protected selectFile(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0] ?? null;
    if (file && !isSupportedCoverFile(file)) {
      this.file.set(null);
      input.value = '';
      this.message.set('Choose a JPEG, PNG or WebP image up to 5 MiB.');
      return;
    }
    this.file.set(file);
    if (!this.needsReview()) this.message.set('');
  }

  protected uploadCover(event: Event): void {
    event.preventDefault();
    const file = this.file();
    if (this.disabled() || this.needsReview() || !file) return;
    this.changeCover(this.api.saveCover(this.article(), file), 'Cover uploaded.');
  }

  protected requestRemoval(): void {
    if (!this.disabled() && !this.needsReview()) {
      this.confirming.set(true);
      afterNextRender(() => this.cancelButton()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }
  protected cancelRemoval(): void {
    if (this.pending()) return;
    this.confirming.set(false);
    afterNextRender(
      () => (this.needsReview() ? this.reloadButton() : this.removeButton())?.nativeElement.focus(),
      { injector: this.injector },
    );
  }
  protected remove(): void {
    if (this.disabled() || this.needsReview() || !this.confirming()) return;
    this.changeCover(
      this.api.removeCover(this.article()),
      'Cover removed. Its stored file is queued for cleanup.',
    );
  }

  private changeCover(request: Observable<ArticleDetail>, successMessage: string): void {
    this.pending.set(true);
    this.message.set('');
    request
      .pipe(
        takeUntil(this.cancelRequests),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (saved) => {
          this.clearFile();
          this.confirming.set(false);
          this.needsReview.set(false);
          this.changed.emit(saved);
          this.message.set(successMessage);
        },
        error: (error: unknown) => {
          const result = readCoverChangeError(error);
          if (result.sessionExpired) this.auth.expireSession();
          this.needsReview.set(result.needsReview);
          this.message.set(result.message);
        },
      });
  }

  protected reload(): void {
    if (this.pending()) return;
    this.pending.set(true);
    this.api
      .detail(this.article().slug)
      .pipe(
        takeUntil(this.cancelRequests),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (article) => {
          if (article.id !== this.article().id) {
            this.message.set(
              'The article URL now belongs to another article. Refresh this page before continuing.',
            );
            return;
          }
          this.changed.emit(article);
          this.needsReview.set(false);
          this.confirming.set(false);
          this.message.set('Latest article loaded. Review its cover before another change.');
        },
        error: () => this.message.set('We couldn’t reload the article. Please try again.'),
      });
  }
}
