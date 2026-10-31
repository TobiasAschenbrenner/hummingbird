import { HttpErrorResponse } from '@angular/common/http';
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
import { RouterLink } from '@angular/router';
import { Subject, finalize, takeUntil } from 'rxjs';
import { ArticleDetail } from '../../models/article.model';
import { ArticlesApi } from '../../services/articles/articles';
import { Auth } from '../../services/auth/auth';

@Component({
  selector: 'app-article-cover',
  imports: [RouterLink],
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
  private readonly cancel = new Subject<void>();
  private context = '';
  private readonly injector = inject(Injector);
  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly reloadButton = viewChild<ElementRef<HTMLButtonElement>>('reloadButton');
  private readonly picker = viewChild<ElementRef<HTMLInputElement>>('coverPicker');
  protected readonly file = signal<File | null>(null);
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  protected readonly needsReview = signal(false);
  protected readonly confirming = signal(false);
  protected readonly opened = signal(false);
  protected readonly owner = computed(
    () =>
      this.auth.status() === 'authenticated' && this.auth.user()?.id === this.article().author.id,
  );
  protected readonly disabled = computed(
    () =>
      !this.owner() ||
      this.pending() ||
      this.auth.pending() ||
      this.article().version === '9223372036854775807',
  );

  constructor() {
    effect(() => {
      const article = this.article();
      const key = `${article.id}:${article.slug}`;
      if (key !== this.context) {
        this.context = key;
        this.cancel.next();
        this.clearFile();
        this.message.set('');
        this.needsReview.set(false);
        this.confirming.set(false);
        this.opened.set(false);
      }
      if (this.owner()) this.opened.set(true);
    });
  }

  private clearFile(): void {
    this.file.set(null);
    const input = this.picker()?.nativeElement;
    if (input) input.value = '';
  }

  protected selectFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (
      file &&
      (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size === 0 ||
        file.size > 5 * 1024 * 1024)
    ) {
      this.file.set(null);
      input.value = '';
      this.message.set('Choose a JPEG, PNG or WebP image up to 5 MiB.');
      return;
    }
    this.file.set(file);
    if (!this.needsReview()) this.message.set('');
  }

  protected upload(event: Event): void {
    event.preventDefault();
    const file = this.file();
    if (this.disabled() || this.needsReview() || !file) return;
    this.change(false);
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
    this.change(true);
  }

  private change(remove: boolean): void {
    const article = this.article();
    this.pending.set(true);
    this.message.set('');
    const request = remove
      ? this.api.removeCover(article)
      : this.api.saveCover(article, this.file()!);
    request
      .pipe(
        takeUntil(this.cancel),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (saved) => {
          this.clearFile();
          this.confirming.set(false);
          this.needsReview.set(false);
          this.changed.emit(saved);
          this.message.set(
            remove ? 'Cover removed. Its stored file is queued for cleanup.' : 'Cover uploaded.',
          );
        },
        error: (error: unknown) => {
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          if (status === 401) this.auth.expireSession();
          const knownRejection = [400, 413, 415, 429, 503].includes(status);
          this.needsReview.set(!knownRejection);
          this.message.set(
            status === 503
              ? 'Image uploads are not configured on the server.'
              : status === 400 || status === 413 || status === 415
                ? 'Choose a valid, static JPEG, PNG or WebP image up to 5 MiB and 20 million pixels.'
                : status === 429
                  ? 'Too many image changes. Wait a minute before trying again.'
                  : 'The image change could not be confirmed. Reload and review the article before trying again.',
          );
        },
      });
  }

  protected reload(): void {
    if (this.pending()) return;
    this.pending.set(true);
    this.api
      .detail(this.article().slug)
      .pipe(
        takeUntil(this.cancel),
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
  protected checkSession(): void {
    if (!this.pending() && !this.auth.pending())
      this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
