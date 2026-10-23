import type { Storage } from '@dawn-tick/core';
import { PeriodSettings } from '../../components/period-settings.tsx';
import { SchoolTimetableCard } from '../school-timetable-card.tsx';

export interface SlotsCardProps {
  storage: Storage;
  semesterId: string;
  onChanged: () => void;
}

/**
 * 作息与选校卡：节次时间表（每节起止、生成/追加/删除）与按学校套用作息。
 *
 * 两块数据操作各自留在 `PeriodSettings` 与 `SchoolTimetableCard` 里，本卡只负责并排呈现，
 * 由设置页按当前学期把 `semesterId` 传进来。
 */
export function SlotsCard({ storage, semesterId, onChanged }: SlotsCardProps) {
  return (
    <>
      <PeriodSettings storage={storage} semesterId={semesterId} onChanged={onChanged} />
      {/* 选校体验与导入流程统一：同一个 SchoolPicker，选中后套用该校作息或通用作息 */}
      <SchoolTimetableCard storage={storage} semesterId={semesterId} onChanged={onChanged} />
    </>
  );
}
