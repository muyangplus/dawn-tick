import type { AppData } from '../../data.ts';
import type { AdjustForm } from '../../screens/timetable/adjust-form.ts';

/** 各分区共用：读整份表单，按字段打补丁写回。 */
export interface AdjustSectionProps {
  form: AdjustForm;
  update: (patch: Partial<AdjustForm>) => void;
}

export type AdjustCourse = AppData['courses'][number];
export type AdjustSchedule = AdjustCourse['schedules'][number];
