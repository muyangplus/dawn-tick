import type { Collection, Storage, StoreName } from './storage.ts';
import { MAX_PERIODS } from './timetable.ts';

const EVENT_TYPES = ['exam', 'todo', 'temp', 'homework', 'lab', 'reschedule', 'holiday', 'makeup', 'workday'] as const;
const EVENT_NATURES = ['course', 'lab'] as const;
const ACTIONS = ['move', 'cancel', 'room_change', 'add'] as const;
const SOURCES = ['builtin', 'manual', 'from_school'] as const;
const SECTIONS = ['am', 'pm', 'night'] as const;
const TARGET_TYPES = ['course', 'schedule', 'event'] as const;
const DAY_KINDS = ['holiday', 'makeup', 'workday'] as const;

export interface Violation {
  store: StoreName;
  key: string | null;
  rule: string;
  message: string;
}

export class ValidationError extends Error {
  readonly violations: Violation[];

  constructor(violations: Violation[]) {
    super(violations.map((item) => `${item.store}.${item.rule}: ${item.message}`).join('; '));
    this.name = 'ValidationError';
    this.violations = violations;
  }
}

type Row = Record<string, unknown>;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function optionalText(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string';
}

function optionalInt(value: unknown): boolean {
  return value === null || value === undefined || isInt(value);
}

function inRange(value: unknown, min: number, max: number): boolean {
  return isInt(value) && value >= min && value <= max;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function push(out: Violation[], store: StoreName, key: string | null, rule: string, message: string): void {
  out.push({ store, key, rule, message });
}

/** 自定义时间：两个要么都空，要么都是 HH:MM 且结束晚于开始。 */
function pushClockRange(out: Violation[], store: StoreName, key: string | null, row: Row): void {
  const start = row['start_time'];
  const end = row['end_time'];
  const hasStart = start !== null && start !== undefined;
  const hasEnd = end !== null && end !== undefined;
  if (!hasStart && !hasEnd) return;
  if (!hasStart || !hasEnd) {
    push(out, store, key, 'start_time', '自定义时间需要同时给出开始与结束');
    return;
  }
  if (!isText(start) || !TIME_RE.test(start)) push(out, store, key, 'start_time', '必须是 HH:MM');
  if (!isText(end) || !TIME_RE.test(end)) push(out, store, key, 'end_time', '必须是 HH:MM');
  if (isText(start) && isText(end) && TIME_RE.test(start) && TIME_RE.test(end) && end <= start) {
    push(out, store, key, 'end_time', '结束时间必须晚于开始时间');
  }
}

/** 逐条校验，唯一性通过既有数据比对。规则与 001_init.sql 的约束对齐。 */
export function validateRow(store: StoreName, row: Row): Violation[] {
  const out: Violation[] = [];
  const rawKey = row['id'] ?? row['key'];
  const key = typeof rawKey === 'string' ? rawKey : null;

  if (store !== 'app_meta') {
    const primary = typeof row['id'] === 'string' ? row['id'] : null;
    if (primary === null || primary.length === 0) push(out, store, key, '主键', 'id 必须是非空字符串');
    if (!isInt(row['created_at'])) push(out, store, key, 'created_at', '必须是整数');
    if (!isInt(row['updated_at'])) push(out, store, key, 'updated_at', '必须是整数');
    if (!optionalInt(row['deleted_at'])) push(out, store, key, 'deleted_at', '必须是整数或空');
    if (row['rev'] !== undefined && !isInt(row['rev'])) push(out, store, key, 'rev', '必须是整数');
    if (row['dirty'] !== undefined && !isInt(row['dirty'])) push(out, store, key, 'dirty', '必须是整数');
  }

  switch (store) {
    case 'users':
      if (!isText(row['nickname']) || row['nickname'].length === 0) {
        push(out, store, key, 'nickname', '必须是非空字符串');
      }
      break;

    case 'semesters': {
      if (!isText(row['user_id']) || row['user_id'].length === 0) push(out, store, key, 'user_id', '必须是非空字符串');
      if (!isText(row['name']) || row['name'].length === 0) push(out, store, key, 'name', '必须是非空字符串');
      if (!isText(row['start_date']) || !DATE_RE.test(row['start_date'])) {
        push(out, store, key, 'start_date', '必须是 YYYY-MM-DD');
      }
      if (!inRange(row['total_weeks'], 1, 30)) push(out, store, key, 'total_weeks', '必须在 1..30');
      if (!isText(row['time_zone']) || row['time_zone'].length === 0) {
        push(out, store, key, 'time_zone', '必须是非空字符串');
      }
      if (row['is_active'] !== 0 && row['is_active'] !== 1) push(out, store, key, 'is_active', '必须是 0 或 1');
      break;
    }

    case 'time_slots': {
      if (!isText(row['semester_id'])) push(out, store, key, 'semester_id', '必须是非空字符串');
      if (!inRange(row['period_no'], 1, MAX_PERIODS)) push(out, store, key, 'period_no', `必须在 1..${MAX_PERIODS}`);
      if (!isText(row['start_time']) || !TIME_RE.test(row['start_time'])) {
        push(out, store, key, 'start_time', '必须是 HH:MM');
      }
      if (!isText(row['end_time']) || !TIME_RE.test(row['end_time'])) {
        push(out, store, key, 'end_time', '必须是 HH:MM');
      }
      if (row['section'] !== null && row['section'] !== undefined && !SECTIONS.includes(row['section'] as never)) {
        push(out, store, key, 'section', '必须是 am / pm / night');
      }
      break;
    }

    case 'courses': {
      if (!isText(row['semester_id'])) push(out, store, key, 'semester_id', '必须是非空字符串');
      if (!isText(row['name']) || row['name'].length === 0) push(out, store, key, 'name', '必须是非空字符串');
      if (!isText(row['color']) || !COLOR_RE.test(row['color'])) {
        push(out, store, key, 'color', '必须是 #RRGGBB');
      }
      if (row['credits'] !== null && row['credits'] !== undefined) {
        if (typeof row['credits'] !== 'number' || row['credits'] < 0) {
          push(out, store, key, 'credits', '必须是非负数或空');
        }
      }
      if (!optionalText(row['short_name'])) push(out, store, key, 'short_name', '必须是字符串或空');
      break;
    }

    case 'course_schedules': {
      if (!isText(row['course_id'])) push(out, store, key, 'course_id', '必须是非空字符串');
      if (!inRange(row['day_of_week'], 1, 7)) push(out, store, key, 'day_of_week', '必须在 1..7');
      if (!inRange(row['period_start'], 1, MAX_PERIODS)) push(out, store, key, 'period_start', `必须在 1..${MAX_PERIODS}`);
      if (!inRange(row['period_end'], 1, MAX_PERIODS)) push(out, store, key, 'period_end', `必须在 1..${MAX_PERIODS}`);
      if (isInt(row['period_start']) && isInt(row['period_end']) && row['period_end'] < row['period_start']) {
        push(out, store, key, 'period_end', '必须大于等于 period_start');
      }
      if (!isInt(row['weeks_mask']) || row['weeks_mask'] <= 0) {
        push(out, store, key, 'weeks_mask', '必须是正整数');
      }
      pushClockRange(out, store, key, row);
      break;
    }

    case 'reminders': {
      if (!isText(row['user_id'])) push(out, store, key, 'user_id', '必须是非空字符串');
      if (!TARGET_TYPES.includes(row['target_type'] as never)) {
        push(out, store, key, 'target_type', '必须是 course / schedule / event');
      }
      if (!isText(row['target_id']) || row['target_id'].length === 0) {
        push(out, store, key, 'target_id', '必须是非空字符串');
      }
      if (!inRange(row['advance_minutes'], 0, 1440)) push(out, store, key, 'advance_minutes', '必须在 0..1440');
      for (const flag of ['enabled', 'skip_holidays', 'sound', 'vibrate']) {
        if (row[flag] !== 0 && row[flag] !== 1) push(out, store, key, flag, '必须是 0 或 1');
      }
      if (!inRange(row['dnd'], 0, 2)) push(out, store, key, 'dnd', '必须是 0 / 1 / 2');
      if (row['snooze_minutes'] !== null && row['snooze_minutes'] !== undefined) {
        if (!inRange(row['snooze_minutes'], 1, 120)) push(out, store, key, 'snooze_minutes', '必须在 1..120');
      }
      break;
    }

    case 'events': {
      const type = row['type'];
      if (!EVENT_TYPES.includes(type as never)) push(out, store, key, 'type', '取值不在允许集合内');
      if (!isText(row['title']) || row['title'].length === 0) push(out, store, key, 'title', '必须是非空字符串');
      if (row['parent_id'] !== null && row['parent_id'] !== undefined && row['parent_id'] === row['id']) {
        push(out, store, key, 'parent_id', '不能指向自身');
      }
      if (row['priority'] !== null && row['priority'] !== undefined) {
        if (type !== 'todo') push(out, store, key, 'priority', '仅待办可设置');
        else if (!inRange(row['priority'], 1, 3)) push(out, store, key, 'priority', '必须在 1..3');
      }
      // due_at（截止时刻）对所有类型开放：实验/考试/日程关联课程后也会带截止时间
      if (
        row['subject'] !== null &&
        row['subject'] !== undefined &&
        !['exam', 'todo', 'homework', 'lab'].includes(type as string)
      ) {
        push(out, store, key, 'subject', '仅考试、待办、作业与实验可设置');
      }
      if (row['seat_no'] !== null && row['seat_no'] !== undefined && type !== 'exam') {
        push(out, store, key, 'seat_no', '仅考试可设置');
      }
      for (const flag of ['countdown', 'manual_done', 'show_in_timetable']) {
        if (row[flag] !== undefined && row[flag] !== 0 && row[flag] !== 1) {
          push(out, store, key, flag, '必须是 0 或 1');
        }
      }
      if (row['nature'] !== null && row['nature'] !== undefined && !EVENT_NATURES.includes(row['nature'] as never)) {
        push(out, store, key, 'nature', '必须是 course / lab');
      }
      for (const field of ['period_start', 'period_end']) {
        if (row[field] === null || row[field] === undefined) continue;
        if (type !== 'lab') push(out, store, key, field, '仅实验可设置');
        else if (!inRange(row[field], 1, MAX_PERIODS)) push(out, store, key, field, `必须在 1..${MAX_PERIODS}`);
      }
      if (
        isInt(row['period_start']) &&
        isInt(row['period_end']) &&
        row['period_end'] < row['period_start']
      ) {
        push(out, store, key, 'period_end', '必须大于等于 period_start');
      }
      if (row['weeks_mask'] !== null && row['weeks_mask'] !== undefined) {
        if (type !== 'lab') push(out, store, key, 'weeks_mask', '仅实验可设置');
        else if (!isInt(row['weeks_mask']) || row['weeks_mask'] <= 0) {
          push(out, store, key, 'weeks_mask', '必须是正整数');
        }
      }
      if (type === 'lab' && (!isText(row['on_date']) || !DATE_RE.test(row['on_date']))) {
        push(out, store, key, 'on_date', '实验必须给出日期');
      }
      if (type === 'lab' && row['period_start'] === null) {
        push(out, store, key, 'period_start', '实验必须给出节次');
      }
      pushClockRange(out, store, key, row);
      if (row['source'] !== null && row['source'] !== undefined && !SOURCES.includes(row['source'] as never)) {
        push(out, store, key, 'source', '必须是 builtin / manual / from_school');
      }
      if (type === 'reschedule') {
        if (!isText(row['ref_schedule_id'])) push(out, store, key, 'ref_schedule_id', '调课必须关联排课');
        if (!ACTIONS.includes(row['action'] as never)) push(out, store, key, 'action', '调课必须给出动作');
        if (row['action'] === 'move' && !isText(row['new_date'])) {
          push(out, store, key, 'new_date', '改期必须给出新日期');
        }
        if (row['new_period_start'] !== null && row['new_period_start'] !== undefined && !inRange(row['new_period_start'], 1, MAX_PERIODS)) {
          push(out, store, key, 'new_period_start', `必须在 1..${MAX_PERIODS}`);
        }
        if (row['new_period_end'] !== null && row['new_period_end'] !== undefined && !inRange(row['new_period_end'], 1, MAX_PERIODS)) {
          push(out, store, key, 'new_period_end', `必须在 1..${MAX_PERIODS}`);
        }
        if (
          isInt(row['new_period_start']) &&
          isInt(row['new_period_end']) &&
          row['new_period_end'] < row['new_period_start']
        ) {
          push(out, store, key, 'new_period_end', '必须大于等于 new_period_start');
        }
      }
      if (DAY_KINDS.includes(type as never)) {
        if (!isText(row['on_date']) || !DATE_RE.test(row['on_date'])) {
          push(out, store, key, 'on_date', '假期与调休必须给出 YYYY-MM-DD');
        }
      }
      if (type === 'makeup' && !inRange(row['as_day_of_week'], 1, 7)) {
        push(out, store, key, 'as_day_of_week', '调休补课必须给出星期');
      }
      break;
    }

    case 'app_meta':
      if (!isText(row['key']) || row['key'].length === 0) push(out, store, key, 'key', '必须是非空字符串');
      if (!isText(row['value'])) push(out, store, key, 'value', '必须是字符串');
      break;
  }

  return out;
}

function alive(row: Row): boolean {
  return row['deleted_at'] === null || row['deleted_at'] === undefined;
}

interface UniqueRule {
  /** 违反时报的规则名（对应索引名） */
  rule: string;
  message: string;
  /** 参与唯一约束的行给出键，不参与返回 null */
  key: (row: Row) => string | null;
}

/** 唯一性规则，对应 001_init.sql 中的部分唯一索引。 */
const UNIQUE_RULES: Partial<Record<StoreName, UniqueRule>> = {
  semesters: {
    rule: 'ux_semesters_active',
    message: '每个用户只能有一个当前学期',
    key: (row) => (row['is_active'] === 1 ? String(row['user_id']) : null),
  },
  time_slots: {
    rule: 'ux_time_slots',
    message: '同一学期节次不能重复',
    key: (row) => `${String(row['semester_id'])}|${String(row['period_no'])}`,
  },
  events: {
    rule: 'ux_events_day_kind',
    message: '同一学期同一天只能有一条假期或调休判定',
    key: (row) =>
      DAY_KINDS.includes(row['type'] as never) ? `${String(row['semester_id'])}|${String(row['on_date'])}` : null,
  },
};

/**
 * 一批行写入后的唯一性：库里现有行（被本批同 id 覆盖的除外）与本批之间、本批内部都不能撞键。
 * 只读一次全表，批量导入不再是 O(n²)。
 */
export async function validateUniquenessBatch(
  storage: Storage,
  store: StoreName,
  rows: readonly Row[],
): Promise<Violation[]> {
  const rule = UNIQUE_RULES[store];
  const out: Violation[] = [];
  if (rule === undefined) return out;
  const candidates = rows.filter((row) => alive(row) && rule.key(row) !== null);
  if (candidates.length === 0) return out;

  const incoming = new Set(rows.map((row) => String(row['id'])));
  const taken = new Map<string, string>();
  for (const other of await storage.collection<Row>(store).getAll()) {
    if (!alive(other) || incoming.has(String(other['id']))) continue;
    const key = rule.key(other);
    if (key !== null) taken.set(key, String(other['id']));
  }
  for (const row of candidates) {
    const key = rule.key(row) as string;
    const id = typeof row['id'] === 'string' ? row['id'] : null;
    const holder = taken.get(key);
    if (holder !== undefined && holder !== id) push(out, store, id, rule.rule, rule.message);
    else taken.set(key, String(row['id']));
  }
  return out;
}

/**
 * 增量唯一性索引：一次读表后逐行检查、接受，供逐行决定取舍的批量导入使用。
 * 与 `validateUniquenessBatch` 同一套规则。
 */
export class UniqueIndex {
  private readonly keyById = new Map<string, string>();
  private readonly holderByKey = new Map<string, string>();

  private readonly store: StoreName;
  private readonly rule: UniqueRule | undefined;

  private constructor(store: StoreName, rule: UniqueRule | undefined) {
    this.store = store;
    this.rule = rule;
  }

  static async load(storage: Storage, store: StoreName): Promise<UniqueIndex> {
    const rule = UNIQUE_RULES[store];
    const index = new UniqueIndex(store, rule);
    if (rule !== undefined) {
      for (const row of await storage.collection<Row>(store).getAll()) index.accept(row);
    }
    return index;
  }

  check(row: Row): Violation[] {
    if (this.rule === undefined || !alive(row)) return [];
    const key = this.rule.key(row);
    if (key === null) return [];
    const holder = this.holderByKey.get(key);
    const id = typeof row['id'] === 'string' ? row['id'] : null;
    if (holder === undefined || holder === id) return [];
    const out: Violation[] = [];
    push(out, this.store, id, this.rule.rule, this.rule.message);
    return out;
  }

  /** 记下这一行（覆盖同 id 的旧键）。 */
  accept(row: Row): void {
    if (this.rule === undefined) return;
    const id = String(row['id']);
    const previous = this.keyById.get(id);
    if (previous !== undefined && this.holderByKey.get(previous) === id) this.holderByKey.delete(previous);
    this.keyById.delete(id);
    const key = alive(row) ? this.rule.key(row) : null;
    if (key === null) return;
    this.keyById.set(id, key);
    this.holderByKey.set(key, id);
  }
}

export async function validateUniqueness(storage: Storage, store: StoreName, row: Row): Promise<Violation[]> {
  return validateUniquenessBatch(storage, store, [row]);
}

export async function collectViolations(storage: Storage, store: StoreName, row: Row): Promise<Violation[]> {
  return [...validateRow(store, row), ...(await validateUniqueness(storage, store, row))];
}

export async function assertValid(storage: Storage, store: StoreName, row: Row): Promise<void> {
  const violations = await collectViolations(storage, store, row);
  if (violations.length > 0) throw new ValidationError(violations);
}

/** 一批行一起校验：逐行字段规则 + 一次读表的唯一性。 */
export async function assertValidBatch(storage: Storage, store: StoreName, rows: readonly Row[]): Promise<void> {
  const violations = [
    ...rows.flatMap((row) => validateRow(store, row)),
    ...(await validateUniquenessBatch(storage, store, rows)),
  ];
  if (violations.length > 0) throw new ValidationError(violations);
}

const VALIDATED = Symbol('validated-storage');

/** 已经由 `validatedStorage` 包过：写入时会自己校验，调用方不必再校验一遍。 */
export function isValidatedStorage(storage: Storage): boolean {
  return (storage as { [VALIDATED]?: boolean })[VALIDATED] === true;
}

export function validatedStorage(inner: Storage): Storage {
  if (isValidatedStorage(inner)) return inner;
  const cache = new Map<StoreName, Collection<unknown>>();
  const wrappedStorage: Storage & { [VALIDATED]: true } = {
    [VALIDATED]: true,
    kind: inner.kind,
    collection<T>(name: StoreName): Collection<T> {
      const existing = cache.get(name);
      if (existing !== undefined) return existing as Collection<T>;
      const base = inner.collection<T>(name);
      const wrapped: Collection<T> = {
        name,
        get: (key) => base.get(key),
        getAll: () => base.getAll(),
        put: async (value) => {
          await assertValid(inner, name, value as Row);
          await base.put(value);
        },
        putMany: async (values) => {
          await assertValidBatch(inner, name, values as Row[]);
          await base.putMany(values);
        },
        delete: (key) => base.delete(key),
        clear: () => base.clear(),
      };
      cache.set(name, wrapped as Collection<unknown>);
      return wrapped;
    },
    readMeta: (key) => inner.readMeta(key),
    writeMeta: (key, value) => inner.writeMeta(key, value),
    close: () => inner.close(),
  };
  return wrappedStorage;
}
