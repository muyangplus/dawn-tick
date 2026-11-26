import test from 'node:test';
import assert from 'node:assert/strict';
import { openCapacitorDb, type CapacitorConnections, type CapacitorDb } from '../src/db/capacitor-driver.ts';
import { logEntries } from '../src/log.ts';

const DB = 'dawntick';
const VERSION = 3;

interface FakeOptions {
  consistent?: boolean;
  exists?: boolean;
  /** retrieveConnection 拿到的连接是否已打开 */
  retrievedOpen?: boolean;
  /** 依次决定每次 createConnection 是否抛错（缺省不抛） */
  createErrors?: (Error | null)[];
  /** 依次决定每次新建连接的 open 是否抛错（缺省不抛） */
  openErrors?: (Error | null)[];
  closeError?: Error;
}

/** 假连接管理：按调用顺序记下每一步，连接对象也各自记下 open 次数。 */
function fakeConnections(options: FakeOptions = {}) {
  const calls: string[] = [];
  const dbs: { label: string; opens: number; db: CapacitorDb }[] = [];
  const createErrors = [...(options.createErrors ?? [])];
  const openErrors = [...(options.openErrors ?? [])];

  const makeDb = (label: string, initiallyOpen: boolean, openError: Error | null): CapacitorDb => {
    let open = initiallyOpen;
    const entry = { label, opens: 0, db: undefined as unknown as CapacitorDb };
    entry.db = {
      async open() {
        calls.push(`${label}.open`);
        entry.opens += 1;
        if (openError !== null) throw openError;
        open = true;
      },
      async isDBOpen() {
        calls.push(`${label}.isDBOpen`);
        return { result: open };
      },
      execute: async () => undefined,
      query: async () => ({ values: [] }),
      run: async () => undefined,
      close: async () => undefined,
    };
    dbs.push(entry);
    return entry.db;
  };

  let created = 0;
  const connections: CapacitorConnections = {
    async checkConnectionsConsistency() {
      calls.push('checkConnectionsConsistency');
      return { result: options.consistent ?? true };
    },
    async isConnection(database, readonly) {
      calls.push(`isConnection(${database},${readonly})`);
      return { result: options.exists ?? false };
    },
    async retrieveConnection(database, readonly) {
      calls.push(`retrieveConnection(${database},${readonly})`);
      return makeDb('retrieved', options.retrievedOpen ?? true, null);
    },
    async createConnection(database, encrypted, mode, version, readonly) {
      calls.push(`createConnection(${database},${encrypted},${mode},${version},${readonly})`);
      const error = createErrors.shift() ?? null;
      if (error !== null) throw error;
      created += 1;
      return makeDb(`created${created}`, false, openErrors.shift() ?? null);
    },
    async closeConnection(database, readonly) {
      calls.push(`closeConnection(${database},${readonly})`);
      if (options.closeError !== undefined) throw options.closeError;
    },
  };
  return { connections, calls, dbs };
}

const CHECK = ['checkConnectionsConsistency', `isConnection(${DB},false)`];
const CREATE = `createConnection(${DB},false,no-encryption,${VERSION},false)`;
const CLOSE = `closeConnection(${DB},false)`;

test('openCapacitorDb：没有旧连接时新建并打开', async () => {
  const { connections, calls, dbs } = fakeConnections();
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, CREATE, 'created1.isDBOpen', 'created1.open']);
  assert.equal(db, dbs[0]?.db);
  assert.equal(dbs[0]?.opens, 1);
});

test('openCapacitorDb：同名连接已在且已打开时直接复用，不新建、不重复打开', async () => {
  const { connections, calls, dbs } = fakeConnections({ exists: true, retrievedOpen: true });
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, `retrieveConnection(${DB},false)`, 'retrieved.isDBOpen']);
  assert.equal(db, dbs[0]?.db);
  assert.equal(dbs[0]?.opens, 0);
  assert.ok(!calls.some((call) => call.startsWith('createConnection')));
});

test('openCapacitorDb：复用的连接未打开时补一次 open', async () => {
  const { connections, calls, dbs } = fakeConnections({ exists: true, retrievedOpen: false });
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, `retrieveConnection(${DB},false)`, 'retrieved.isDBOpen', 'retrieved.open']);
  assert.equal(db, dbs[0]?.db);
  assert.equal(dbs[0]?.opens, 1);
});

test('openCapacitorDb：连接表与原生侧对不上时不复用，改为新建', async () => {
  const { connections, calls, dbs } = fakeConnections({ consistent: false, exists: true });
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, CREATE, 'created1.isDBOpen', 'created1.open']);
  assert.ok(!calls.some((call) => call.startsWith('retrieveConnection')));
  assert.equal(db, dbs[0]?.db);
});

test('openCapacitorDb：新建报「已存在」时关掉旧连接重建一次，并记警告', async () => {
  const before = logEntries().length;
  const { connections, calls, dbs } = fakeConnections({
    createErrors: [new Error('Connection dawntick already exists')],
  });
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, CREATE, CLOSE, CREATE, 'created1.open']);
  assert.equal(db, dbs[0]?.db);
  assert.equal(dbs[0]?.opens, 1);
  const warned = logEntries().slice(before);
  assert.ok(
    warned.some((entry) => entry.level === 'warn' && entry.scope === 'storage' && String(entry.detail?.message).includes('already exists')),
    JSON.stringify(warned),
  );
});

test('openCapacitorDb：复用的连接 open 失败也走关闭重建', async () => {
  const { connections, calls, dbs } = fakeConnections({ exists: true, retrievedOpen: false });
  // retrieved 连接的 open 不会失败，这里改成复用后 isDBOpen 本身抛错
  const retrieve = connections.retrieveConnection.bind(connections);
  connections.retrieveConnection = async (database, readonly) => {
    const db = await retrieve(database, readonly);
    db.isDBOpen = async () => {
      calls.push('retrieved.isDBOpen');
      throw new Error('isDBOpen 失败');
    };
    return db;
  };
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, `retrieveConnection(${DB},false)`, 'retrieved.isDBOpen', CLOSE, CREATE, 'created1.open']);
  assert.equal(db, dbs[1]?.db);
});

test('openCapacitorDb：关闭旧连接报错被吞掉，照样重建', async () => {
  const before = logEntries().length;
  const { connections, calls, dbs } = fakeConnections({
    openErrors: [new Error('open failed')],
    closeError: new Error('No available connection for dawntick'),
  });
  const db = await openCapacitorDb(connections, DB, VERSION);
  assert.deepEqual(calls, [...CHECK, CREATE, 'created1.isDBOpen', 'created1.open', CLOSE, CREATE, 'created2.open']);
  assert.equal(db, dbs[1]?.db);
  const warned = logEntries().slice(before).filter((entry) => entry.level === 'warn');
  assert.ok(warned.some((entry) => String(entry.detail?.message).includes('No available connection')), JSON.stringify(warned));
});

test('openCapacitorDb：重建后仍失败时抛出第二次的错误', async () => {
  const second = new Error('第二次打开失败');
  const { connections, calls } = fakeConnections({
    openErrors: [new Error('第一次打开失败'), second],
  });
  await assert.rejects(openCapacitorDb(connections, DB, VERSION), (error) => error === second);
  assert.deepEqual(calls, [...CHECK, CREATE, 'created1.isDBOpen', 'created1.open', CLOSE, CREATE, 'created2.open']);
});

test('openCapacitorDb：重建时新建连接失败也原样抛出', async () => {
  const second = new Error('Connection dawntick already exists');
  const { connections, calls } = fakeConnections({ createErrors: [new Error('first'), second] });
  await assert.rejects(openCapacitorDb(connections, DB, VERSION), (error) => error === second);
  assert.deepEqual(calls, [...CHECK, CREATE, CLOSE, CREATE]);
});
