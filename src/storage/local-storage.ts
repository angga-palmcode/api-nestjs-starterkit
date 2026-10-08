import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { StorageNotFoundError, assertSafeKey } from './storage.types';
import type { PutOptions, StorageService } from './storage.types';

/**
 * Files on a local directory. For development, tests and single-node deployments.
 * Writes are atomic (temp file + rename), and the resolved path is checked to stay inside the root.
 */
export class LocalStorage implements StorageService {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private pathOf(key: string): string {
    assertSafeKey(key);
    const path = resolve(this.root, key);
    // Defence in depth on top of assertSafeKey (symlinks aside).
    if (!path.startsWith(this.root + sep)) {
      throw new StorageNotFoundError(key);
    }
    return path;
  }

  async put(
    key: string,
    body: Buffer | Uint8Array | string,
    _options?: PutOptions,
  ): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, body);
    await rename(temp, path);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathOf(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageNotFoundError(key);
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /** A directory cannot presign; serve the file through an authenticated endpoint instead. */
  signedUrl(key: string): Promise<string | null> {
    // Still validates the key, and rejects (never throws synchronously) like the other methods.
    return Promise.resolve().then(() => {
      this.pathOf(key);
      return null;
    });
  }
}
