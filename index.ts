import type { KeyvStoreAdapter, StoredData } from "keyv";

// Type definition for the adapter
type Awaitable<T> = Promise<T> | T;

export interface KeyvNestOptions {
  ttl?: number;
  writeConcern?: number;
  [key: string]: any;
}

export interface KeyvNestStore<T = any> {
  opts?: any;
  namespace?: string;
  on?(event: string, listener: (...arguments_: any[]) => void): any;

  get(key: string): Awaitable<StoredData<T>>;
  set(key: string, value: any, options?: number | KeyvNestOptions): Awaitable<any>;
  delete(key: string): Awaitable<boolean>;
  clear(): Awaitable<void>;
  getMany?(keys: string[]): Awaitable<Array<StoredData<T | undefined>>>;
  setMany?(values: Array<{ key: string; value: any; ttl?: number }>): Awaitable<boolean[] | void>;
  has?(key: string): Awaitable<boolean>;
  hasMany?(keys: string[]): Awaitable<boolean[]>;
  deleteMany?(keys: string[]): Awaitable<boolean>;
  disconnect?(): Awaitable<void>;
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
    async set(key: string, value: any, options?: number | KeyvNestOptions) {
      const opts = typeof options === 'number' ? { ttl: options } : options;
      const writeConcern = opts?.writeConcern;

      if (writeConcern !== undefined && writeConcern <= 0) {
        const nextOptions = { ...opts, writeConcern: -1 };
        cache.set(key, value, opts).then(() => _store.set(key, value, nextOptions));
        return;
      }

      await cache.set(key, value, opts);

      if (writeConcern !== undefined && writeConcern >= 1) {
        const nextOptions = { ...opts, writeConcern: writeConcern - 1 };
        if (writeConcern === 1) {
          _store.set(key, value, nextOptions);
          return;
        }
        return _store.set(key, value, nextOptions);
      }

      return _store.set(key, value, opts);
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
        stored.map((value: StoredData<T | undefined>, index: number) => {
          if (value !== undefined) {
            return cache.set(missingKeys[index], value);
          }
        })
      );
      return [...cached, ...stored];
    },
  };
}
