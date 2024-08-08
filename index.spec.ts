// Certainly! To write unit tests for `KeyvNest`, we'll use a testing framework like Jest. Here's how you can set up `index.spec.ts` for the module:

// ```typescript
import KeyvNest, { type KeyvNestStore } from "./index"; // assuming index.ts is the file you shared

describe("KeyvNest", () => {
  let memoryCache: KeyvNestStore<any>;
  let diskCache: KeyvNestStore<any>;
  let networkCache: KeyvNestStore<any>;

  beforeEach(() => {
    memoryCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    };

    diskCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    };

    networkCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    };
  });

  test("should get value from memory cache", async () => {
    const key = "test";
    const value = "value";

    memoryCache.get = jest.fn().mockResolvedValue(value);

    const keyv = KeyvNest(memoryCache, diskCache);
    const result = await keyv.get(key);

    expect(result).toBe(value);
    expect(memoryCache.get).toHaveBeenCalledWith(key);
    expect(diskCache.get).not.toHaveBeenCalled();
  });

  test("should get value from disk cache if not in memory cache", async () => {
    const key = "test";
    const value = "value";

    memoryCache.get = jest.fn().mockResolvedValue(null);
    diskCache.get = jest.fn().mockResolvedValue(value);

    const keyv = KeyvNest(memoryCache, diskCache);
    const result = await keyv.get(key);

    expect(result).toBe(value);
    expect(memoryCache.get).toHaveBeenCalledWith(key);
    expect(diskCache.get).toHaveBeenCalledWith(key);
    expect(memoryCache.set).toHaveBeenCalledWith(key, value);
  });

  test("should set value in all caches", async () => {
    const key = "test";
    const value = "value";

    const keyv = KeyvNest(memoryCache, diskCache, networkCache);
    await keyv.set(key, value);

    expect(memoryCache.set).toHaveBeenCalledWith(key, value);
    expect(diskCache.set).toHaveBeenCalledWith(key, value);
    expect(networkCache.set).toHaveBeenCalledWith(key, value);
  });

  test("should delete value from all caches", async () => {
    const key = "test";

    const keyv = KeyvNest(memoryCache, diskCache, networkCache);
    await keyv.delete(key);

    expect(memoryCache.delete).toHaveBeenCalledWith(key);
    expect(diskCache.delete).toHaveBeenCalledWith(key);
    expect(networkCache.delete).toHaveBeenCalledWith(key);
  });

  test("should clear all caches", async () => {
    const keyv = KeyvNest(memoryCache, diskCache, networkCache);
    await keyv.clear();

    expect(memoryCache.clear).toHaveBeenCalled();
    expect(diskCache.clear).toHaveBeenCalled();
    expect(networkCache.clear).toHaveBeenCalled();
  });

  test("should fallback in correct cascade order", async () => {
    const key = "test";
    const value = "value";
    const fallbackValue = "fallbackValue";

    memoryCache.get = jest.fn().mockResolvedValue(null);
    diskCache.get = jest.fn().mockResolvedValue(null);
    networkCache.get = jest.fn().mockResolvedValue(fallbackValue);

    const keyv = KeyvNest(memoryCache, diskCache, networkCache);
    const result = await keyv.get(key);

    expect(result).toBe(fallbackValue);
    expect(memoryCache.get).toHaveBeenCalledWith(key);
    expect(diskCache.get).toHaveBeenCalledWith(key);
    expect(networkCache.get).toHaveBeenCalledWith(key);
    expect(memoryCache.set).toHaveBeenCalledWith(key, fallbackValue);
  });
});

