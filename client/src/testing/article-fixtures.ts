import { ARTICLE_PAGE_SIZE, ArticleDetail, ArticlePage } from '../app/models/article.model';

export function articleFixture(overrides: Partial<ArticleDetail> = {}): ArticleDetail {
  return {
    id: 1,
    slug: 'article-1',
    title: 'Article 1',
    description: 'A useful introduction.',
    imageFilename: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    author: { id: 1, username: 'Author 🐦' },
    category: { id: 1, slug: 'tech', name: 'Tech' },
    tags: [{ id: 1, slug: 'databases', name: 'Databases' }],
    commentCount: 1,
    body: 'First paragraph.\n\nSecond paragraph.',
    version: '1',
    ...overrides,
  };
}

export function articlePageFixture(page = 1, total = 1): ArticlePage {
  const start = (page - 1) * ARTICLE_PAGE_SIZE;
  const length = Math.min(ARTICLE_PAGE_SIZE, Math.max(0, total - start));
  return {
    articles: Array.from({ length }, (_, index) => {
      const id = start + index + 1;
      const {
        body: _body,
        version: _version,
        ...summary
      } = articleFixture({ id, slug: `article-${id}`, title: `Article ${id}` });
      return summary;
    }),
    pagination: {
      page,
      pageSize: ARTICLE_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / ARTICLE_PAGE_SIZE),
    },
  };
}
