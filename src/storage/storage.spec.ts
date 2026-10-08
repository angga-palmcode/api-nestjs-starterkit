import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseEnv, testEnv } from '../../test/helpers/test-env';
import { validateEnv } from '../config/env.schema';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import {
  InvalidStorageKeyError,
  STORAGE,
  StorageNotFoundError,
  StorageService,
  assertSafeKey,
} from './storage.types';
import { StorageModule } from './storage.module';

/** A tiny in-memory S3: just the commands the adapter uses, with S3's error names. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; contentType?: string }>();
  const missing = (name: string) =>
    Object.assign(new Error(name), {
      name,
      $metadata: { httpStatusCode: 404 },
    });
  const client = {
    send: (command: unknown): Promise<unknown> => {
      if (command instanceof PutObjectCommand) {
        const { Key, Body, ContentType } = command.input;
        objects.set(Key as string, {
          body: Buffer.from(Body as Buffer | string),
          contentType: ContentType,
        });
        return Promise.resolve({});
      }
      if (command instanceof GetObjectCommand) {
        const found = objects.get(command.input.Key as string);
        if (!found) return Promise.reject(missing('NoSuchKey'));
        return Promise.resolve({
          Body: {
            transformToByteArray: () =>
              Promise.resolve(new Uint8Array(found.body)),
          },
        });
      }
      if (command instanceof HeadObjectCommand) {
        return objects.has(command.input.Key as string)
          ? Promise.resolve({})
          : Promise.reject(missing('NotFound'));
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(command.input.Key as string);
        return Promise.resolve({});
      }
      return Promise.reject(new Error('unexpected command'));
    },
  };
  return { client: client as unknown as S3Client, objects };
}

const UNSAFE_KEYS = [
  '',
  '/etc/passwd',
  '../secret.txt',
  'a/../../secret.txt',
  'a/./b.txt',
  'a//b.txt',
  'a/b/',
  '.hidden',
  'a\\b.txt',
  'a b.txt',
  'a\0b.txt',
  'x'.repeat(513),
  'résumé.pdf',
];

function contract(name: string, create: () => Promise<StorageService>) {
  describe(`${name} (storage contract)`, () => {
    let storage: StorageService;
    beforeEach(async () => {
      storage = await create();
    });

    it('stores and returns bytes and text, including nested keys', async () => {
      await storage.put('avatars/2026/ani.png', Buffer.from([0, 1, 2, 255]));
      await storage.put('notes/readme.txt', 'héllo');
      expect([...(await storage.get('avatars/2026/ani.png'))]).toEqual([
        0, 1, 2, 255,
      ]);
      expect((await storage.get('notes/readme.txt')).toString('utf8')).toBe(
        'héllo',
      );
    });

    it('overwrites', async () => {
      await storage.put('a.txt', 'one');
      await storage.put('a.txt', 'two');
      expect((await storage.get('a.txt')).toString()).toBe('two');
    });

    it('exists() and idempotent delete()', async () => {
      expect(await storage.exists('gone.txt')).toBe(false);
      await storage.put('gone.txt', 'x');
      expect(await storage.exists('gone.txt')).toBe(true);
      await storage.delete('gone.txt');
      expect(await storage.exists('gone.txt')).toBe(false);
      await expect(storage.delete('gone.txt')).resolves.toBeUndefined();
    });

    it('get() of a missing key throws StorageNotFoundError', async () => {
      await expect(storage.get('missing.txt')).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it.each(UNSAFE_KEYS)(
      'rejects the unsafe key %j everywhere',
      async (key) => {
        await expect(storage.put(key, 'x')).rejects.toBeInstanceOf(
          InvalidStorageKeyError,
        );
        await expect(storage.get(key)).rejects.toBeInstanceOf(
          InvalidStorageKeyError,
        );
        await expect(storage.exists(key)).rejects.toBeInstanceOf(
          InvalidStorageKeyError,
        );
        await expect(storage.delete(key)).rejects.toBeInstanceOf(
          InvalidStorageKeyError,
        );
        await expect(storage.signedUrl(key)).rejects.toBeInstanceOf(
          InvalidStorageKeyError,
        );
      },
    );
  });
}

describe('assertSafeKey', () => {
  it.each([
    'a.txt',
    'a/b/c.tar.gz',
    'users/0f8fad5b/avatar_1-final.png',
    '1.txt',
  ])('accepts %s', (key) => expect(() => assertSafeKey(key)).not.toThrow());
});

describe('LocalStorage', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kit-storage-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  contract('LocalStorage', () =>
    Promise.resolve(new LocalStorage(join(dir, 'case'))),
  );

  it('cannot presign (returns null)', async () => {
    await expect(new LocalStorage(dir).signedUrl('a.txt')).resolves.toBeNull();
  });

  it('writes atomically: no temp files are left behind', async () => {
    const storage = new LocalStorage(join(dir, 'atomic'));
    await storage.put('x/y.txt', 'data');
    expect(await readdir(join(dir, 'atomic', 'x'))).toEqual(['y.txt']);
  });

  it('never writes outside its root', async () => {
    const root = join(dir, 'jail');
    const storage = new LocalStorage(root);
    await expect(storage.put('../escape.txt', 'x')).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    expect(await readdir(dir)).not.toContain('escape.txt');
  });
});

describe('S3Storage', () => {
  contract('S3Storage', () =>
    Promise.resolve(new S3Storage(fakeS3().client, 'bucket')),
  );

  it('sends the bucket, key, body and content type', async () => {
    const { client, objects } = fakeS3();
    const send = jest.spyOn(client, 'send');
    await new S3Storage(client, 'my-bucket').put('docs/a.pdf', 'pdf', {
      contentType: 'application/pdf',
    });
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: 'my-bucket',
      Key: 'docs/a.pdf',
      ContentType: 'application/pdf',
    });
    expect(objects.get('docs/a.pdf')?.contentType).toBe('application/pdf');
  });

  it('rethrows unexpected S3 errors (only "missing" is mapped)', async () => {
    const client = {
      send: () =>
        Promise.reject(
          Object.assign(new Error('boom'), {
            name: 'AccessDenied',
            $metadata: { httpStatusCode: 403 },
          }),
        ),
    } as unknown as S3Client;
    const storage = new S3Storage(client, 'b');
    await expect(storage.get('a.txt')).rejects.toThrow('boom');
    await expect(storage.exists('a.txt')).rejects.toThrow('boom');
  });

  describe('signedUrl (presigning is offline, so this uses a real client)', () => {
    const storage = new S3Storage(
      new S3Client({
        region: 'eu-west-1',
        endpoint: 'https://s3.example.com',
        forcePathStyle: true,
        credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
      }),
      'my-bucket',
    );

    it('creates a time-limited URL for the object', async () => {
      const url = new URL(
        await storage.signedUrl('docs/a.pdf', {
          expiresInSeconds: 60,
        }),
      );
      expect(url.origin).toBe('https://s3.example.com');
      expect(url.pathname).toBe('/my-bucket/docs/a.pdf');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIDEXAMPLE');
    });

    it('defaults to 15 minutes and caps at 7 days', async () => {
      const expires = async (seconds?: number) =>
        new URL(
          await storage.signedUrl('a.txt', {
            expiresInSeconds: seconds,
          }),
        ).searchParams.get('X-Amz-Expires');
      expect(await expires()).toBe('900');
      expect(await expires(10 ** 9)).toBe(String(7 * 24 * 3600));
      expect(await expires(0)).toBe('1');
    });

    it('sets a safe download name', async () => {
      const url = new URL(
        await storage.signedUrl('a.pdf', {
          downloadAs: 'my "report"\r\n.pdf',
        }),
      );
      const disposition = url.searchParams.get('response-content-disposition');
      expect(disposition).toBe('attachment; filename="my _report___.pdf"');
    });
  });
});

describe('StorageModule', () => {
  const compile = (env: Record<string, string>) => {
    @Global()
    @Module({
      providers: [
        { provide: ConfigService, useValue: new ConfigService(testEnv(env)) },
      ],
      exports: [ConfigService],
    })
    class FakeCoreModule {}
    return Test.createTestingModule({
      imports: [FakeCoreModule, StorageModule],
    }).compile();
  };

  it('local by default', async () => {
    const moduleRef = await compile({});
    expect(moduleRef.get(STORAGE)).toBeInstanceOf(LocalStorage);
  });

  it('S3 when configured', async () => {
    const moduleRef = await compile({
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'b',
      S3_REGION: 'eu-west-1',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT: 'https://s3.example.com',
    });
    expect(moduleRef.get(STORAGE)).toBeInstanceOf(S3Storage);
  });
});

describe('storage environment validation', () => {
  const env = (o: Record<string, string | undefined>) =>
    validateEnv({ ...baseEnv, ...o });

  it('s3 needs bucket, region and both keys', () => {
    expect(() => env({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() =>
      env({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_REGION: 'r',
        S3_ACCESS_KEY_ID: 'i',
      }),
    ).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(() =>
      env({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_REGION: 'r',
        S3_ACCESS_KEY_ID: 'i',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    ).not.toThrow();
  });

  it('defaults to a local directory and validates the endpoint URL', () => {
    expect(env({})).toMatchObject({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: './storage-data',
    });
    expect(() => env({ S3_ENDPOINT: 'not a url' })).toThrow(/S3_ENDPOINT/);
  });
});
