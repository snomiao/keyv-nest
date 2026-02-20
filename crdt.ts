/**
 * KeyvCRDT - CRDT wrapper for KeyvNest stores
 *
 * Provides conflict-free replication with customizable merge strategies.
 * Simple API: just use .get() and .set() like regular KeyvNest.
 *
 * Features:
 * - Tombstone-based deletion (delete vs edit conflicts resolved by timestamp)
 * - Per-field merge strategies
 * - Custom merge functions
 *
 * @example
 * ```ts
 * import KeyvNest from 'keyv-nest';
 * import { KeyvCRDT } from 'keyv-nest/crdt';
 *
 * const store = KeyvNest(new Map(), mongoStore);
 * const crdt = new KeyvCRDT(store, 'device-123', {
 *   name: 'lww',           // Last-Write-Wins
 *   highScore: 'max',      // Keep highest
 *   totalCoins: 'counter', // Sum per-device
 *   achievements: 'union', // Merge arrays
 * });
 *
 * // Simple API - just like KeyvNest
 * await crdt.set('user:123', { name: 'Alice', totalCoins: 100 });
 * const data = await crdt.get('user:123');
 *
 * // Delete with tombstone (can be overridden by later edits)
 * await crdt.delete('user:123');
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
export type CounterValue = Record<string, number>;

/** Internal CRDT field structure */
export type CRDTField<T> = {
  v: T;              // value
  t: number;         // timestamp
  d: string;         // deviceId
  c?: CounterValue;  // per-device counter (only for 'counter' strategy)
};

/** Reserved field name for tombstone */
const TOMBSTONE_KEY = '_deleted' as const;

/** CRDT document structure (includes tombstone field) */
export type CRDTDocument<T extends object> = {
  [K in keyof T]?: CRDTField<T[K]>;
} & {
  [TOMBSTONE_KEY]?: CRDTField<boolean>;
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
// KeyvCRDT Class
// ============================================================================

/**
 * CRDT wrapper for KeyvNest stores.
 *
 * Enables conflict-free synchronization between multiple devices/clients
 * with customizable merge strategies per field.
 */
export class KeyvCRDT<T extends object> {
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
   * Get data from store (merged, as plain object).
   * Returns undefined if key doesn't exist or is deleted (tombstoned).
   *
   * @param key - The key to fetch
   * @returns Plain object (without CRDT metadata), or undefined if not found/deleted
   */
  async get(key: string): Promise<Partial<T> | undefined> {
    const doc = await this.store.get(key);
    if (!doc) return undefined;

    const crdtDoc = doc as unknown as CRDTDocument<T>;

    // Check tombstone - if deleted, return undefined
    if (crdtDoc[TOMBSTONE_KEY]?.v === true) {
      return undefined;
    }

    return this.toPlainObject(crdtDoc);
  }

  /**
   * Set/update data in store (merges with existing data).
   * Also clears tombstone if item was previously deleted.
   *
   * @param key - The key to store under
   * @param updates - Partial object with fields to update
   */
  async set(key: string, updates: Partial<T>): Promise<void> {
    const timestamp = Date.now();

    // Create CRDT fields for updates
    const newFields: CRDTDocument<T> = {};

    // Clear tombstone (mark as not deleted)
    newFields[TOMBSTONE_KEY] = {
      v: false,
      t: timestamp,
      d: this.deviceId,
    };

    for (const field in updates) {
      const strategy = this.mergeConfig[field as keyof T];
      if (strategy === 'counter') {
        (newFields as Record<string, CRDTField<unknown>>)[field] = {
          v: updates[field as keyof T],
          t: timestamp,
          d: this.deviceId,
          c: { [this.deviceId]: updates[field as keyof T] as number },
        };
      } else {
        (newFields as Record<string, CRDTField<unknown>>)[field] = {
          v: updates[field as keyof T],
          t: timestamp,
          d: this.deviceId,
        };
      }
    }

    // Merge with existing
    const existing = await this.store.get(key);
    const merged = existing
      ? this.mergeDocuments(newFields, existing as unknown as CRDTDocument<T>)
      : newFields;

    await this.store.set(key, merged as unknown as CRDTDocument<T>);
  }

  /**
   * Delete data from store using tombstone.
   * Can be overridden by later edits (LWW between delete and edit).
   *
   * @param key - The key to delete
   */
  async delete(key: string): Promise<boolean> {
    const timestamp = Date.now();
    const existing = await this.store.get(key);

    if (!existing) {
      return false;
    }

    // Create tombstone
    const tombstone: CRDTDocument<T> = {
      ...(existing as unknown as CRDTDocument<T>),
      [TOMBSTONE_KEY]: {
        v: true,
        t: timestamp,
        d: this.deviceId,
      },
    };

    await this.store.set(key, tombstone as unknown as CRDTDocument<T>);
    return true;
  }

  /**
   * Hard delete - permanently removes from store (no tombstone).
   * Use with caution: other devices may recreate the data.
   *
   * @param key - The key to permanently delete
   */
  async hardDelete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  /**
   * Check if key exists and is not deleted.
   *
   * @param key - The key to check
   */
  async has(key: string): Promise<boolean> {
    const doc = await this.store.get(key);
    if (!doc) return false;

    const crdtDoc = doc as unknown as CRDTDocument<T>;
    return crdtDoc[TOMBSTONE_KEY]?.v !== true;
  }

  /**
   * Check if key is tombstoned (soft deleted).
   *
   * @param key - The key to check
   */
  async isDeleted(key: string): Promise<boolean> {
    const doc = await this.store.get(key);
    if (!doc) return false;

    const crdtDoc = doc as unknown as CRDTDocument<T>;
    return crdtDoc[TOMBSTONE_KEY]?.v === true;
  }

  /**
   * Get raw CRDT document (with metadata).
   * Useful for debugging or advanced use cases.
   *
   * @param key - The key to fetch
   */
  async getRaw(key: string): Promise<CRDTDocument<T> | undefined> {
    const doc = await this.store.get(key);
    return doc as unknown as CRDTDocument<T> | undefined;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /** Convert CRDT document to plain object (excludes tombstone) */
  private toPlainObject(doc: CRDTDocument<T>): Partial<T> {
    const result: Partial<T> = {};
    for (const key in doc) {
      if (key === TOMBSTONE_KEY) continue; // Skip tombstone field
      const field = (doc as Record<string, CRDTField<unknown>>)[key];
      if (field) {
        // For counter fields, sum all device values
        if (field.c) {
          (result as Record<string, unknown>)[key] = Object.values(field.c).reduce((a, b) => a + b, 0);
        } else {
          (result as Record<string, unknown>)[key] = field.v;
        }
      }
    }
    return result;
  }

  /** Merge a single field using the configured strategy */
  private mergeField<K extends keyof T | typeof TOMBSTONE_KEY>(
    key: K,
    local: CRDTField<unknown> | undefined,
    remote: CRDTField<unknown> | undefined
  ): CRDTField<unknown> | undefined {
    if (!local) return remote;
    if (!remote) return local;

    // Tombstone always uses LWW
    if (key === TOMBSTONE_KEY) {
      if (local.t > remote.t) return local;
      if (remote.t > local.t) return remote;
      return local.d > remote.d ? local : remote;
    }

    const strategy = this.mergeConfig[key as keyof T] || 'lww';
    const lm: FieldMeta = { timestamp: local.t, deviceId: local.d };
    const rm: FieldMeta = { timestamp: remote.t, deviceId: remote.d };

    if (strategy === 'lww') {
      if (local.t > remote.t) return local;
      if (remote.t > local.t) return remote;
      return local.d > remote.d ? local : remote;
    }

    if (strategy === 'max') {
      const val = Math.max(local.v as number, remote.v as number);
      return { v: val, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    if (strategy === 'min') {
      const val = Math.min(local.v as number, remote.v as number);
      return { v: val, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    if (strategy === 'counter') {
      const merged: CounterValue = remote.c ? { ...remote.c } : {};
      if (local.c) {
        for (const did in local.c) {
          merged[did] = Math.max(local.c[did], merged[did] ?? 0);
        }
      }
      const sum = Object.values(merged).reduce((a, b) => a + b, 0);
      return { v: sum, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d, c: merged };
    }

    if (strategy === 'union') {
      const merged = [...new Set([...(local.v as unknown[]), ...(remote.v as unknown[])])];
      return { v: merged, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    if (typeof strategy === 'function') {
      const val = strategy(local.v as T[keyof T], remote.v as T[keyof T], lm, rm);
      return { v: val, t: Math.max(local.t, remote.t), d: local.t >= remote.t ? local.d : remote.d };
    }

    return local.t >= remote.t ? local : remote;
  }

  /** Merge two CRDT documents */
  private mergeDocuments(local: CRDTDocument<T>, remote: CRDTDocument<T>): CRDTDocument<T> {
    const result: CRDTDocument<T> = {};
    const allKeys = new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]) as Set<keyof T | typeof TOMBSTONE_KEY>;

    for (const key of allKeys) {
      const merged = this.mergeField(
        key,
        local[key as keyof typeof local] as CRDTField<unknown> | undefined,
        remote[key as keyof typeof remote] as CRDTField<unknown> | undefined
      );
      if (merged) {
        (result as Record<string, unknown>)[key as string] = merged;
      }
    }
    return result;
  }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a KeyvCRDT instance.
 *
 * @example
 * ```ts
 * const crdt = createCRDT(store, 'device-id', { score: 'max', coins: 'counter' });
 * await crdt.set('user:1', { score: 100, coins: 50 });
 * const data = await crdt.get('user:1');
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
