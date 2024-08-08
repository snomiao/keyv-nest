import KeyvSqlite from "@keyv/sqlite";
import { mkdir } from "fs/promises";
import Keyv from "keyv";
import KeyvNest from "./index";
await mkdir(".cache").catch(() => null);
const memoryCache = new Keyv({ store: new Map() });
const diskCache = new Keyv({
  store: new KeyvSqlite("sqlite://./.cache/cache.sqlite"),
});
const networkCache = new Keyv({
  store: new KeyvSqlite("sqlite://./.cache/mock-cache-network.sqlite"),
});
const nestedCache = KeyvNest(memoryCache, diskCache, networkCache);

// Test 1: Basic CRUD operations
it("works with basic CRUD", async () => {
  await nestedCache.set("username", "john_doe");
  const username = await nestedCache.get("username");
  console.log(username); // 'john_doe'

  await nestedCache.delete("username");
  const deletedUsername = await nestedCache.get("username");
  console.log(deletedUsername); // undefined

  await nestedCache.clear();
});

// Test 2: Retrieving a non-existent key
it("returns undefined for non-existent key", async () => {
  const nonExistent = await nestedCache.get("non-existent-key");
  console.log(nonExistent); // undefined
});

// Test 3: Working with different value types
it("handles different data types", async () => {
  await nestedCache.set("number", 42);
  const numberValue = await nestedCache.get("number");
  console.log(numberValue); // 42

  await nestedCache.set("boolean", true);
  const booleanValue = await nestedCache.get("boolean");
  console.log(booleanValue); // true

  await nestedCache.set("object", { a: 1, b: 2 });
  const objectValue = await nestedCache.get("object");
  console.log(objectValue); // { a: 1, b: 2 }
});

// Test 4: Handling cache item expiry
it("handles expiry right", async () => {
  await nestedCache.set("temp", "I will expire soon", 100); // expires in 100ms
  const tempValue = await nestedCache.get("temp");
  console.log(tempValue); // 'I will expire soon'

  // Wait for 150ms
  await new Promise((resolve) => setTimeout(resolve, 150));

  const expiredValue = await nestedCache.get("temp");
  console.log(expiredValue); // undefined
});

// Test 5: Error handling
it("handles errors correctly", async () => {
  // Simulate an error in the underlying store
  const failingNetworkCache = {
    ...networkCache,
    get: async (_key: string) => {
      throw new Error("Network error");
      return "anything";
    },
  } as typeof networkCache;

  const resilientNestedCache = KeyvNest(
    memoryCache,
    diskCache,
    failingNetworkCache
  );

  try {
    await resilientNestedCache.get("username");
  } catch (error: any) {
    console.log(error.message); // 'Network error'
  }
});
