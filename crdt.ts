/**
 * KeyvCRDT - CRDT wrapper for KeyvNest stores
 *
 * Provides conflict-free replication with customizable merge strategies.
 * Works with any KeyvNestStore without modifying the original implementation.
 *
 * @example
 * ```ts
 * import KeyvNest from 'keyv-nest';
 * import { KeyvCRDT } from 'keyv-nest/crdt';
 *
 * const store = KeyvNest(new Map(), mongoStore);
 *
 * const crdt = new KeyvCRDT(store, 'device-123', {
 *   name: 'lww',           // Last-Write-Wins
 *   highScore: 'max',      // Keep highest
 *   totalCoins: 'counter', // Sum per-device
 *   achievements: 'union', // Merge arrays
 * });
 *
 * crdt.update({ name: 'Alice', totalCoins: 100 });
 * await crdt.sync('user:123');
 * ```
 */

import type { KeyvNestStore } from './index';

// ============================================================================
// Types
// ============================================================================

/** Metadata for each field */
export type FieldMeta = {
  timestamp: number;
  deviceId: string;
};

/** Per-device counter values for 'counter' strategy */
export type CounterValue = { [deviceId: string]: number };

/** Internal CRDT field structure */
export type CRDTField<T> = {
  /** The value */
  v: T;
  /** Timestamp of last update */
  t: number;
  /** Device ID that made the update */
  d: string;
  /** Per-device counter (only for 'counter' strategy) */
  c?: CounterValue;
};

/** CRDT document structure */
export type CRDTDocument<T extends object> = {
  [K in keyof T]?: CRDTField<T[K]>;
};

/** Built-in merge strategy names */
export type BuiltinStrategy = 'lww' | 'max' | 'min' | 'counter' | 'union';

/** Custom merge function signature */
export type CustomMergeFn<T> = (
  local: T,
  remote: T,
  localMeta: FieldMeta,
  remoteMeta: FieldMeta
) => T;

/** Merge strategy: built-in name or custom function */
export type MergeStrategy<T> = BuiltinStrategy | CustomMergeFn<T>;

/** Configuration: merge strategy per field */
export type MergeConfig<T extends object> = {
  [K in keyof T]?: MergeStrategy<T[K]>;
};

// ============================================================================
// Built-in Merge Functions
// ============================================================================

const mergeStrategies = {
  /** Last-Write-Wins: latest timestamp wins */
  lww: <T>(local: T, remote: T, lm: FieldMeta, rm: FieldMeta): T => {
    if (lm.timestamp > rm.timestamp) return local;
    if (rm.timestamp > lm.timestamp) return remote;
    // Tie-breaker: compare device IDs deterministically
    return lm.deviceId > rm.deviceId ? local : remote;
  },

  /** Max: highest numeric value wins */
  max: <T extends number>(local: T, remote: T): T => {
    return Math.max(local, remote) as T;
  },

  /** Min: lowest numeric value wins */
  min: <T extends number>(local: T, remote: T): T => {
    return Math.min(local, remote) as T;
  },

  /** Union: merge arrays with deduplication */
  union: <T extends unknown[]>(local: T, remote: T): T => {
    return [...new Set([...local, ...remote])] as T;
  },
};

// ============================================================================
// KeyvCRDT Class
// ============================================================================

/**
 * CRDT wrapper for KeyvNest stores.
 *
 * Enables conflict-free synchronization between multiple devices/clients
 * with customizable merge strategies per field.
 */
export class KeyvCRDT<T extends object> {
  private localState: CRDTDocument<T> = {};

  /**
   * Create a new KeyvCRDT instance.
   *
   * @param store - Any KeyvNestStore (can be wrapped with KeyvNest)
   * @param deviceId - Unique identifier for this device/client
   * @param mergeConfig - Merge strategy configuration per field
   */
  constructor(
    private store: KeyvNestStore<CRDTDocument<T>>,
    private deviceId: string,
    private mergeConfig: MergeConfig<T> = {}
  ) {}

  /**
   * Get the current data as a plain object (without CRDT metadata).
   */
  getData(): Partial<T> {
    const result: Partial<T> = {};
    for (const key in this.localState) {
      const field = this.localState[key];
      if (field) {
        // For counter fields, sum all device values
        if (field.c) {
          result[key] = Object.values(field.c).reduce((a, b) => a + b, 0) as T[typeof key];
        } else {
          result[key] = field.v;
        }
      }
    }
    return result;
  }

  /**
   * Get the raw CRDT document (with metadata).
   * Useful for debugging or custom processing.
   */
  getRawData(): CRDTDocument<T> {
    return { ...this.localState };
  }

  /**
   * Update local state with new values.
   * Changes are not persisted until sync() or push() is called.
   *
   * @param updates - Partial object with fields to update
   */
  update(updates: Partial<T>): void {
    const timestamp = Date.now();

    for (const key in updates) {
      const strategy = this.mergeConfig[key];
      const existing = this.localState[key];

      if (strategy === 'counter') {
        // Counter: track per-device values
        const newValue = updates[key] as number;
        const existingCounter = existing?.c || {};
        this.localState[key] = {
          v: newValue,
          t: timestamp,
          d: this.deviceId,
          c: { ...existingCounter, [this.deviceId]: newValue },
        } as CRDTField<T[typeof key]>;
      } else {
        // Other strategies: just store value with metadata
        this.localState[key] = {
          v: updates[key]!,
          t: timestamp,
          d: this.deviceId,
        } as CRDTField<T[typeof key]>;
      }
    }
  }

  /**
   * Merge a single field using the configured strategy.
   */
  private mergeField<K extends keyof T>(
    key: K,
    local: CRDTField<T[K]> | undefined,
    remote: CRDTField<T[K]> | undefined
  ): CRDTField<T[K]> | undefined {
    if (!local) return remote;
    if (!remote) return local;

    const strategy = this.mergeConfig[key] || 'lww';
    const lm: FieldMeta = { timestamp: local.t, deviceId: local.d };
    const rm: FieldMeta = { timestamp: remote.t, deviceId: remote.d };

    // Built-in strategies
    if (strategy === 'lww') {
      const winner = mergeStrategies.lww(local.v, remote.v, lm, rm);
      return winner === local.v ? local : remote;
    }

    if (strategy === 'max') {
      const maxVal = mergeStrategies.max(local.v as number, remote.v as number);
      return {
        v: maxVal as T[K],
        t: Math.max(local.t, remote.t),
        d: local.t >= remote.t ? local.d : remote.d,
      };
    }

    if (strategy === 'min') {
      const minVal = mergeStrategies.min(local.v as number, remote.v as number);
      return {
        v: minVal as T[K],
        t: Math.max(local.t, remote.t),
        d: local.t >= remote.t ? local.d : remote.d,
      };
    }

    if (strategy === 'counter') {
      // Merge per-device counters, taking max for each device
      const mergedCounter: CounterValue = { ...remote.c };
      for (const deviceId in local.c) {
        if (mergedCounter[deviceId] !== undefined) {
          mergedCounter[deviceId] = Math.max(local.c[deviceId], mergedCounter[deviceId]);
        } else {
          mergedCounter[deviceId] = local.c[deviceId];
        }
      }
      const sum = Object.values(mergedCounter).reduce((a, b) => a + b, 0);
      return {
        v: sum as T[K],
        t: Math.max(local.t, remote.t),
        d: local.t >= remote.t ? local.d : remote.d,
        c: mergedCounter,
      };
    }

    if (strategy === 'union') {
      const merged = mergeStrategies.union(local.v as unknown[], remote.v as unknown[]);
      return {
        v: merged as T[K],
        t: Math.max(local.t, remote.t),
        d: local.t >= remote.t ? local.d : remote.d,
      };
    }

    // Custom merge function
    if (typeof strategy === 'function') {
      const mergedVal = strategy(local.v, remote.v, lm, rm);
      return {
        v: mergedVal,
        t: Math.max(local.t, remote.t),
        d: local.t >= remote.t ? local.d : remote.d,
      };
    }

    // Fallback to LWW
    return local.t >= remote.t ? local : remote;
  }

  /**
   * Merge two CRDT documents.
   */
  private mergeDocuments(
    local: CRDTDocument<T>,
    remote: CRDTDocument<T>
  ): CRDTDocument<T> {
    const result: CRDTDocument<T> = {};
    const allKeys = new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]) as Set<keyof T>;

    for (const key of allKeys) {
      result[key] = this.mergeField(key, local[key], remote[key]);
    }
    return result;
  }

  /**
   * Push local state to the store, merging with existing remote state.
   *
   * @param key - The key to store data under
   */
  async push(key: string): Promise<void> {
    const remote = await this.store.get(key);
    const merged = remote
      ? this.mergeDocuments(this.localState, remote as unknown as CRDTDocument<T>)
      : this.localState;
    await this.store.set(key, merged as unknown as CRDTDocument<T>);
    this.localState = merged;
  }

  /**
   * Pull remote state and merge into local state.
   *
   * @param key - The key to fetch data from
   */
  async pull(key: string): Promise<void> {
    const remote = await this.store.get(key);
    if (remote) {
      this.localState = this.mergeDocuments(
        this.localState,
        remote as unknown as CRDTDocument<T>
      );
    }
  }

  /**
   * Sync: pull remote changes, merge, then push.
   * This is the recommended way to synchronize.
   *
   * @param key - The key to sync
   */
  async sync(key: string): Promise<void> {
    await this.pull(key);
    await this.push(key);
  }

  /**
   * Clear local state. Does not affect the store.
   */
  clear(): void {
    this.localState = {};
  }

  /**
   * Load state from store without merging (replaces local state).
   *
   * @param key - The key to load from
   */
  async load(key: string): Promise<void> {
    const remote = await this.store.get(key);
    if (remote) {
      this.localState = remote as unknown as CRDTDocument<T>;
    }
  }
}

// ============================================================================
// Factory function (alternative API)
// ============================================================================

/**
 * Create a KeyvCRDT instance with a fluent API.
 *
 * @example
 * ```ts
 * const crdt = createCRDT(store, 'device-id', {
 *   score: 'max',
 *   coins: 'counter',
 * });
 * ```
 */
export function createCRDT<T extends object>(
  store: KeyvNestStore<CRDTDocument<T>>,
  deviceId: string,
  mergeConfig: MergeConfig<T> = {}
): KeyvCRDT<T> {
  return new KeyvCRDT(store, deviceId, mergeConfig);
}

export default KeyvCRDT;
