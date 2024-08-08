// Type definition for the adapter
type Awaitable<T> = Promise<T> | T;
export interface KeyvNestStore<T> {
  get(key: string): Awaitable<T>;
  set(key: string, value: T, ...rest: any[]): Awaitable<any>;
  delete(key: string): Awaitable<any>;
  clear(): Awaitable<any>;
}
/**
 *
 */
export default function KeyvNest<T>(
  /** memory cache */
  cache: KeyvNestStore<T>,
  /** disk cache, network cache, ...etc */
  ...stores: KeyvNestStore<T>[]
): KeyvNestStore<T> {
  if (!stores.length) return cache;
  const _store = KeyvNest(stores[0], ...stores.slice(1));
  return {
    ...cache,
    async get(key: string) {
      const cached = await cache.get(key);
      if (cached) return cached;

      const stored = await _store.get(key);
      if (stored) cache.set(key, stored);
      return stored;
    },
    async set(key: string, value: any, ...options: any[]) {
      await cache.set(key, value, ...options);
      return _store.set(key, value, ...options);
    },
    async delete(key: string) {
      await cache.delete(key);
      return _store.delete(key);
    },
    async clear() {
      await cache.clear();
      return _store.clear();
    },
  };
}
