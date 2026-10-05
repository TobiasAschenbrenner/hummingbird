import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';

import { ArticleComments } from '../../components/article-comments/article-comments';
import { ArticleDelete } from '../../components/article-delete/article-delete';
import { ArticleDetail as Article } from '../../models/article.model';
import { Auth } from '../../services/auth/auth';
import { ArticlesApi } from '../../services/articles/articles';
import { articleListParams, readArticleListQuery } from '../../validators/article-list.validator';
import { isArticleSlug } from '../../validators/article.validator';

type ArticleState =
  | { status: 'loading' }
  | { status: 'ready'; article: Article }
  | { status: 'not-found' }
  | { status: 'deleted' }
  | { status: 'error' };

@Component({
  selector: 'app-article-detail',
  imports: [DatePipe, RouterLink, ArticleDelete, ArticleComments],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleDetail implements OnInit {
  protected readonly auth = inject(Auth);
  private readonly api = inject(ArticlesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly title = inject(Title);
  private readonly retry = new Subject<void>();
  protected readonly state = signal<ArticleState>({ status: 'loading' });
  private readonly listContext = toSignal(
    this.route.queryParamMap.pipe(map((params) => readArticleListQuery(params) ?? { page: 1 })),
    { initialValue: { page: 1 } },
  );

  protected readonly listQuery = computed(() => articleListParams(this.listContext()));

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.retry.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          const slug = params.get('slug');
          if (!isArticleSlug(slug)) return of<ArticleState>({ status: 'not-found' });
          return this.api.detail(slug).pipe(
            map((article): ArticleState => ({ status: 'ready', article })),
            startWith<ArticleState>({ status: 'loading' }),
            catchError((error: unknown) =>
              of<ArticleState>({
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
        this.title.setTitle(
          state.status === 'ready'
            ? `Hummingbird | ${state.article.title}`
            : state.status === 'not-found'
              ? 'Hummingbird | Article not found'
              : 'Hummingbird | Article',
        );
      });
  }

  protected updateCommentCount(total: number): void {
    const current = this.state();
    if (current.status === 'ready' && current.article.commentCount !== total)
      this.state.set({ status: 'ready', article: { ...current.article, commentCount: total } });
  }

  protected reloadArticle(): void {
    if (this.state().status === 'ready') this.retry.next();
  }

  protected articleRemoved(result: 'deleted' | 'not-found'): void {
    this.state.set({ status: result });
    this.title.setTitle(
      result === 'deleted' ? 'Hummingbird | Article deleted' : 'Hummingbird | Article not found',
    );
    if (result === 'deleted') {
      // Keep the confirmation visible if navigation fails; the back link still works.
      void this.router.navigate(['/'], { queryParams: this.listQuery() }).catch(() => undefined);
    }
  }

  protected tryAgain(): void {
    if (this.state().status === 'error') this.retry.next();
  }
}
