import {
  exportSemesterShare,
  isSharePayload,
  parseShare,
  SHARE_MODULES,
  shareToBackup,
  uuidv7,
  type SemesterRow,
  type Storage,
  type UserRow,
} from '@dawn-tick/core';
import { applyBackupPackage, type ApplyBackupResult } from '../package.ts';
import { dayStampLocal } from './dates.ts';
import { appSystemCopy } from '../copy/app-system.ts';

/** 分享文件的默认文件名：与其他导出一致，全英文加日期。 */
export function shareFileName(now: number): string {
  return `DawnTick-timetable-share-${dayStampLocal(now)}.json`;
}

/** 文本是不是课表分享文件（导入入口据此分流，不当备份解析）。 */
export function looksLikeShare(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    return isSharePayload(JSON.parse(trimmed));
  } catch {
    return false;
  }
}

/** 导出当前学期的分享文件；没有当前学期返回 null。 */
export async function exportActiveShare(
  storage: Storage,
  now = Date.now(),
): Promise<{ semesterName: string; text: string } | null> {
  const semesters = await storage.collection<SemesterRow>('semesters').getAll();
  const active = semesters.find((row) => row.deleted_at === null && row.is_active === 1);
  if (active === undefined) return null;
  const share = await exportSemesterShare(storage, active.id, now);
  return { semesterName: active.name, text: `${JSON.stringify(share, null, 2)}\n` };
}

export interface ShareImportOutcome extends ApplyBackupResult {
  semesterName: string;
}

/**
 * 分享文件导入为本机的一个新学期（非当前）：换新 id 后走 applyBackupPackage，
 * 外键、校验与当前学期规则与备份导入同一套；只落学期与课程两个模块。
 */
export async function importShareText(storage: Storage, text: string, now = Date.now()): Promise<ShareImportOutcome> {
  const share = parseShare(text.trim());
  const users = (await storage.collection<UserRow>('users').getAll()).filter((row) => row.deleted_at === null);
  const user = users[0];
  if (user === undefined) throw new Error(appSystemCopy.share.noSemester);
  const semesters = await storage.collection<SemesterRow>('semesters').getAll();
  const payload = shareToBackup(share, {
    userId: user.id,
    existingNames: semesters.filter((row) => row.deleted_at === null).map((row) => row.name),
    newId: uuidv7,
    now,
  });
  const result = await applyBackupPackage(storage, payload, {
    modules: SHARE_MODULES,
    mode: 'skip',
    activeSemester: 'keep-local',
    now,
  });
  const semesterName = String((payload.stores.semesters?.[0] as { name?: unknown } | undefined)?.name ?? '');
  return { ...result, semesterName };
}
