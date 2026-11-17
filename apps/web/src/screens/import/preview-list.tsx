import type { ImportedSchedule } from '@dawn-tick/core';
import { cn } from '../../lib/cn.ts';
import { scheduleMeta } from './import-flow-model.ts';

export interface PreviewListProps {
  schedules: readonly ImportedSchedule[];
  duplicateRows: readonly boolean[];
  duplicatesKnown: boolean;
  visibleIndexes: readonly number[];
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
}

/**
 * 预览改为卡片行：窄屏每行三段（课程 / 重复标记 / 元信息），
 * 桌面用同一份 DOM 排成六列，不再为手机保留一张需要横向挤的表格。
 */
export function PreviewList({
  schedules,
  duplicateRows,
  duplicatesKnown,
  visibleIndexes,
  selected,
  onToggle,
}: PreviewListProps) {
  return (
    <div className="flex flex-col gap-1">
      <div
        aria-hidden
        className="hidden grid-cols-[auto_minmax(8rem,2fr)_repeat(4,minmax(0,1fr))] gap-2 px-2 pb-1 text-[11px] text-muted tablet:grid"
      >
        <span>选</span>
        <span>课程</span>
        <span>星期</span>
        <span>节次</span>
        <span>周次</span>
        <span>地点</span>
      </div>
      <ul className="flex flex-col gap-2" data-role="import-rows">
        {visibleIndexes.map((index) => {
          const item = schedules[index];
          if (item === undefined) return null;
          const duplicate = duplicatesKnown && duplicateRows[index] === true;
          const meta = scheduleMeta(item);
          return (
            <li
              key={`${item.courseName}-${index}`}
              data-role={duplicate ? 'import-conflict-row' : 'import-row'}
              className={cn(
                'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-md border border-line p-2',
                'tablet:grid-cols-[auto_minmax(8rem,2fr)_repeat(4,minmax(0,1fr))] tablet:items-center',
                duplicate && 'border-danger/40 bg-danger/5',
              )}
            >
              <input
                type="checkbox"
                className="row-span-2 mt-0.5 size-4 tablet:row-span-1 tablet:mt-0"
                checked={selected.has(index)}
                aria-label={`选择 ${item.courseName}`}
                onChange={() => onToggle(index)}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="break-words text-sm text-ink">{item.courseName}</span>
                {duplicate && (
                  <span
                    data-role="import-duplicate"
                    className="w-fit rounded-full bg-danger/10 px-2 py-0.5 text-[11px] text-danger-strong"
                  >
                    重复，将被跳过
                  </span>
                )}
              </div>
              <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tablet:contents">
                <span className="tabular">{meta.day}</span>
                <span className="tabular">{meta.periods}</span>
                <span>{meta.weeks}</span>
                <span className="break-words">{meta.room}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
