import type { CatalogEntry } from './catalog.model.ts';

export interface ArticleCreationInput {
  slug: string;
  title: string;
  description: string;
  body: string;
  categoryId: number;
  tagIds: number[];
}

export type ArticleUpdateInput = Omit<ArticleCreationInput, 'slug'> & { version: string };

export interface UpdateArticleInput extends ArticleUpdateInput {
  slug: string;
  authorId: number;
}

export interface CreateArticleInput extends ArticleCreationInput {
  authorId: number;
}

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
  category: CatalogEntry;
  tags: CatalogEntry[];
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
  createArticle(input: CreateArticleInput): Promise<ArticleDetail>;
  updateArticle(input: UpdateArticleInput): Promise<ArticleDetail>;
  listArticles(input: ArticlePageInput): Promise<ArticlePage>;
  findArticleBySlug(slug: string): Promise<ArticleDetail | null>;
}
