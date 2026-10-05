import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap, tap } from 'rxjs';

import { ArticleFilters } from '../../components/article-filters/article-filters';
import { ArticleCard } from '../../components/article-card/article-card';
import {
  ArticlePage,
  ArticleListQuery,
  ArticleFilters as Filters,
  MAX_ARTICLE_PAGE,
} from '../../models/article.model';
import { ArticlesApi } from '../../services/articles/articles';
import { articleListParams, readArticleListQuery } from '../../validators/article-list.validator';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; data: ArticlePage }
  | { status: 'invalid' }
  | { status: 'error' };

@Component({
  selector: 'app-home',
  imports: [ArticleCard, ArticleFilters, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home implements OnInit {
  private readonly api = inject(ArticlesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retry = new Subject<void>();
  protected readonly maxPage = MAX_ARTICLE_PAGE;
  protected readonly state = signal<PageState>({ status: 'loading' });
  protected readonly query = signal<ArticleListQuery>({ page: 1 });
  protected readonly filtered = computed(
    () => !!(this.query().q || this.query().category || this.query().tag),
  );
  protected readonly navigationMessage = signal('');

  ngOnInit(): void {
    const queries = this.route.queryParamMap.pipe(
      map(readArticleListQuery),
      tap((query) => {
        this.query.set(query ?? { page: 1 });
        this.navigationMessage.set('');
      }),
    );
    combineLatest([queries, this.retry.pipe(startWith(undefined))])
      .pipe(
        switchMap(([query]) => {
          if (!query) return of<PageState>({ status: 'invalid' });
          return this.api.list(query.page, query).pipe(
            map((data): PageState => ({ status: 'ready', data })),
            startWith<PageState>({ status: 'loading' }),
            catchError(() => of<PageState>({ status: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected pageParams(page: number): Record<string, string | number> {
    return articleListParams(this.query(), page);
  }

  protected applyFilters(filters: Filters): void {
    this.navigationMessage.set('');
    void this.router
      .navigate(['/'], { queryParams: articleListParams({ page: 1, ...filters }) })
      .catch(() => this.navigationMessage.set('We couldn’t update the filters. Please try again.'));
  }

  protected tryAgain(): void {
    if (this.state().status === 'error') this.retry.next();
  }
}
