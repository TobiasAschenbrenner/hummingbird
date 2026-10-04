import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { finalize, Subject, takeUntil } from 'rxjs';
import { PublicComment } from '../../models/comment.model';
import { Auth } from '../../services/auth/auth';
import { CommentsApi } from '../../services/comments/comments';
import { readCommentDeletionError } from '../../services/comments/comment-error';

@Component({
  selector: 'app-comment-delete',
  imports: [RouterLink],
  templateUrl: './comment-delete.html',
  styleUrl: './comment-delete.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentDelete {
  readonly slug = input.required<string>();
  readonly comment = input.required<PublicComment>();
  readonly available = input(true);
  readonly removed = output<'deleted' | 'not-found'>();
  readonly reload = output<void>();
  protected readonly auth = inject(Auth);
  private readonly api = inject(CommentsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly cancelRequests = new Subject<void>();
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly reloadButton = viewChild<ElementRef<HTMLElement>>('reloadButton');
  private target = '';
  protected readonly finished = signal(false);
  protected readonly opened = signal(false);
  protected readonly pending = signal(false);
  protected readonly needsReview = signal(false);
  protected readonly message = signal('');
  protected readonly articleChanged = signal(false);
  protected readonly confirmationId = computed(() => `comment-deletion-${this.comment().id}`);
  protected readonly ownsComment = computed(
    () =>
      this.auth.status() === 'authenticated' && this.auth.user()?.id === this.comment().author.id,
  );
  protected readonly disabled = computed(
    () =>
      !this.ownsComment() ||
      !this.available() ||
      this.auth.pending() ||
      this.pending() ||
      this.finished() ||
      this.needsReview(),
  );

  constructor() {
    effect(() => {
      const comment = this.comment();
      const target = `${this.slug()}:${comment.articleId}:${comment.id}:${comment.author.id}`;
      untracked(() => {
        // An unrelated list refresh must not cancel a write to the same immutable comment.
        if (target === this.target && this.pending()) return;
        this.target = target;
        this.cancelRequests.next();
        this.opened.set(false);
        this.finished.set(false);
        this.message.set('');
        this.needsReview.set(false);
        this.articleChanged.set(false);
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
    afterNextRender(
      () => (this.needsReview() ? this.reloadButton() : this.trigger())?.nativeElement.focus(),
      { injector: this.injector },
    );
  }
  protected confirm(): void {
    if (!this.opened() || this.disabled()) return;
    const comment = this.comment();
    this.pending.set(true);
    this.message.set('');
    this.api
      .remove(this.slug(), comment.id, { articleId: comment.articleId })
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
          const result = readCommentDeletionError(error);
          if (result.missing) {
            this.finished.set(true);
            this.removed.emit('not-found');
            return;
          }
          this.message.set(result.message);
          this.needsReview.set(result.needsReview);
          this.articleChanged.set(result.articleChanged);
          if (result.sessionExpired) this.auth.expireSession();
        },
      });
  }
  protected reloadComments(): void {
    if (!this.pending()) this.reload.emit();
  }
  protected checkSession(): void {
    if (this.pending() || this.auth.pending() || this.auth.status() === 'checking') return;
    this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
