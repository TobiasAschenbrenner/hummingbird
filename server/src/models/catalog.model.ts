export interface CatalogEntry {
  id: number;
  slug: string;
  name: string;
}

export interface CatalogQueries {
  listCategories(): Promise<CatalogEntry[]>;
  listTags(): Promise<CatalogEntry[]>;
}
