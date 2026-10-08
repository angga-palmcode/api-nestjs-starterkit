import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageNotFoundError, assertSafeKey } from './storage.types';
import type {
  PutOptions,
  SignedUrlOptions,
  StorageService,
} from './storage.types';

const DEFAULT_EXPIRY = 900;
const MAX_EXPIRY = 7 * 24 * 3600; // S3 SigV4 limit

const isMissing = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  );
};

/** Any S3-compatible service (AWS S3, MinIO, Backblaze B2, Cloudflare R2...). */
export class S3Storage implements StorageService {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(
    key: string,
    body: Buffer | Uint8Array | string,
    options: PutOptions = {},
  ): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new StorageNotFoundError(key);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (isMissing(error)) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async signedUrl(
    key: string,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    assertSafeKey(key);
    const expiresIn = Math.min(
      Math.max(options.expiresInSeconds ?? DEFAULT_EXPIRY, 1),
      MAX_EXPIRY,
    );
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.downloadAs
          ? {
              ResponseContentDisposition: `attachment; filename="${options.downloadAs.replace(/["\\\r\n]/g, '_')}"`,
            }
          : {}),
      }),
      { expiresIn },
    );
  }
}
