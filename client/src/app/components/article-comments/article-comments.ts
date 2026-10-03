import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subject, takeUntil } from 'rxjs';
import { PublicComment } from '../../models/comment.model';
import { CommentsApi } from '../../services/comments/comments';
import { CommentForm } from '../comment-form/comment-form';

@Component({
  selector: 'app-article-comments',
  imports: [DatePipe, CommentForm],
  templateUrl: './article-comments.html',
  styleUrl: './article-comments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleComments {
  readonly slug = input.required<string>();
  readonly articleId = input.required<number>();
  readonly countChanged = output<number>();
  private readonly api = inject(CommentsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cancelReads = new Subject<void>();
  protected readonly comments = signal<PublicComment[]>([]);
  protected readonly pending = signal(false);
  protected readonly loaded = signal(false);
  protected readonly unavailable = signal(false);
  protected readonly message = signal('');
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly formAvailable = computed(
    () => this.loaded() && !this.pending() && !this.unavailable(),
  );
  constructor() {
    effect(() => {
      this.slug();
      this.articleId();
      untracked(() => {
        this.cancelReads.next();
        this.comments.set([]);
        this.loaded.set(false);
        this.unavailable.set(false);
        this.nextCursor.set(null);
        this.message.set('');
        this.load();
      });
    });
  }
  protected load(older = false): void {
    if (this.pending() || (older && this.nextCursor() === null)) return;
    const before = older ? this.nextCursor()! : undefined;
    this.pending.set(true);
    this.message.set('');
    this.api
      .list(this.slug(), this.articleId(), before)
      .pipe(
        takeUntil(this.cancelReads),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (page) => {
          this.comments.update((current) =>
            older
              ? [
                  ...current,
                  ...page.comments.filter(
                    (comment) => !current.some((existing) => existing.id === comment.id),
                  ),
                ]
              : page.comments,
          );
          this.nextCursor.set(page.nextCursor);
          this.loaded.set(true);
          this.unavailable.set(false);
          this.countChanged.emit(page.total);
        },
        error: (error: unknown) => {
          this.unavailable.set(error instanceof HttpErrorResponse && error.status === 404);
          this.message.set(
            this.unavailable()
              ? 'This article no longer exists. Copy your draft before leaving.'
              : 'We couldn’t load comments. Please try again.',
          );
        },
      });
  }
  protected commentPosted(comment: PublicComment): void {
    this.cancelReads.next();
    this.comments.update((current) => [
      comment,
      ...current.filter((existing) => existing.id !== comment.id),
    ]);
    // Refresh the authoritative count and newest page after a confirmed post or replay.
    this.load();
  }
}
