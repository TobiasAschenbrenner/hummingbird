import { CommentPage, PublicComment } from '../app/models/comment.model';
export function commentFixture(overrides: Partial<PublicComment> = {}): PublicComment {
  return {
    id: 1,
    articleId: 1,
    body: 'A useful comment.\n\nThank you!',
    createdAt: '2026-10-01T09:00:00.000Z',
    author: { id: 1, username: 'Reader' },
    ...overrides,
  };
}
export function commentPageFixture(articleId = 1): CommentPage {
  return { articleId, comments: [commentFixture({ articleId })], total: 1, nextCursor: null };
}
