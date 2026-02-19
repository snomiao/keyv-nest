# KeyvNest

[![npm version](https://badge.fury.io/js/keyv-nest.svg)](https://www.npmjs.com/package/keyv-nest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`KeyvNest` is a hierarchical caching adapter for the [Keyv](https://github.com/lukechilds/keyv) module. It allows you to nest multiple caching layers, such as memory cache, disk cache, and network cache, to create a multi-layered caching mechanism that boosts user experience by optimizing data retrieval across different storage tiers.

## Features

- 🚀 **Multi-layer caching**: Nest unlimited cache layers with automatic promotion
- ⚡ **Performance optimized**: Fast reads from primary cache with automatic fallback
- 🔄 **Write concern control**: Fine-grained control over synchronous/asynchronous writes
- 🔌 **Keyv compatible**: Works seamlessly with any Keyv store adapter
- 📦 **TypeScript support**: Full type definitions included
- 🎯 **Simple API**: Easy to use and integrate

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Installation

You can install the module via npm:

```sh
npm install keyv-nest
```

Or using bun:

```sh
bun add keyv-nest
```

## Usage

First, import the module and create instances of your cache stores. Then, use `KeyvNest` to create a hierarchical caching structure.

```typescript
import Keyv from 'keyv';
import KeyvNest from 'keyv-nest';

const memoryCache = new Keyv({ store: new Map() });
const diskCache = new Keyv({ store: new KeyvFileStore('/path/to/store') });
const networkCache = new Keyv({ store: new SomeNetworkStore() });

const nestedCache = KeyvNest(memoryCache, diskCache, networkCache);

(async () => {
  await nestedCache.set('foo', 'bar');
  const value = await nestedCache.get('foo');
  console.log(value); // 'bar'
})();
```

### Advanced Example with Write Concern

KeyvNest supports write concern control to manage how data is persisted across cache layers:

```typescript
import Keyv from 'keyv';
import KeyvNest from 'keyv-nest';

const memoryCache = new Keyv({ store: new Map() });
const diskCache = new Keyv({ store: new KeyvFileStore('/path/to/store') });

const nestedCache = KeyvNest(memoryCache, diskCache);

// Write concern = 0: Write to first layer only, propagate asynchronously
await nestedCache.set('key1', 'value1', { writeConcern: 0 });

// Write concern = 1: Write to first two layers, propagate rest asynchronously
await nestedCache.set('key2', 'value2', { writeConcern: 1 });

// Default: Write to all layers synchronously
await nestedCache.set('key3', 'value3');
```

### Using KeyvNest as a Keyv Store

```typescript
export const store = (g.store ??= KeyvNest(
  {
    get: (key) => console.log("kv.get " + key),
    set: (key, v) => console.log("kv.set " + key),
    delete: () => console.log("kv.delete"),
    clear: () => console.log("kv.clear"),
  },
  new QuickLRU({ maxSize: 1000 }),
  new KeyvDirStore("./.cache/" + collection),
  new KeyvMongo(MONGODB_URI, { collection })
));

export const kv = new Keyv<any>({ store, ttl: enhancedMs("4w") });
export const kv1m = new Keyv<unknown>({ store, ttl: enhancedMs("1m") });
export const kv1d = new Keyv<unknown>({ store, ttl: enhancedMs("1d") });
export const kv1w = new Keyv<unknown>({ store, ttl: enhancedMs("1w") });
export const kv1y = new Keyv<unknown>({ store, ttl: enhancedMs("1y") });

export const cache1m = KeyvCachedWith(kv1m);
export const cache1d = KeyvCachedWith(kv1d);
export const cache1w = KeyvCachedWith(kv1w);
export const cache1y = KeyvCachedWith(kv1y);
```


## API

### KeyvNest

#### `KeyvNest(cache: KeyvStore<T>, store: KeyvStore<T>, ...rest: KeyvStore<T>[]): KeyvStore<T>`

Creates a nested cache adapter that allows for multi-layered caching.

- **cache**: The primary cache store (usually memory cache).
- **store**: The secondary cache store (usually disk cache).
- **rest**: Additional cache stores (e.g., network cache).

Returns a `KeyvStore` instance with the following methods:

#### `get(key: string): Promise<T>`

Retrieves a value from the cache hierarchy. If the value is found in the primary cache, it is returned. Otherwise, it checks the secondary cache and so on. If a value is found in any cache layer, it is promoted to the primary cache.

- **key**: The cache key.
- **returns**: A promise that resolves to the cached value or `undefined`.

#### `set(key: string, value: T, options?: number | KeyvNestOptions): Promise<any>`

Sets a value in all layers of the cache hierarchy.

- **key**: The cache key.
- **value**: The value to cache.
- **options**: Optional TTL (number) or options object:
  - **ttl**: Time-to-live in milliseconds
  - **writeConcern**: Controls write propagation behavior:
    - `0`: Write to first layer only, propagate asynchronously to others
    - `1`: Write to first two layers synchronously, propagate rest asynchronously
    - `>=2`: Write to N+1 layers synchronously
    - `undefined` (default): Write to all layers synchronously
- **returns**: A promise that resolves when the operation has completed.

#### `delete(key: string): Promise<any>`

Deletes a value from all layers of the cache hierarchy.

- **key**: The cache key.
- **returns**: A promise that resolves when the operation has completed.

#### `clear(): Promise<any>`

Clears all values from all layers of the cache hierarchy.

- **returns**: A promise that resolves when the operation has completed.

#### `getMany(keys: string[]): Promise<Array<StoredData<T | undefined>>>`

Retrieves multiple values from the cache hierarchy. Missing values are fetched from deeper layers and promoted to the primary cache.

- **keys**: Array of cache keys.
- **returns**: A promise that resolves to an array of cached values.

## Examples

Here is an example of using `KeyvNest` with memory and disk caches:

```typescript
import Keyv from 'keyv';
import KeyvNest from 'keyv-nest';

const memoryCache = new Keyv({ store: new Map() });
const diskCache = new Keyv({ store: new KeyvFileStore('/path/to/store') });

const nestedCache = KeyvNest(memoryCache, diskCache);

(async () => {
  await nestedCache.set('username', 'john_doe');
  const username = await nestedCache.get('username');
  console.log(username); // 'john_doe'

  await nestedCache.delete('username');
  const deletedUsername = await nestedCache.get('username');
  console.log(deletedUsername); // undefined

  await nestedCache.clear();
})();
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any feature requests, bug reports, or improvements.

## See Also

Other Keyv storage adapters by the same author:

- [keyv-github](https://github.com/snomiao/keyv-github) — GitHub repository adapter; each key is a file, commits are writes
- [keyv-sqlite](https://github.com/snomiao/keyv-sqlite) — SQLite storage adapter
- [keyv-mongodb-store](https://github.com/snomiao/keyv-mongodb-store) — MongoDB storage adapter
- [keyv-nedb-store](https://github.com/snomiao/keyv-nedb-store) — NeDB embedded file-based adapter
- [keyv-dir-store](https://github.com/snomiao/keyv-dir-store) — file-per-key directory adapter with TTL via mtime
- [keyv-cache-proxy](https://github.com/snomiao/keyv-cache-proxy) — transparent caching proxy that wraps any object

## License

This module is open-source and licensed under the MIT License. For more details, see the [LICENSE](LICENSE) file.
