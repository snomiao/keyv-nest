import type { StoredData } from "keyv";

// Type definition for the adapter
type Awaitable<T> = Promise<T> | T;

export interface KeyvNestOptions {
  ttl?: number;
  writeConcern?: number;
  [key: string]: unknown;
}

export interface KeyvNestStore<T = unknown> {
  opts?: unknown;
  namespace?: string;
  on?(event: string, listener: (...arguments_: unknown[]) => void): unknown;

  get(key: string): Awaitable<StoredData<T>>;
  set(key: string, value: StoredData<T>, options?: number | KeyvNestOptions): Awaitable<unknown>;
  delete(key: string): Awaitable<boolean>;
  clear(): Awaitable<void>;
  getMany?(keys: string[]): Awaitable<Array<StoredData<T | undefined>>>;
  setMany?(
    values: Array<{ key: string; value: StoredData<T>; ttl?: number }>,
  ): Awaitable<boolean[] | undefined>;
  has?(key: string): Awaitable<boolean>;
  hasMany?(keys: string[]): Awaitable<boolean[]>;
  deleteMany?(keys: string[]): Awaitable<boolean>;
  disconnect?(): Awaitable<void>;
  iterator?(namespace?: string): AsyncGenerator<Array<string | Awaited<T> | undefined>, void>;
}
/**
 * A multi-layered cache store that combines multiple Keyv-compatible stores.
 * 
 * @example
 * ```ts
 * import Keyv from "keyv";
 * import KeyvNest from "keyv-nest";
 * 
 * const nestedCache = new Keyv(KeyvNest(
 *  // Fastest In-memory cache * 
 *  new Map()，
 *  // Disk cache * 
 *  new KeyvSqlite("sqlite://path/to/database.sqlite")，
 *  // Slowest Network cache, but persistent
 *  new KeyvRedis("redis://user:pass@localhost:6379")，
 * ));
 * 
 * ```
 *
 */
export default function KeyvNest<T>(
  /** the fastest cache store, (usually memory cache) */
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
    async set(key: string, value: StoredData<T>, options?: number | KeyvNestOptions) {
      const opts: KeyvNestOptions | undefined =
        typeof options === "number" ? { ttl: options } : options;
      const writeConcern = opts?.writeConcern;

      if (writeConcern !== undefined && writeConcern <= 0) {
        const nextOptions = {
          ...(opts as Record<string, unknown>),
          writeConcern: -1,
        };
        void Promise.resolve(cache.set(key, value, opts)).then(() =>
          _store.set(key, value, nextOptions),
        );
        return;
      }

      await cache.set(key, value, opts);

      if (writeConcern !== undefined && writeConcern >= 1) {
        const nextOptions = {
          ...(opts as Record<string, unknown>),
          writeConcern: writeConcern - 1,
        };
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
          if (value !== undefined && value !== null) {
            return cache.set(missingKeys[index], value as StoredData<T>);
          }
          return Promise.resolve();
        }),
      );
      return [...cached, ...stored];
    },
    async setMany(values: Array<{ key: string; value: StoredData<T>; ttl?: number }>) {
      // For simplicity, writeConcern is not directly supported in setMany parameters
      // Use individual set() calls for writeConcern control if needed
      const cacheSetMany =
        cache.setMany?.bind(cache) ||
        ((vals: typeof values) => Promise.all(vals.map((v) => cache.set(v.key, v.value, v.ttl))));

      await cacheSetMany(values);

      const storeSetMany =
        _store.setMany?.bind(_store) ||
        ((vals: typeof values) => Promise.all(vals.map((v) => _store.set(v.key, v.value, v.ttl))));

      await storeSetMany(values);
      return values.map(() => true);
    },
    async deleteMany(keys: string[]) {
      const cacheDeleteMany =
        cache.deleteMany?.bind(cache) ||
        ((ks: string[]) => Promise.all(ks.map((key) => cache.delete(key))).then(() => true));

      const storeDeleteMany =
        _store.deleteMany?.bind(_store) ||
        ((ks: string[]) => Promise.all(ks.map((key) => _store.delete(key))).then(() => true));

      await cacheDeleteMany(keys);
      return storeDeleteMany(keys);
    },
    async has(key: string) {
      const cacheHas =
        cache.has?.bind(cache) ||
        (async (k: string) => {
          const value = await cache.get(k);
          return value !== undefined && value !== null;
        });

      if (await cacheHas(key)) return true;

      const storeHas =
        _store.has?.bind(_store) ||
        (async (k: string) => {
          const value = await _store.get(k);
          return value !== undefined && value !== null;
        });

      return storeHas(key);
    },
    async hasMany(keys: string[]) {
      const cacheHasMany =
        cache.hasMany?.bind(cache) ||
        ((ks: string[]) =>
          Promise.all(
            ks.map((k) =>
              (async () => {
                const value = await cache.get(k);
                return value !== undefined && value !== null;
              })(),
            ),
          ));

      const cachedResults = await cacheHasMany(keys);
      const keysToCheck = keys.filter((_, index) => !cachedResults[index]);

      if (!keysToCheck.length) return cachedResults;

      const storeHasMany =
        _store.hasMany?.bind(_store) ||
        ((ks: string[]) =>
          Promise.all(
            ks.map((k) =>
              (async () => {
                const value = await _store.get(k);
                return value !== undefined && value !== null;
              })(),
            ),
          ));

      const storeResults = await storeHasMany(keysToCheck);

      let storeIndex = 0;
      return cachedResults.map((cached) => (cached ? true : storeResults[storeIndex++]));
    },
    async disconnect() {
      if (cache.disconnect) await cache.disconnect();
      if (_store.disconnect) await _store.disconnect();
    },
    /**
     * Async iterator to go through all key-value pairs in all the nested layers stores.
     * It yields entries from the cache first, then from the underlying store,
     * ensuring no duplicates.
     *
     * @param namespace Optional namespace to filter the keys.
     */
    async *iterator(namespace?: string) {
      const seenKeys = new Set<string>();

      if (cache.iterator) {
        for await (const entry of cache.iterator(namespace)) {
          const key = entry[0] as string;
          seenKeys.add(key);
          yield entry;
        }
      }

      if (_store.iterator) {
        for await (const entry of _store.iterator(namespace)) {
          const key = entry[0] as string;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            yield entry;
          }
        }
      }
    },
  };
}
