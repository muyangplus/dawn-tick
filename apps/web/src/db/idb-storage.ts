import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { STORE_KEYS, STORE_NAMES, type Collection, type Storage, type StoreName } from '@dawn-tick/core';

const DB_NAME = 'dawn-tick';
const DB_VERSION = 1;

interface RowStore {
  key: string;
  value: Record<string, unknown>;
}

interface DawnTickDB extends DBSchema {
  users: RowStore;
  semesters: RowStore;
  time_slots: RowStore;
  courses: RowStore;
  course_schedules: RowStore;
  events: RowStore;
  reminders: RowStore;
  app_meta: { key: string; value: { key: string; value: string } };
}

/** 每次调用各自开启事务：IndexedDB 事务在无待处理请求时会自动关闭。 */
interface LooseDb {
  get(store: string, key: string): Promise<unknown>;
  getAll(store: string): Promise<unknown[]>;
  put(store: string, value: unknown): Promise<unknown>;
  delete(store: string, key: string): Promise<void>;
  clear(store: string): Promise<void>;
}

class IndexedDbCollection<T> implements Collection<T> {
  readonly name: StoreName;
  private readonly db: LooseDb;

  constructor(db: LooseDb, name: StoreName) {
    this.db = db;
    this.name = name;
  }

  async get(key: string): Promise<T | undefined> {
    return (await this.db.get(this.name, key)) as T | undefined;
  }

  async getAll(): Promise<T[]> {
    return (await this.db.getAll(this.name)) as T[];
  }

  async put(value: T): Promise<void> {
    await this.db.put(this.name, value);
  }

  async putMany(values: readonly T[]): Promise<void> {
    for (const value of values) await this.db.put(this.name, value);
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(this.name, key);
  }

  async clear(): Promise<void> {
    await this.db.clear(this.name);
  }
}

/** 浏览器端实现：每个集合一个 IndexedDB object store，主键与 SQLite 端一致。 */
export async function openIndexedDbStorage(name = DB_NAME): Promise<Storage> {
  const db = await openDB<DawnTickDB>(name, DB_VERSION, {
    upgrade(database) {
      for (const store of STORE_NAMES) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: STORE_KEYS[store] });
        }
      }
    },
  });
  const loose = db as unknown as LooseDb;

  const cache = new Map<StoreName, IndexedDbCollection<unknown>>();
  const collection = <T,>(storeName: StoreName): Collection<T> => {
    const existing = cache.get(storeName);
    if (existing !== undefined) return existing as IndexedDbCollection<T>;
    const created = new IndexedDbCollection<T>(loose, storeName);
    cache.set(storeName, created as IndexedDbCollection<unknown>);
    return created;
  };

  return {
    kind: 'indexeddb',
    collection,
    async readMeta(key: string): Promise<string | undefined> {
      const row = await collection<{ key: string; value: string }>('app_meta').get(key);
      return row?.value;
    },
    async writeMeta(key: string, value: string): Promise<void> {
      await collection<{ key: string; value: string }>('app_meta').put({ key, value });
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}
