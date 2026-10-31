export const COMMENT_PAGE_SIZE = 20;

export interface CommentCreationInput {
  articleId: number;
  body: string;
  requestId: string;
}
export interface CreateCommentInput extends CommentCreationInput {
  slug: string;
  authorId: number;
}
export interface CommentDeletionInput {
  articleId: number;
}
export interface DeleteCommentInput extends CommentDeletionInput {
  slug: string;
  commentId: number;
  authorId: number;
}
export interface CommentPageInput {
  slug: string;
  before?: number;
}
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
export interface CommentQueries {
  createComment(input: CreateCommentInput): Promise<{ comment: PublicComment; created: boolean }>;
  listComments(input: CommentPageInput): Promise<CommentPage>;
  deleteComment(input: DeleteCommentInput): Promise<void>;
}
