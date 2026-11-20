import type { AppData } from '../../data.ts';
import { Field, Input } from '../ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/controls.tsx';
import type { AdjustSectionProps } from './section-props.ts';

/** 改为考试：考试日期、节次与备注；日期与节次复用改期的字段。 */
export function AdjustExamFields({ form, update }: AdjustSectionProps) {
  const { newDate, newStart, newEnd, examNote } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label="考试日期" hint="默认取「调整后日期」，可跨周">
        <Input
          type="date"
          value={newDate}
          aria-label="考试日期"
          onChange={(event) => update({ newDate: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="起始节">
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label="考试起始节"
            value={newStart}
            onChange={(event) => update({ newStart: event.target.value })}
          />
        </Field>
        <Field label="结束节">
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label="考试结束节"
            value={newEnd}
            onChange={(event) => update({ newEnd: event.target.value })}
          />
        </Field>
      </div>
      <Field label="备注（可选）">
        <Input
          value={examNote}
          aria-label="考试备注"
          placeholder="如 开卷、带计算器"
          onChange={(event) => update({ examNote: event.target.value })}
        />
      </Field>
      <span className="text-xs text-muted">考试写进日程并开启倒计时，原课次按停课处理</span>
    </div>
  );
}

/** 调休：原日期课表整体搬到目标上课日。 */
export function AdjustSwapFields({ form, update }: AdjustSectionProps) {
  const { restFrom, restTo } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label="原日期课表">
        <Input
          type="date"
          value={restFrom}
          aria-label="原日期课表"
          onChange={(event) => update({ restFrom: event.target.value })}
        />
      </Field>
      <Field label="目标上课日" hint="原日课表整体搬过来" help="调休后，目标日按原日课表上课">
        <Input
          type="date"
          value={restTo}
          aria-label="目标上课日"
          onChange={(event) => update({ restTo: event.target.value })}
        />
      </Field>
    </div>
  );
}

/** 临时加课：选已有课程或填新课程名，再定日期与节次。 */
export function AdjustExtraFields({ form, update, data }: AdjustSectionProps & { data: AppData }) {
  const { extraCourse, extraName, extraDate, extraStart, extraEnd } = form;
  return (
    <div className="flex flex-col gap-3">
      <Field label="已有课程">
        <Select value={extraCourse} onValueChange={(value) => update({ extraCourse: value })}>
          <SelectTrigger aria-label="已有课程">
            {data.courses.find((item) => item.id === extraCourse)?.name ?? '选择课程'}
          </SelectTrigger>
          <SelectContent>
            {data.courses.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="或自定义课程名称" hint="填了就按这个名字新建一门课">
        <Input
          value={extraName}
          aria-label="或自定义课程名称"
          placeholder="如 形势与政策（补课）"
          onChange={(event) => update({ extraName: event.target.value })}
        />
      </Field>
      <Field label="加课日期">
        <Input
          type="date"
          value={extraDate}
          aria-label="加课日期"
          onChange={(event) => update({ extraDate: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="起始节">
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label="起始节"
            value={extraStart}
            onChange={(event) => update({ extraStart: event.target.value })}
          />
        </Field>
        <Field label="结束节">
          <Input
            type="number"
            min={1}
            max={40}
            className="w-20"
            aria-label="结束节"
            value={extraEnd}
            onChange={(event) => update({ extraEnd: event.target.value })}
          />
        </Field>
      </div>
      <span className="text-xs text-muted">只加这一次，可在课程管理里删除</span>
    </div>
  );
}
