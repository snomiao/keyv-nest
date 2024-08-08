# KeyvNest

`KeyvNest` is a hierarchical caching adapter for the [Keyv](https://github.com/lukechilds/keyv) module. It allows you to nest multiple caching layers, such as memory cache, disk cache, and network cache, to create a multi-layered caching mechanism.

## Table of Contents

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

#### `set(key: string, value: T, ...rest: any[]): Promise<any>`

Sets a value in all layers of the cache hierarchy.

- **key**: The cache key.
- **value**: The value to cache.
- **...rest**: Additional arguments for cache store set operations.
- **returns**: A promise that resolves when the operation has completed.

#### `delete(key: string): Promise<any>`

Deletes a value from all layers of the cache hierarchy.

- **key**: The cache key.
- **returns**: A promise that resolves when the operation has completed.

#### `clear(): Promise<any>`

Clears all values from all layers of the cache hierarchy.

- **returns**: A promise that resolves when the operation has completed.

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

## License

This module is open-source and licensed under the MIT License. For more details, see the [LICENSE](LICENSE) file.
