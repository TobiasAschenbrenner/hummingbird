import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';

import { ArticleCard } from '../../components/article-card/article-card';
import { ArticlePage, MAX_ARTICLE_PAGE } from '../../models/article.model';
import { ArticlesApi } from '../../services/articles/articles';
import { readArticlePage } from '../../validators/article.validator';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; data: ArticlePage }
  | { status: 'invalid' }
  | { status: 'error' };

@Component({
  selector: 'app-home',
  imports: [ArticleCard, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home implements OnInit {
  private readonly api = inject(ArticlesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retry = new Subject<void>();
  protected readonly maxPage = MAX_ARTICLE_PAGE;
  protected readonly state = signal<PageState>({ status: 'loading' });

  ngOnInit(): void {
    combineLatest([this.route.queryParamMap, this.retry.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          const page = readArticlePage(params.getAll('page'));
          if (page === null) return of<PageState>({ status: 'invalid' });
          return this.api.list(page).pipe(
            map((data): PageState => ({ status: 'ready', data })),
            startWith<PageState>({ status: 'loading' }),
            catchError(() => of<PageState>({ status: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected tryAgain(): void {
    if (this.state().status === 'error') this.retry.next();
  }
}
