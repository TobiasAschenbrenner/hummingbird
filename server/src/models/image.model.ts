export interface StoredImage {
  publicId: string;
  url: string;
  width: number;
  height: number;
}

export interface ImageStorage {
  newPublicId(): string;
  upload(publicId: string, processedImage: Buffer): Promise<StoredImage>;
  remove(publicId: string): Promise<void>;
}

export type PublicCover = Pick<StoredImage, 'url' | 'width' | 'height'>;
export interface CoverTarget {
  slug: string;
  articleId: number;
  authorId: number;
  version: string;
}
export interface CoverQueries {
  checkTarget(target: CoverTarget): Promise<void>;
  reserve(publicId: string): Promise<void>;
  attach(
    target: CoverTarget,
    image: StoredImage,
  ): Promise<import('./article.model.ts').ArticleDetail>;
  detach(target: CoverTarget): Promise<import('./article.model.ts').ArticleDetail>;
  listDetached(before: Date): Promise<string[]>;
  forgetDetached(publicId: string, before: Date): Promise<void>;
}
