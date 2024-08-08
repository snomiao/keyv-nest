// Type definition for the adapter
export interface KeyvNestStore<T> {
  get(key: string): Promise<T>;
  set(key: string, value: T, ...rest: any[]): Promise<any>;
  delete(key: string): Promise<any>;
  clear(): Promise<any>;
}
/**
 *
 */
export default function KeyvNest<T>(
  /** memory cache */
  cache: KeyvNestStore<T>,
  /** disk cache */
  store: KeyvNestStore<T>,
  /** network cache */
  ...rest: KeyvNestStore<T>[]
): KeyvNestStore<T> {
  const _store = !rest.length
    ? store
    : KeyvNest(store, rest[0], ...rest.slice(1));
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
