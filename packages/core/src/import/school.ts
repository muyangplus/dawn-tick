import type { ImportedSchedule } from './apply.ts';

export interface SchoolLogin {
  username: string;
  password: string;
  extra?: Record<string, string>;
}

export interface SchoolFetchInput {
  url: string;
  login: SchoolLogin;
  semesterStart?: string;
  totalWeeks?: number;
}

export interface SchoolFetchResult {
  schedules: ImportedSchedule[];
  warnings: string[];
}

/**
 * 教务系统适配接口。本期不提供实现，仅登记接口供后续按校扩展。
 * 实现要求：密码不得落盘；会话过期时页面可能返回 200 与登录页，需按内容判断而非状态码。
 */
export interface SchoolAdapter {
  id: string;
  name: string;
  matches(url: string): boolean;
  fetchTimetable(input: SchoolFetchInput): Promise<SchoolFetchResult>;
}

export const SCHOOL_ADAPTERS: readonly SchoolAdapter[] = [];

export function findSchoolAdapter(url: string): SchoolAdapter | undefined {
  return SCHOOL_ADAPTERS.find((adapter) => adapter.matches(url));
}
