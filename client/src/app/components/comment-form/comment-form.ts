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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, startWith, Subject, takeUntil } from 'rxjs';
import { CommentCreationInput, PublicComment } from '../../models/comment.model';
import { Auth } from '../../services/auth/auth';
import { CommentsApi } from '../../services/comments/comments';
import { readCommentError } from '../../services/comments/comment-error';
import { commentBodyValidator } from '../../validators/comment.validator';

@Component({
  selector: 'app-comment-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './comment-form.html',
  styleUrl: './comment-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentForm {
  readonly slug = input.required<string>();
  readonly articleId = input.required<number>();
  readonly available = input(true);
  readonly posted = output<PublicComment>();
  protected readonly auth = inject(Auth);
  private readonly api = inject(CommentsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cancelRequests = new Subject<void>();
  protected readonly body = new FormControl('', {
    nonNullable: true,
    validators: [commentBodyValidator],
  });
  protected readonly form = new FormGroup({ body: this.body });
  private readonly draft = toSignal(this.body.valueChanges.pipe(startWith('')), {
    initialValue: '',
  });
  protected readonly characters = computed(() => [...this.draft()].length);
  protected readonly hasDraft = computed(() => !!this.draft().length);
  protected readonly pending = signal(false);
  protected readonly uncertain = signal(false);
  protected readonly blocked = signal(false);
  protected readonly message = signal('');
  protected readonly success = signal(false);
  private readonly submission = signal<{ input: CommentCreationInput; authorId: number } | null>(
    null,
  );
  protected readonly disabled = computed(
    () =>
      !this.available() ||
      this.pending() ||
      this.blocked() ||
      this.auth.pending() ||
      this.auth.status() !== 'authenticated',
  );
  protected readonly canRetry = computed(
    () =>
      !this.disabled() && this.uncertain() && this.auth.user()?.id === this.submission()?.authorId,
  );

  constructor() {
    effect(() => {
      this.slug();
      this.articleId();
      untracked(() => {
        this.cancelRequests.next();
        this.body.reset('');
        this.submission.set(null);
        this.uncertain.set(false);
        this.blocked.set(false);
        this.message.set('');
        this.success.set(false);
      });
    });
  }
  protected submit(): void {
    if (this.disabled() || this.uncertain()) return;
    this.body.markAsTouched();
    if (this.body.invalid) {
      this.success.set(false);
      this.message.set('Please check your comment.');
      return;
    }
    const authorId = this.auth.user()!.id;
    const previous = this.submission();
    const text = this.body.value;
    try {
      const input =
        previous && previous.authorId === authorId && previous.input.body === text
          ? previous.input
          : { articleId: this.articleId(), body: text, requestId: crypto.randomUUID() };
      this.submission.set({ input, authorId });
      this.send(input, authorId);
    } catch {
      this.message.set('We couldn’t prepare your comment. Reload Hummingbird and try again.');
    }
  }
  protected retrySubmission(): void {
    const submission = this.submission();
    if (!submission || !this.canRetry()) return;
    this.send(submission.input, submission.authorId);
  }
  private send(input: CommentCreationInput, authorId: number): void {
    this.pending.set(true);
    this.message.set('');
    this.success.set(false);
    this.api
      .publish(this.slug(), input, authorId)
      .pipe(
        takeUntil(this.cancelRequests),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: (comment) => {
          this.body.reset('');
          this.submission.set(null);
          this.uncertain.set(false);
          this.success.set(true);
          this.message.set('Comment posted.');
          this.posted.emit(comment);
        },
        error: (error: unknown) => {
          const result = readCommentError(error);
          this.message.set(result.message);
          this.uncertain.set(this.uncertain() || result.uncertain);
          this.blocked.set(result.blocked);
          if (result.sessionExpired) this.auth.expireSession();
        },
      });
  }
  protected checkSession(): void {
    if (this.pending() || this.auth.pending() || this.auth.status() === 'checking') return;
    this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
