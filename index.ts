// Type definition for the adapter
type Awaitable<T> = Promise<T> | T;
export interface KeyvNestStore<T> {
  get(key: string): Awaitable<T>;
  set(key: string, value: T, ...rest: any[]): Awaitable<any>;
  delete(key: string): Awaitable<any>;
  clear(): Awaitable<any>;
  getMany?(keys: string[]): Awaitable<T[]>;
}
/**
 *
 */
export default function KeyvNest<T>(
  /** memory cache, should be fastest */
  cache: KeyvNestStore<T>,
  /** disk cache, network cache, ...etc, could be slower */
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
      if (stored) await cache.set(key, stored);
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
    async getMany(keys: string[]) {
      const cached = await Promise.all(keys.map((key) => cache.get(key)));
      const missingKeys = keys.filter((_, index) => !cached[index]);
      if (!missingKeys.length) return cached;

      const getMany =
        _store.getMany?.bind(_store) ||
        ((keys: string[]) => Promise.all(keys.map((key) => _store.get(key))));
      const stored = await getMany(missingKeys);
      await Promise.all(
        stored.map((value, index) => {
          if (value !== undefined) {
            return cache.set(missingKeys[index], value);
          }
        })
      );
      return [...cached, ...stored];
    },
  };
}
