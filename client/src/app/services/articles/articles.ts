import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, timeout } from 'rxjs';

import {
  ARTICLE_PAGE_SIZE,
  MAX_ARTICLE_PAGE,
  ArticleDetail,
  ArticlePage,
} from '../../models/article.model';
import { isArticleSlug } from '../../validators/article.validator';
import { readArticleDetailResponse, readArticlePageResponse } from './article-response';

@Injectable({ providedIn: 'root' })
export class ArticlesApi {
  private readonly http = inject(HttpClient);

  list(page: number): Observable<ArticlePage> {
    return defer(() => {
      if (!Number.isInteger(page) || page < 1 || page > MAX_ARTICLE_PAGE)
        throw new Error('Invalid article page.');
      return this.http
        .get<unknown>('/api/articles', { params: { page, pageSize: ARTICLE_PAGE_SIZE } })
        .pipe(
          timeout(10_000),
          map((response) => readArticlePageResponse(response, page)),
        );
    });
  }

  detail(slug: string): Observable<ArticleDetail> {
    return defer(() => {
      if (!isArticleSlug(slug)) throw new Error('Invalid article slug.');
      return this.http.get<unknown>(`/api/articles/${encodeURIComponent(slug)}`).pipe(
        timeout(10_000),
        map((response) => readArticleDetailResponse(response, slug)),
      );
    });
  }
}
