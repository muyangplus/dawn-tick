import { useMemo } from 'react';
import {
  addDays,
  createEvent,
  createReschedule,
  dateRange,
  deleteEvent,
  updateEvent,
  type EventRow,
  type Storage,
} from '@dawn-tick/core';
import type { AppData } from '../../data.ts';
import { toast } from '../../components/ui/toaster.tsx';
import { useAction } from '../../lib/action.ts';
import { errorMessage } from '../../lib/errors.ts';
import { failureText } from '../../lib/fail.ts';
import { scheduleCopy } from '../../copy/home-schedule.ts';
import { logError, logInfo } from '../../log.ts';

/** 一次「设为连续假期」最多覆盖的天数 */
export const MAX_HOLIDAY_RANGE_DAYS = 60;

export interface ScheduleActions {
  /** 把某天设为假日（沿用当天已有的假日名，没有就用「放假」） */
  setHoliday(date: string): Promise<boolean>;
  /** 把某天设为非假日（记一条 workday，扣掉内置假日） */
  setWorkday(date: string): Promise<boolean>;
  /** 把一段连续日期设为假日：超出 60 天或日期为空时提示并返回 false */
  setHolidayRange(from: string, to: string): Promise<boolean>;
  /** 把某天的课全部停掉 */
  cancelDayLessons(date: string): Promise<boolean>;
  /** 把某天的课顺延到次日同节次 */
  moveDayLessons(date: string): Promise<boolean>;
  /** 勾选 / 取消勾选一条日程（时间线与倒计时卡片共用） */
  setDone(event: EventRow, done: boolean): Promise<void>;
  /** 软删除一条调课/调休记录 */
  deleteAdjust(event: EventRow): Promise<void>;
  /** 删除一条待办/作业/考试/实验 */
  removeEvent(event: EventRow): Promise<void>;
}

/**
 * 日程卡片的写库动作：卡片只发 intent（哪一天、哪一条），写库、失败提示与刷新都在这里。
 *
 * 批量动作（假日、停课、顺延）走 `useAction`：有整页蒙版的进行中提示与统一的失败提示；
 * 单条勾选与删除保持原来的轻量写回，不盖蒙版。
 */
export function useScheduleActions(input: {
  storage: Storage;
  data: AppData;
  onChanged: () => void;
}): ScheduleActions {
  const { storage, data, onChanged } = input;
  const { run } = useAction();
  const semesterId = data.semester === null ? null : data.semester.id;

  return useMemo<ScheduleActions>(() => {
    /** 单条写入的统一兜底：失败只记日志并提示，不抛给调用方 */
    async function write(what: string, task: () => Promise<void>): Promise<boolean> {
      try {
        await task();
        onChanged();
        return true;
      } catch (cause: unknown) {
        const message = errorMessage(cause);
        logError('timetable', '日程写入失败', { action: what, message });
        toast.error(failureText(scheduleCopy.writeFailed(what), message, scheduleCopy.retry));
        return false;
      }
    }

    return {
      async setHoliday(date) {
        if (semesterId === null) return false;
        return run({
          scope: 'timetable',
          label: scheduleCopy.settingHoliday,
          ok: scheduleCopy.holidaySet,
          fail: { what: scheduleCopy.holidayFailed, next: scheduleCopy.retry },
          task: async () => {
            await createEvent(storage, {
              userId: 'u1',
              semesterId,
              type: 'holiday',
              title: data.holidayLabels.get(date) ?? scheduleCopy.holidayTitle,
              onDate: date,
            });
            onChanged();
          },
        }).then((result) => result.ok);
      },

      async setWorkday(date) {
        if (semesterId === null) return false;
        return run({
          scope: 'timetable',
          label: scheduleCopy.settingWorkday,
          ok: scheduleCopy.workdaySet,
          fail: { what: scheduleCopy.workdayFailed, next: scheduleCopy.retry },
          task: async () => {
            await createEvent(storage, {
              userId: 'u1',
              semesterId,
              type: 'workday',
              title: scheduleCopy.workdayTitle,
              onDate: date,
            });
            onChanged();
          },
        }).then((result) => result.ok);
      },

      async setHolidayRange(from, to) {
        if (semesterId === null) return false;
        const first = from <= to ? from : to;
        const last = from <= to ? to : from;
        const dates = dateRange(first, last);
        if (dates.length === 0 || dates.length > MAX_HOLIDAY_RANGE_DAYS) {
          toast.error(scheduleCopy.rangeTooLong(MAX_HOLIDAY_RANGE_DAYS));
          return false;
        }
        return run({
          scope: 'timetable',
          label: scheduleCopy.settingRange,
          ok: scheduleCopy.rangeSet(dates.length),
          fail: { what: scheduleCopy.rangeFailed, next: scheduleCopy.retry },
          task: async () => {
            for (const date of dates) {
              await createEvent(storage, {
                userId: 'u1',
                semesterId,
                type: 'holiday',
                title: scheduleCopy.rangeHolidayTitle,
                onDate: date,
              });
            }
            onChanged();
          },
        }).then((result) => result.ok);
      },

      async cancelDayLessons(date) {
        if (semesterId === null) return false;
        const lessons = data.lessonsByDate.get(date) ?? [];
        if (lessons.length === 0) {
          toast.error(scheduleCopy.noLessons);
          return false;
        }
        return run({
          scope: 'timetable',
          label: scheduleCopy.cancelling,
          ok: scheduleCopy.cancelled(lessons.length),
          fail: { what: scheduleCopy.cancelFailed, next: scheduleCopy.retry },
          task: async () => {
            for (const lesson of lessons) {
              await createReschedule(storage, {
                userId: 'u1',
                semesterId,
                refScheduleId: lesson.scheduleId,
                onDate: date,
                action: 'cancel',
                title: scheduleCopy.cancelTitle(lesson.courseName),
              });
            }
            onChanged();
          },
        }).then((result) => result.ok);
      },

      async moveDayLessons(date) {
        if (semesterId === null) return false;
        const lessons = data.lessonsByDate.get(date) ?? [];
        if (lessons.length === 0) {
          toast.error(scheduleCopy.noLessons);
          return false;
        }
        const target = addDays(date, 1);
        return run({
          scope: 'timetable',
          label: scheduleCopy.moving,
          ok: scheduleCopy.moved(lessons.length, target),
          fail: { what: scheduleCopy.moveFailed, next: scheduleCopy.retry },
          task: async () => {
            for (const lesson of lessons) {
              await createReschedule(storage, {
                userId: 'u1',
                semesterId,
                refScheduleId: lesson.scheduleId,
                onDate: date,
                action: 'move',
                title: scheduleCopy.moveTitle(lesson.courseName),
                newDate: target,
                newPeriodStart: lesson.periodStart,
                newPeriodEnd: lesson.periodEnd,
              });
            }
            onChanged();
          },
        }).then((result) => result.ok);
      },

      async setDone(event, done) {
        await write(done ? scheduleCopy.markDone : scheduleCopy.unmarkDone, async () => {
          await updateEvent(storage, event.id, { done: done ? 1 : 0 });
          logInfo('timetable', '条目完成状态已更新', { id: event.id, done });
        });
      },

      async deleteAdjust(event) {
        await write(scheduleCopy.deleteAdjust, async () => {
          await updateEvent(storage, event.id, { deleted_at: Date.now() });
        });
      },

      async removeEvent(event) {
        await write(scheduleCopy.deleteEvent, async () => {
          await deleteEvent(storage, event.id);
        });
      },
    };
  }, [data, onChanged, run, semesterId, storage]);
}
