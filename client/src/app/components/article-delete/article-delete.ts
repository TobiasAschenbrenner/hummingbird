import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  afterNextRender,
  Injector,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { finalize, Subject, takeUntil } from 'rxjs';

import { ArticleDetail } from '../../models/article.model';
import { ArticlesApi } from '../../services/articles/articles';
import { readArticleDeletionError } from '../../services/articles/article-error';
import { Auth } from '../../services/auth/auth';

@Component({
  selector: 'app-article-delete',
  imports: [RouterLink],
  templateUrl: './article-delete.html',
  styleUrl: './article-delete.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleDelete {
  readonly article = input.required<ArticleDetail>();
  readonly removed = output<'deleted' | 'not-found'>();
  readonly reload = output<void>();
  protected readonly auth = inject(Auth);
  private readonly api = inject(ArticlesApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly cancelRequests = new Subject<void>();
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly reloadButton = viewChild<ElementRef<HTMLButtonElement>>('reloadButton');
  protected readonly finished = signal(false);
  protected readonly opened = signal(false);
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  protected readonly needsReview = signal(false);
  protected readonly forbidden = signal(false);
  protected readonly ownsArticle = computed(
    () =>
      this.auth.status() === 'authenticated' && this.auth.user()?.id === this.article().author.id,
  );
  protected readonly disabled = computed(
    () =>
      !this.ownsArticle() ||
      this.auth.pending() ||
      this.pending() ||
      this.finished() ||
      this.needsReview() ||
      this.forbidden(),
  );

  constructor() {
    effect(() => {
      this.article();
      untracked(() => {
        this.cancelRequests.next();
        this.opened.set(false);
        this.finished.set(false);
        this.message.set('');
        this.needsReview.set(false);
        this.forbidden.set(false);
      });
    });
  }

  protected open(): void {
    if (this.disabled() || this.opened()) return;
    this.opened.set(true);
    this.message.set('');
    afterNextRender(() => this.cancelButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    if (this.pending()) return;
    this.opened.set(false);
    this.message.set('');
    // A stale or uncertain outcome still requires a fresh read, even after cancelling.
    afterNextRender(
      () => {
        const target =
          this.needsReview() || this.forbidden() ? this.reloadButton() : this.trigger();
        target?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  protected confirm(): void {
    if (!this.opened() || this.disabled()) return;
    const article = this.article();
    this.pending.set(true);
    this.message.set('');
    this.api
      .remove(article.slug, { articleId: article.id, version: article.version })
      .pipe(
        takeUntil(this.cancelRequests),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => {
          this.finished.set(true);
          this.removed.emit('deleted');
        },
        error: (error: unknown) => {
          const result = readArticleDeletionError(error);
          if (result.missing) {
            this.finished.set(true);
            this.removed.emit('not-found');
            return;
          }
          this.message.set(result.message);
          this.needsReview.set(result.needsReview);
          this.forbidden.set(result.forbidden);
          if (result.sessionExpired) this.auth.expireSession();
        },
      });
  }

  protected reloadArticle(): void {
    if (this.pending()) return;
    this.reload.emit();
  }

  protected checkSession(): void {
    if (this.pending() || this.auth.pending() || this.auth.status() === 'checking') return;
    this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
