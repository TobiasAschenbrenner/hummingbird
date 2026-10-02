export const ARTICLE_PAGE_SIZE = 12;
export const MAX_ARTICLE_PAGE = 10_000;

export interface ArticleSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  imageFilename: string | null;
  createdAt: string;
  author: { id: number; username: string };
  category: { id: number; slug: string; name: string };
  tags: { id: number; slug: string; name: string }[];
  commentCount: number;
}

export interface ArticleDetail extends ArticleSummary {
  body: string;
  version: string;
}

export interface ArticlePage {
  articles: ArticleSummary[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
