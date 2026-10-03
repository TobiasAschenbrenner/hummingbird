export const COMMENT_PAGE_SIZE = 20;
export interface PublicComment {
  id: number;
  articleId: number;
  body: string;
  createdAt: string;
  author: { id: number; username: string };
}
export interface CommentPage {
  articleId: number;
  comments: PublicComment[];
  total: number;
  nextCursor: number | null;
}
export interface CommentCreationInput {
  articleId: number;
  body: string;
  requestId: string;
}
