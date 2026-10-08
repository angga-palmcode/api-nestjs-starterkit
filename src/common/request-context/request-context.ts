import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  request_id: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const requestContext = {
  run: <T>(store: RequestStore, fn: () => T): T => storage.run(store, fn),
  /** Id of the request currently being handled, if any. */
  getRequestId: (): string | undefined => storage.getStore()?.request_id,
};
