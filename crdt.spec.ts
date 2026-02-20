import { KeyvCRDT, createCRDT, type MergeConfig, type CRDTDocument } from './crdt';
import type { KeyvNestStore } from './index';

// Helper to create a simple in-memory store
function createMemoryStore<T>(): KeyvNestStore<T> & { _data: Map<string, T> } {
  const data = new Map<string, T>();
  return {
    _data: data,
    get: async (key: string) => data.get(key) as T,
    set: async (key: string, value: T) => {
      data.set(key, value);
    },
    delete: async (key: string) => data.delete(key),
    clear: async () => data.clear(),
  };
}

describe('KeyvCRDT', () => {
  describe('LWW (Last-Write-Wins) strategy', () => {
    test('should keep the value with latest timestamp', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const device1 = new KeyvCRDT(store, 'device1', { name: 'lww' });
      const device2 = new KeyvCRDT(store, 'device2', { name: 'lww' });

      // Device 1 writes first
      device1.update({ name: 'Alice' });
      await device1.push('user:1');

      // Device 2 syncs, then writes
      await device2.pull('user:1');
      await new Promise(r => setTimeout(r, 10));
      device2.update({ name: 'Bob' });
      await device2.sync('user:1');

      // Device 1 syncs
      await device1.sync('user:1');

      expect(device1.getData().name).toBe('Bob');
      expect(device2.getData().name).toBe('Bob');
    });

    test('should use deviceId as tie-breaker when timestamps are equal', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();

      // Manually create CRDT docs with same timestamp
      const timestamp = Date.now();
      store._data.set('user:1', {
        name: { v: 'Alice', t: timestamp, d: 'device-a' },
      });

      const device = new KeyvCRDT(store, 'device-z', { name: 'lww' });
      device.update({ name: 'Zoe' });

      // Force same timestamp by accessing internal state
      const raw = device.getRawData();
      raw.name!.t = timestamp;

      await device.push('user:1');

      // 'device-z' > 'device-a', so 'Zoe' should win
      expect(device.getData().name).toBe('Zoe');
    });
  });

  describe('MAX strategy', () => {
    test('should keep the highest value', async () => {
      const store = createMemoryStore<CRDTDocument<{ score: number }>>();
      const device1 = new KeyvCRDT(store, 'device1', { score: 'max' });
      const device2 = new KeyvCRDT(store, 'device2', { score: 'max' });

      device1.update({ score: 100 });
      await device1.push('game:1');

      await device2.pull('game:1');
      device2.update({ score: 50 }); // Lower score
      await device2.sync('game:1');

      await device1.sync('game:1');

      // Both should have the max score
      expect(device1.getData().score).toBe(100);
      expect(device2.getData().score).toBe(100);
    });

    test('should update when new value is higher', async () => {
      const store = createMemoryStore<CRDTDocument<{ score: number }>>();
      const device1 = new KeyvCRDT(store, 'device1', { score: 'max' });
      const device2 = new KeyvCRDT(store, 'device2', { score: 'max' });

      device1.update({ score: 100 });
      await device1.push('game:1');

      await device2.pull('game:1');
      device2.update({ score: 200 }); // Higher score
      await device2.sync('game:1');

      await device1.sync('game:1');

      expect(device1.getData().score).toBe(200);
      expect(device2.getData().score).toBe(200);
    });
  });

  describe('MIN strategy', () => {
    test('should keep the lowest value', async () => {
      const store = createMemoryStore<CRDTDocument<{ bestTime: number }>>();
      const device1 = new KeyvCRDT(store, 'device1', { bestTime: 'min' });
      const device2 = new KeyvCRDT(store, 'device2', { bestTime: 'min' });

      device1.update({ bestTime: 120 });
      await device1.push('race:1');

      await device2.pull('race:1');
      device2.update({ bestTime: 95 }); // Faster time
      await device2.sync('race:1');

      await device1.sync('race:1');

      expect(device1.getData().bestTime).toBe(95);
      expect(device2.getData().bestTime).toBe(95);
    });
  });

  describe('COUNTER strategy', () => {
    test('should sum values from all devices', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT(store, 'mobile', { coins: 'counter' });
      const pc = new KeyvCRDT(store, 'pc', { coins: 'counter' });

      // Mobile earns 100 coins
      mobile.update({ coins: 100 });
      await mobile.push('player:1');

      // PC syncs and earns 50 coins
      await pc.pull('player:1');
      pc.update({ coins: 50 });
      await pc.sync('player:1');

      // Mobile syncs
      await mobile.sync('player:1');

      // Total should be 150 (100 + 50)
      expect(mobile.getData().coins).toBe(150);
      expect(pc.getData().coins).toBe(150);
    });

    test('should handle concurrent updates without double-counting', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT(store, 'mobile', { coins: 'counter' });
      const pc = new KeyvCRDT(store, 'pc', { coins: 'counter' });

      // Both start with 50 coins
      mobile.update({ coins: 50 });
      await mobile.push('player:1');
      await pc.pull('player:1');

      // Both earn coins concurrently (offline)
      mobile.update({ coins: 100 }); // Mobile now has 100
      pc.update({ coins: 80 }); // PC now has 80

      // Both sync
      await mobile.push('player:1');
      await pc.sync('player:1');
      await mobile.sync('player:1');

      // Total: 100 (mobile) + 80 (pc) = 180
      expect(mobile.getData().coins).toBe(180);
      expect(pc.getData().coins).toBe(180);
    });

    test('should handle re-sync without inflating counter', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT(store, 'mobile', { coins: 'counter' });

      mobile.update({ coins: 100 });
      await mobile.push('player:1');

      // Sync multiple times - counter should not increase
      await mobile.sync('player:1');
      await mobile.sync('player:1');
      await mobile.sync('player:1');

      expect(mobile.getData().coins).toBe(100);
    });
  });

  describe('UNION strategy', () => {
    test('should merge arrays without duplicates', async () => {
      const store = createMemoryStore<CRDTDocument<{ tags: string[] }>>();
      const device1 = new KeyvCRDT(store, 'device1', { tags: 'union' });
      const device2 = new KeyvCRDT(store, 'device2', { tags: 'union' });

      device1.update({ tags: ['a', 'b', 'c'] });
      await device1.push('item:1');

      await device2.pull('item:1');
      device2.update({ tags: ['b', 'c', 'd', 'e'] });
      await device2.sync('item:1');

      await device1.sync('item:1');

      const tags1 = device1.getData().tags!;
      const tags2 = device2.getData().tags!;

      expect(tags1.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(tags2.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  describe('Custom merge function', () => {
    test('should use custom merge function (first-writer-wins)', async () => {
      type Data = { value: string };
      const store = createMemoryStore<CRDTDocument<Data>>();

      // Custom merge: first writer wins (keep earliest timestamp)
      const firstWriterWins = (
        local: string,
        remote: string,
        lm: { timestamp: number },
        rm: { timestamp: number }
      ) => (lm.timestamp <= rm.timestamp ? local : remote);

      const device1 = new KeyvCRDT(store, 'device1', { value: firstWriterWins });
      const device2 = new KeyvCRDT(store, 'device2', { value: firstWriterWins });

      device1.update({ value: 'first' });
      await device1.push('item:1');

      await new Promise(r => setTimeout(r, 10));
      await device2.pull('item:1');
      device2.update({ value: 'second' });
      await device2.sync('item:1');

      await device1.sync('item:1');

      // First writer should win
      expect(device1.getData().value).toBe('first');
      expect(device2.getData().value).toBe('first');
    });

    test('should use custom merge for computed values', async () => {
      type Data = { votes: { up: number; down: number } };
      const store = createMemoryStore<CRDTDocument<Data>>();

      // Custom merge: combine votes (max of each)
      const mergeVotes = (
        local: { up: number; down: number },
        remote: { up: number; down: number }
      ) => ({
        up: Math.max(local.up, remote.up),
        down: Math.max(local.down, remote.down),
      });

      const device1 = new KeyvCRDT(store, 'device1', { votes: mergeVotes });
      const device2 = new KeyvCRDT(store, 'device2', { votes: mergeVotes });

      device1.update({ votes: { up: 10, down: 2 } });
      await device1.push('post:1');

      await device2.pull('post:1');
      device2.update({ votes: { up: 8, down: 5 } });
      await device2.sync('post:1');

      await device1.sync('post:1');

      // Should have max of each
      expect(device1.getData().votes).toEqual({ up: 10, down: 5 });
      expect(device2.getData().votes).toEqual({ up: 10, down: 5 });
    });
  });

  describe('Mixed strategies', () => {
    test('should handle different strategies for different fields', async () => {
      interface GameProfile {
        name: string;
        highScore: number;
        totalCoins: number;
        achievements: string[];
      }

      const store = createMemoryStore<CRDTDocument<GameProfile>>();

      const mergeConfig: MergeConfig<GameProfile> = {
        name: 'lww',
        highScore: 'max',
        totalCoins: 'counter',
        achievements: 'union',
      };

      const mobile = new KeyvCRDT(store, 'mobile', mergeConfig);
      const pc = new KeyvCRDT(store, 'pc', mergeConfig);

      // Mobile initializes
      mobile.update({
        name: 'Player1',
        highScore: 1000,
        totalCoins: 50,
        achievements: ['first_login'],
      });
      await mobile.push('player:1');

      // PC syncs
      await pc.pull('player:1');

      // Both play concurrently
      await new Promise(r => setTimeout(r, 10));
      mobile.update({
        highScore: 2000,
        totalCoins: 100,
        achievements: ['first_login', 'level_10'],
      });

      await new Promise(r => setTimeout(r, 10));
      pc.update({
        name: 'ProGamer',
        highScore: 1500,
        totalCoins: 80,
        achievements: ['first_login', 'first_purchase'],
      });

      // Both sync
      await pc.sync('player:1');
      await mobile.sync('player:1');

      const finalMobile = mobile.getData();
      const finalPc = pc.getData();

      // LWW: PC wrote last
      expect(finalMobile.name).toBe('ProGamer');
      expect(finalPc.name).toBe('ProGamer');

      // MAX: Mobile had higher
      expect(finalMobile.highScore).toBe(2000);
      expect(finalPc.highScore).toBe(2000);

      // COUNTER: Sum of both
      expect(finalMobile.totalCoins).toBe(180);
      expect(finalPc.totalCoins).toBe(180);

      // UNION: Merged achievements
      expect(finalMobile.achievements!.sort()).toEqual([
        'first_login',
        'first_purchase',
        'level_10',
      ]);
    });
  });

  describe('createCRDT factory', () => {
    test('should create KeyvCRDT instance', async () => {
      const store = createMemoryStore<CRDTDocument<{ value: string }>>();
      const crdt = createCRDT(store, 'device', { value: 'lww' });

      crdt.update({ value: 'test' });
      await crdt.push('key');

      expect(crdt.getData().value).toBe('test');
    });
  });

  describe('load and clear', () => {
    test('load() should replace local state', async () => {
      const store = createMemoryStore<CRDTDocument<{ value: string }>>();

      // Pre-populate store
      store._data.set('key', {
        value: { v: 'stored', t: Date.now(), d: 'other' },
      });

      const crdt = new KeyvCRDT(store, 'device', {});
      crdt.update({ value: 'local' });

      // Load should replace local state
      await crdt.load('key');

      expect(crdt.getData().value).toBe('stored');
    });

    test('clear() should reset local state', () => {
      const store = createMemoryStore<CRDTDocument<{ value: string }>>();
      const crdt = new KeyvCRDT(store, 'device', {});

      crdt.update({ value: 'test' });
      expect(crdt.getData().value).toBe('test');

      crdt.clear();
      expect(crdt.getData().value).toBeUndefined();
    });
  });
});
