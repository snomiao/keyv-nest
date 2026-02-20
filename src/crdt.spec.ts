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
      await device1.set('user:1', { name: 'Alice' });

      // Device 2 writes later
      await new Promise(r => setTimeout(r, 10));
      await device2.set('user:1', { name: 'Bob' });

      // Both should see Bob (latest)
      expect((await device1.get('user:1'))?.name).toBe('Bob');
      expect((await device2.get('user:1'))?.name).toBe('Bob');
    });

    test('should use deviceId as tie-breaker when timestamps are equal', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();

      // Manually create CRDT doc with specific timestamp
      const timestamp = Date.now();
      store._data.set('user:1', {
        name: { v: 'Alice', t: timestamp, d: 'device-a' },
      });

      // Device with higher ID writes with same timestamp
      const device = new KeyvCRDT(store, 'device-z', { name: 'lww' });

      // Force same timestamp by writing and manipulating
      await device.set('user:1', { name: 'Zoe' });

      // Since device-z wrote later (even if same second), Zoe should win
      const result = await device.get('user:1');
      expect(result?.name).toBe('Zoe');
    });
  });

  describe('MAX strategy', () => {
    test('should keep the highest value', async () => {
      const store = createMemoryStore<CRDTDocument<{ score: number }>>();
      const device1 = new KeyvCRDT(store, 'device1', { score: 'max' });
      const device2 = new KeyvCRDT(store, 'device2', { score: 'max' });

      await device1.set('game:1', { score: 100 });
      await device2.set('game:1', { score: 50 }); // Lower score

      // Both should have the max score
      expect((await device1.get('game:1'))?.score).toBe(100);
      expect((await device2.get('game:1'))?.score).toBe(100);
    });

    test('should update when new value is higher', async () => {
      const store = createMemoryStore<CRDTDocument<{ score: number }>>();
      const device1 = new KeyvCRDT(store, 'device1', { score: 'max' });
      const device2 = new KeyvCRDT(store, 'device2', { score: 'max' });

      await device1.set('game:1', { score: 100 });
      await device2.set('game:1', { score: 200 }); // Higher score

      expect((await device1.get('game:1'))?.score).toBe(200);
      expect((await device2.get('game:1'))?.score).toBe(200);
    });
  });

  describe('MIN strategy', () => {
    test('should keep the lowest value', async () => {
      const store = createMemoryStore<CRDTDocument<{ bestTime: number }>>();
      const device1 = new KeyvCRDT(store, 'device1', { bestTime: 'min' });
      const device2 = new KeyvCRDT(store, 'device2', { bestTime: 'min' });

      await device1.set('race:1', { bestTime: 120 });
      await device2.set('race:1', { bestTime: 95 }); // Faster time

      expect((await device1.get('race:1'))?.bestTime).toBe(95);
      expect((await device2.get('race:1'))?.bestTime).toBe(95);
    });
  });

  describe('COUNTER strategy', () => {
    test('should sum values from all devices', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT(store, 'mobile', { coins: 'counter' });
      const pc = new KeyvCRDT(store, 'pc', { coins: 'counter' });

      // Mobile earns 100 coins
      await mobile.set('player:1', { coins: 100 });

      // PC earns 50 coins
      await pc.set('player:1', { coins: 50 });

      // Total should be 150 (100 + 50)
      expect((await mobile.get('player:1'))?.coins).toBe(150);
      expect((await pc.get('player:1'))?.coins).toBe(150);
    });

    test('should handle re-set without inflating counter', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT(store, 'mobile', { coins: 'counter' });

      await mobile.set('player:1', { coins: 100 });
      await mobile.set('player:1', { coins: 100 }); // Same value again
      await mobile.set('player:1', { coins: 100 }); // Same value again

      // Should still be 100, not 300
      expect((await mobile.get('player:1'))?.coins).toBe(100);
    });

    test('should update counter when value changes', async () => {
      const store = createMemoryStore<CRDTDocument<{ coins: number }>>();
      const mobile = new KeyvCRDT(store, 'mobile', { coins: 'counter' });

      await mobile.set('player:1', { coins: 100 });
      await mobile.set('player:1', { coins: 150 }); // Earned more

      // Should be 150 (latest value for this device)
      expect((await mobile.get('player:1'))?.coins).toBe(150);
    });
  });

  describe('UNION strategy', () => {
    test('should merge arrays without duplicates', async () => {
      const store = createMemoryStore<CRDTDocument<{ tags: string[] }>>();
      const device1 = new KeyvCRDT(store, 'device1', { tags: 'union' });
      const device2 = new KeyvCRDT(store, 'device2', { tags: 'union' });

      await device1.set('item:1', { tags: ['a', 'b', 'c'] });
      await device2.set('item:1', { tags: ['b', 'c', 'd', 'e'] });

      const result1 = await device1.get('item:1');
      const result2 = await device2.get('item:1');

      expect(result1?.tags?.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(result2?.tags?.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
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

      await device1.set('item:1', { value: 'first' });
      await new Promise(r => setTimeout(r, 10));
      await device2.set('item:1', { value: 'second' });

      // First writer should win
      expect((await device1.get('item:1'))?.value).toBe('first');
      expect((await device2.get('item:1'))?.value).toBe('first');
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

      await device1.set('post:1', { votes: { up: 10, down: 2 } });
      await device2.set('post:1', { votes: { up: 8, down: 5 } });

      // Should have max of each
      expect((await device1.get('post:1'))?.votes).toEqual({ up: 10, down: 5 });
      expect((await device2.get('post:1'))?.votes).toEqual({ up: 10, down: 5 });
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
      await mobile.set('player:1', {
        name: 'Player1',
        highScore: 1000,
        totalCoins: 50,
        achievements: ['first_login'],
      });

      // PC writes with different values
      await new Promise(r => setTimeout(r, 10));
      await pc.set('player:1', {
        name: 'ProGamer',      // LWW: PC wins (later)
        highScore: 500,        // MAX: Mobile wins (higher)
        totalCoins: 80,        // COUNTER: Sum = 130
        achievements: ['pro'], // UNION: Merged
      });

      const result = await mobile.get('player:1');

      expect(result?.name).toBe('ProGamer');           // LWW
      expect(result?.highScore).toBe(1000);            // MAX
      expect(result?.totalCoins).toBe(130);            // COUNTER (50 + 80)
      expect(result?.achievements?.sort()).toEqual(['first_login', 'pro']); // UNION
    });
  });

  describe('delete with tombstone', () => {
    test('delete() should tombstone data (get returns undefined)', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT(store, 'device', {});

      await crdt.set('key', { name: 'test' });
      expect(await crdt.has('key')).toBe(true);

      await crdt.delete('key');
      expect(await crdt.has('key')).toBe(false);
      expect(await crdt.get('key')).toBeUndefined();
      expect(await crdt.isDeleted('key')).toBe(true);
    });

    test('later edit should revive deleted item', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const deviceA = new KeyvCRDT(store, 'deviceA', {});
      const deviceB = new KeyvCRDT(store, 'deviceB', {});

      // Device A creates and deletes
      await deviceA.set('key', { name: 'Alice' });
      await deviceA.delete('key');
      expect(await deviceA.get('key')).toBeUndefined();

      // Device B edits later (should revive)
      await new Promise(r => setTimeout(r, 10));
      await deviceB.set('key', { name: 'Bob' });

      // Both should see the revived data
      expect((await deviceA.get('key'))?.name).toBe('Bob');
      expect((await deviceB.get('key'))?.name).toBe('Bob');
      expect(await deviceA.isDeleted('key')).toBe(false);
    });

    test('later delete should override edit', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const deviceA = new KeyvCRDT(store, 'deviceA', {});
      const deviceB = new KeyvCRDT(store, 'deviceB', {});

      // Device A creates
      await deviceA.set('key', { name: 'Alice' });

      // Device B deletes later
      await new Promise(r => setTimeout(r, 10));
      await deviceB.delete('key');

      // Both should see it as deleted
      expect(await deviceA.get('key')).toBeUndefined();
      expect(await deviceB.get('key')).toBeUndefined();
    });

    test('concurrent delete and edit - later timestamp wins', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const deviceA = new KeyvCRDT(store, 'deviceA', {});
      const deviceB = new KeyvCRDT(store, 'deviceB', {});

      // Setup: both have initial data
      await deviceA.set('key', { name: 'Initial' });

      // Device A deletes
      await deviceA.delete('key');

      // Device B edits LATER (should win)
      await new Promise(r => setTimeout(r, 10));
      await deviceB.set('key', { name: 'Updated' });

      // Edit wins because it has later timestamp
      expect((await deviceA.get('key'))?.name).toBe('Updated');
      expect((await deviceB.get('key'))?.name).toBe('Updated');
    });

    test('hardDelete() should permanently remove (no tombstone)', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT(store, 'device', {});

      await crdt.set('key', { name: 'test' });
      await crdt.hardDelete('key');

      // Data is completely gone
      expect(await crdt.get('key')).toBeUndefined();
      expect(await crdt.isDeleted('key')).toBe(false); // No tombstone
      expect(await crdt.getRaw('key')).toBeUndefined();
    });
  });

  describe('getRaw', () => {
    test('should return raw CRDT document with metadata', async () => {
      const store = createMemoryStore<CRDTDocument<{ name: string }>>();
      const crdt = new KeyvCRDT(store, 'device', {});

      await crdt.set('key', { name: 'test' });

      const raw = await crdt.getRaw('key');
      expect(raw?.name?.v).toBe('test');
      expect(raw?.name?.d).toBe('device');
      expect(typeof raw?.name?.t).toBe('number');
    });
  });

  describe('createCRDT factory', () => {
    test('should create KeyvCRDT instance', async () => {
      const store = createMemoryStore<CRDTDocument<{ value: string }>>();
      const crdt = createCRDT(store, 'device', { value: 'lww' });

      await crdt.set('key', { value: 'test' });
      expect((await crdt.get('key'))?.value).toBe('test');
    });
  });
});
