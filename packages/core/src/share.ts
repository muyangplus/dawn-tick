import { BACKUP_FORMAT, BACKUP_VERSION, type BackupModule, type BackupPayload } from './backup.ts';
import type { Storage } from './storage.ts';
import type { CourseRow, CourseScheduleRow, SemesterRow, TimeSlotRow } from './types.ts';

export const SHARE_FORMAT = 'dawn-tick-share';
export const SHARE_VERSION = 1;

/** 分享文件导入时落库的模块：只有学期、节次、课程与排课。 */
export const SHARE_MODULES: readonly BackupModule[] = ['semesters', 'courses'];

type Shared<T> = Omit<T, 'user_id' | 'is_active' | 'created_at' | 'updated_at' | 'deleted_at' | 'rev' | 'dirty'>;

export type SharedSemester = Shared<SemesterRow>;
export type SharedTimeSlot = Shared<TimeSlotRow>;
export type SharedCourse = Shared<CourseRow>;
export type SharedSchedule = Shared<CourseScheduleRow>;

/**
 * 只读课表分享文件：一个学期的节次、课程与排课。
 * 不含用户、日程、提醒、设置、课程备注与同步列；导入时换成新 id，作为本机的一个非当前学期落库。
 */
export interface SharePayload {
  format: typeof SHARE_FORMAT;
  version: number;
  exportedAt: number;
  semester: SharedSemester;
  timeSlots: SharedTimeSlot[];
  courses: SharedCourse[];
  schedules: SharedSchedule[];
}

const SYNC_KEYS = ['user_id', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'rev', 'dirty'] as const;

function strip<T extends object>(row: T): Shared<T> {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of SYNC_KEYS) delete copy[key];
  return copy as Shared<T>;
}

/** 导出一个学期的分享文件；软删的行不带，课程备注清空。 */
export async function exportSemesterShare(storage: Storage, semesterId: string, now = Date.now()): Promise<SharePayload> {
  const semester = await storage.collection<SemesterRow>('semesters').get(semesterId);
  if (semester === undefined || semester.deleted_at !== null) throw new Error('找不到要分享的学期');
  const alive = <T extends { deleted_at: number | null }>(row: T): boolean => row.deleted_at === null;
  const timeSlots = (await storage.collection<TimeSlotRow>('time_slots').getAll())
    .filter((row) => alive(row) && row.semester_id === semesterId)
    .sort((left, right) => left.period_no - right.period_no);
  const courses = (await storage.collection<CourseRow>('courses').getAll()).filter(
    (row) => alive(row) && row.semester_id === semesterId,
  );
  const courseIds = new Set(courses.map((row) => row.id));
  const schedules = (await storage.collection<CourseScheduleRow>('course_schedules').getAll()).filter(
    (row) => alive(row) && courseIds.has(row.course_id),
  );
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now,
    semester: strip(semester),
    timeSlots: timeSlots.map(strip),
    courses: courses.map((row) => ({ ...strip(row), note: null })),
    schedules: schedules.map(strip),
  };
}

export function isSharePayload(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { format?: unknown }).format === SHARE_FORMAT;
}

/** 读分享文件；结构不对直接报错，逐行合法性交给 importBackup 的校验。 */
export function parseShare(text: string): SharePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('分享文件不是合法 JSON');
  }
  if (!isSharePayload(parsed)) throw new Error('不是晓刻 DawnTick 课表分享文件');
  const payload = parsed as Partial<SharePayload>;
  if (typeof payload.version !== 'number' || payload.version > SHARE_VERSION) {
    throw new Error(`分享文件版本 ${String(payload.version)} 高于当前支持的 ${SHARE_VERSION}`);
  }
  const semester = payload.semester;
  if (typeof semester !== 'object' || semester === null || typeof semester.id !== 'string') {
    throw new Error('分享文件缺少学期');
  }
  const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  return {
    format: SHARE_FORMAT,
    version: payload.version,
    exportedAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : 0,
    semester,
    timeSlots: list(payload.timeSlots),
    courses: list(payload.courses),
    schedules: list(payload.schedules),
  };
}

export interface ShareImportOptions {
  /** 本机用户 id：学期挂在它下面 */
  userId: string;
  /** 本机已有的学期名：重名时加后缀 */
  existingNames: readonly string[];
  newId: () => string;
  now: number;
}

/** 重名时依次试「名（分享）」「名（分享 2）」…… */
export function uniqueShareName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? `${name}（分享）` : `${name}（分享 ${index}）`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * 分享文件 → 备份载荷：所有 id 换新（同一文件导入两次得到两个学期，不覆盖本机任何行），
 * 学期挂到本机用户、非当前；引用不到的行交给 importBackup 的外键检查跳过并报警告。
 */
export function shareToBackup(share: SharePayload, options: ShareImportOptions): BackupPayload {
  const sync = { created_at: options.now, updated_at: options.now, deleted_at: null, rev: 0, dirty: 1 };
  const semesterId = options.newId();
  const courseIds = new Map<string, string>();
  for (const course of share.courses) {
    if (typeof course?.id === 'string' && !courseIds.has(course.id)) courseIds.set(course.id, options.newId());
  }
  // 文件里引用不到的 id 换成本机不可能存在的值：外键检查必然跳过，不会误挂到本机同 id 的行上
  const remap = (id: unknown, table: Map<string, string>): unknown =>
    typeof id === 'string' ? (table.get(id) ?? `missing:${id}`) : id;
  const semesterTable = new Map([[share.semester.id, semesterId]]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: share.exportedAt,
    modules: [...SHARE_MODULES],
    meta: {},
    stores: {
      semesters: [
        {
          ...share.semester,
          ...sync,
          id: semesterId,
          user_id: options.userId,
          name: uniqueShareName(String(share.semester.name ?? '分享的学期'), options.existingNames),
          is_active: 0,
        },
      ],
      time_slots: share.timeSlots.map((row) => ({
        ...row,
        ...sync,
        id: options.newId(),
        semester_id: remap(row?.semester_id, semesterTable),
      })),
      courses: share.courses.map((row) => ({
        ...row,
        ...sync,
        id: remap(row?.id, courseIds),
        semester_id: remap(row?.semester_id, semesterTable),
        note: null,
      })),
      course_schedules: share.schedules.map((row) => ({
        ...row,
        ...sync,
        id: options.newId(),
        course_id: remap(row?.course_id, courseIds),
      })),
    },
  };
}
