import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';

import { ArticleDetail as Article } from '../../models/article.model';
import { ArticlesApi } from '../../services/articles/articles';
import { isArticleSlug, readArticlePage } from '../../validators/article.validator';

type ArticleState =
  | { status: 'loading' }
  | { status: 'ready'; article: Article }
  | { status: 'not-found' }
  | { status: 'error' };

@Component({
  selector: 'app-article-detail',
  imports: [DatePipe, RouterLink],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleDetail implements OnInit {
  private readonly api = inject(ArticlesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly title = inject(Title);
  private readonly retry = new Subject<void>();
  protected readonly state = signal<ArticleState>({ status: 'loading' });
  protected readonly listPage = toSignal(
    this.route.queryParamMap.pipe(map((params) => readArticlePage(params.getAll('page')) ?? 1)),
    { initialValue: 1 },
  );

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

  protected tryAgain(): void {
    if (this.state().status === 'error') this.retry.next();
  }
}
