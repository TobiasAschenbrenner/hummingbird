import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, timeout } from 'rxjs';

import {
  ARTICLE_PAGE_SIZE,
  MAX_ARTICLE_PAGE,
  ArticleDetail,
  ArticleCreationInput,
  ArticleDeletionInput,
  ArticleUpdateInput,
  ArticlePage,
  ArticleFilters,
} from '../../models/article.model';
import { readArticleFilters } from '../../validators/article-list.validator';
import { isArticleSlug, isArticleVersion } from '../../validators/article.validator';
import { readArticleDetailResponse, readArticlePageResponse } from './article-response';

@Injectable({ providedIn: 'root' })
export class ArticlesApi {
  private readonly http = inject(HttpClient);

  publish(input: ArticleCreationInput): Observable<ArticleDetail> {
    return defer(() => {
      if (!isArticleSlug(input.slug)) throw new Error('Invalid article slug.');
      const body: ArticleCreationInput = {
        slug: input.slug,
        title: input.title.trim(),
        description: input.description.trim(),
        body: input.body,
        categoryId: input.categoryId,
        tagIds: [...input.tagIds],
      };
      return this.http
        .post<unknown>('/api/articles', body, {
          withCredentials: true,
          headers: { 'X-Hummingbird-Request': '1' },
        })
        .pipe(
          timeout(10_000),
          map((response) => readArticleDetailResponse(response, body.slug)),
        );
    });
  }

  update(slug: string, input: ArticleUpdateInput): Observable<ArticleDetail> {
    return defer(() => {
      if (!isArticleSlug(slug)) throw new Error('Invalid article slug.');
      if (!isArticleVersion(input.version)) throw new Error('Invalid article version.');
      const body: ArticleUpdateInput = {
        title: input.title.trim(),
        description: input.description.trim(),
        body: input.body,
        categoryId: input.categoryId,
        tagIds: [...input.tagIds],
        version: input.version,
      };
      return this.http
        .put<unknown>(`/api/articles/${slug}`, body, {
          withCredentials: true,
          headers: { 'X-Hummingbird-Request': '1' },
        })
        .pipe(
          timeout(10_000),
          map((response) => {
            const article = readArticleDetailResponse(response, slug);
            if (article.version !== (BigInt(body.version) + 1n).toString())
              throw new Error('Unexpected saved article version.');
            return article;
          }),
        );
    });
  }

  remove(slug: string, input: ArticleDeletionInput): Observable<void> {
    return defer(() => {
      if (!isArticleSlug(slug)) throw new Error('Invalid article slug.');
      if (!isArticleVersion(input.version)) throw new Error('Invalid article version.');
      if (!Number.isInteger(input.articleId) || input.articleId < 1 || input.articleId > 2147483647)
        throw new Error('Invalid article ID.');
      return this.http
        .delete(`/api/articles/${slug}`, {
          body: { articleId: input.articleId, version: input.version },
          withCredentials: true,
          headers: { 'X-Hummingbird-Request': '1' },
          observe: 'response',
          responseType: 'text',
        })
        .pipe(
          timeout(10_000),
          map((response) => {
            if (response.status !== 204 || (response.body !== null && response.body !== ''))
              throw new Error('Unexpected article deletion response.');
          }),
        );
    });
  }

  list(page: number, filters: ArticleFilters = {}): Observable<ArticlePage> {
    return defer(() => {
      if (!Number.isInteger(page) || page < 1 || page > MAX_ARTICLE_PAGE)
        throw new Error('Invalid article page.');
      const validated = readArticleFilters(filters);
      if (!validated) throw new Error('Invalid article filters.');
      return this.http
        .get<unknown>('/api/articles', {
          params: { page, pageSize: ARTICLE_PAGE_SIZE, ...validated },
        })
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
