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
