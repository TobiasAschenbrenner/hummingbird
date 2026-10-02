export interface ArticlePageInput {
  page: number;
  pageSize: number;
}

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
  pagination: ArticlePageInput & { total: number; totalPages: number };
}

export interface ArticleQueries {
  listArticles(input: ArticlePageInput): Promise<ArticlePage>;
  findArticleBySlug(slug: string): Promise<ArticleDetail | null>;
}
