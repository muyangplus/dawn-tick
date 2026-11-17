export const STORE_NAMES = [
  'users',
  'semesters',
  'time_slots',
  'courses',
  'course_schedules',
  'events',
  'reminders',
  'app_meta',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

/** 各集合的主键字段名。 */
export const STORE_KEYS: Record<StoreName, string> = {
  users: 'id',
  semesters: 'id',
  time_slots: 'id',
  courses: 'id',
  course_schedules: 'id',
  events: 'id',
  reminders: 'id',
  app_meta: 'key',
};

export type StorageKind = 'memory' | 'sqlite' | 'indexeddb';

/** `app_meta` 的一行：键值都是字符串，所有结构化数据由调用方自行序列化。 */
export interface MetaRow {
  key: string;
  value: string;
}

export interface Collection<T> {
  readonly name: StoreName;
  get(key: string): Promise<T | undefined>;
  getAll(): Promise<T[]>;
  put(value: T): Promise<void>;
  putMany(values: readonly T[]): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** 三端统一的文档集合存储。平台各自实现，业务逻辑只依赖本接口。 */
export interface Storage {
  readonly kind: StorageKind;
  collection<T>(name: StoreName): Collection<T>;
  readMeta(key: string): Promise<string | undefined>;
  writeMeta(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

export interface MetaAccessors {
  readMeta(key: string): Promise<string | undefined>;
  writeMeta(key: string, value: string): Promise<void>;
}

/**
 * `app_meta` 的 kv 访问只此一份：三端各自把 `app_meta` 集合传进来，不再各写一遍 get/put 样板。
 * 只抽读写，不承载键名语义与 JSON 编解码。
 */
export function createMetaAccessors(collection: Collection<MetaRow>): MetaAccessors {
  return {
    async readMeta(key: string): Promise<string | undefined> {
      const row = await collection.get(key);
      return row?.value;
    },
    async writeMeta(key: string, value: string): Promise<void> {
      await collection.put({ key, value });
    },
  };
}

function keyOf(name: StoreName, value: Record<string, unknown>): string {
  const key = value[STORE_KEYS[name]];
  if (typeof key !== 'string') {
    throw new TypeError(`${name} 主键 ${STORE_KEYS[name]} 必须是字符串`);
  }
  return key;
}

export class MemoryCollection<T> implements Collection<T> {
  readonly name: StoreName;
  private readonly rows = new Map<string, T>();

  constructor(name: StoreName) {
    this.name = name;
  }

  async get(key: string): Promise<T | undefined> {
    return this.rows.get(key);
  }

  async getAll(): Promise<T[]> {
    return [...this.rows.values()];
  }

  async put(value: T): Promise<void> {
    this.rows.set(keyOf(this.name, value as Record<string, unknown>), value);
  }

  async putMany(values: readonly T[]): Promise<void> {
    for (const value of values) await this.put(value);
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}

export class MemoryStorage implements Storage {
  readonly kind: StorageKind = 'memory';
  private readonly collections = new Map<StoreName, MemoryCollection<unknown>>();

  collection<T>(name: StoreName): Collection<T> {
    const existing = this.collections.get(name);
    if (existing !== undefined) return existing as MemoryCollection<T>;
    const created = new MemoryCollection<T>(name);
    this.collections.set(name, created as MemoryCollection<unknown>);
    return created;
  }

  async readMeta(key: string): Promise<string | undefined> {
    return createMetaAccessors(this.collection<MetaRow>('app_meta')).readMeta(key);
  }

  async writeMeta(key: string, value: string): Promise<void> {
    await createMetaAccessors(this.collection<MetaRow>('app_meta')).writeMeta(key, value);
  }

  async close(): Promise<void> {
    this.collections.clear();
  }
}

export { keyOf };
