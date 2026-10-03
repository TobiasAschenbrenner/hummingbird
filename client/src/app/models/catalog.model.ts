export interface CatalogEntry {
  id: number;
  slug: string;
  name: string;
}

export interface ArticleOptions {
  categories: CatalogEntry[];
  tags: CatalogEntry[];
}
