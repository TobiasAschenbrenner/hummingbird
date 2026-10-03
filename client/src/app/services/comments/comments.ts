import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, timeout } from 'rxjs';
import { CommentCreationInput, CommentPage, PublicComment } from '../../models/comment.model';
import { isArticleSlug } from '../../validators/article.validator';
import { isCommentBody, isCommentId, isCommentRequestId } from '../../validators/comment.validator';
import { readCommentPage, readPostedComment } from './comment-response';

@Injectable({ providedIn: 'root' })
export class CommentsApi {
  private readonly http = inject(HttpClient);
  list(slug: string, articleId: number, before?: number): Observable<CommentPage> {
    return defer(() => {
      if (
        !isArticleSlug(slug) ||
        !isCommentId(articleId) ||
        (before !== undefined && !isCommentId(before))
      )
        throw new Error('Invalid comment target or cursor.');
      return this.http
        .get<unknown>(`/api/articles/${slug}/comments`, {
          params: before === undefined ? {} : { before },
        })
        .pipe(
          timeout(10000),
          map((response) => readCommentPage(response, articleId, before)),
        );
    });
  }
  publish(slug: string, input: CommentCreationInput, authorId: number): Observable<PublicComment> {
    return defer(() => {
      if (
        !isArticleSlug(slug) ||
        !isCommentId(input.articleId) ||
        !isCommentId(authorId) ||
        !isCommentBody(input.body) ||
        !isCommentRequestId(input.requestId)
      )
        throw new Error('Invalid comment input.');
      const body = { articleId: input.articleId, body: input.body, requestId: input.requestId };
      return this.http
        .post<unknown>(`/api/articles/${slug}/comments`, body, {
          withCredentials: true,
          headers: { 'X-Hummingbird-Request': '1' },
          observe: 'response',
        })
        .pipe(
          timeout(10000),
          map((response) => {
            if (![200, 201].includes(response.status))
              throw new Error('Unexpected comment creation response.');
            return readPostedComment(response.body, body.articleId, body.body, authorId);
          }),
        );
    });
  }
}
