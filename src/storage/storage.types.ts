export interface PutOptions {
  contentType?: string;
}

export interface SignedUrlOptions {
  /** Default 900 (15 minutes). */
  expiresInSeconds?: number;
  /** Suggested download file name (sets Content-Disposition). */
  downloadAs?: string;
}

/**
 * File storage seam. Keys are `folder/sub-folder/file.ext` (see `assertSafeKey`). The API is
 * deliberately Buffer-based: for large uploads/downloads give clients a presigned URL
 * (`signedUrl`) instead of proxying bytes through the app.
 */
export interface StorageService {
  put(
    key: string,
    body: Buffer | Uint8Array | string,
    options?: PutOptions,
  ): Promise<void>;
  /** Throws `StorageNotFoundError` when the key does not exist. */
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
  /** A time-limited download URL, or `null` when the driver cannot presign (local disk). */
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string | null>;
}

export const STORAGE = Symbol('STORAGE');

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

export class InvalidStorageKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key "${key}": ${reason}`);
    this.name = 'InvalidStorageKeyError';
  }
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/**
 * Keys come from application code but often embed user input (file names), so both drivers
 * validate: no traversal (`..`), no absolute paths, no empty segments, no odd characters.
 */
export function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidStorageKeyError(String(key), 'must not be empty');
  }
  if (key.length > 512) throw new InvalidStorageKeyError(key, 'too long');
  if (!SAFE_KEY.test(key)) {
    throw new InvalidStorageKeyError(
      key,
      'use letters, digits, ".", "_", "-" and "/", starting with a letter or digit',
    );
  }
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new InvalidStorageKeyError(key, 'empty, "." or ".." segment');
  }
  if (key.endsWith('/'))
    throw new InvalidStorageKeyError(key, 'must not end with "/"');
}
