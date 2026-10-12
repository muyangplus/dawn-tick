/**
 * 学校选择器：搜索 + 筛选（标签 / 地区）+ 按省份分组的结果 + 适配徽标 + 请求适配入口。
 *
 * 导入（教务）流程与作息设置共用这一个组件：两处都只消费「用户选了哪所学校」
 * （`onPick(school)`）；选中之后的行为由调用方决定，导入据此生成教务入口 URL，作息据此套用该校作息。
 *
 * 交互要点：
 *   - 搜索框受控、输入即筛选，支持中文名/简称/简称全拼/首字母/校名全拼（口径见 core 的
 *     `searchSchools`，本组件不另立排序规则）；
 *   - 键盘可达：↑↓ 移动高亮、Enter 选中、Escape 交给外层（弹窗场景关闭弹窗）；
 *   - 每行点击区 ≥ 44px（`min-h-tap`），行的 `aria-label` 含校名、次要行与适配状态；
 *   - 徽标取值两态：「已适配 <预设版本>」与「暂未适配」，判定见
 *     `school-picker-model.ts` 的 `adapterInfo`（预设索引没有逐校 status 字段）；
 *   - 未适配的行给「请求适配」，底部给「找不到你的学校？提交学校信息」，两处指向
 *     同一个 GitHub Issue 模板地址（集中在 model 的 `requestSchoolUrl`）。
 */
import { useEffect, useId, useMemo, useState } from 'react';
import type { SchoolEntry } from '@dawn-tick/core';
import { cn } from '../lib/cn.ts';
import {
  adapterBadgeText,
  adapterInfo,
  extraSchoolTags,
  filterSchools,
  groupSchoolsByProvince,
  limitSchools,
  matchingEntrySchools,
  primarySchoolTags,
  provinceOptions,
  requestSchoolUrl,
  schoolSubtitle,
  type PresetContext,
  type School,
} from '../screens/school-picker-model.ts';
import { Button } from './ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/controls.tsx';
import { Input } from './ui/input.tsx';

/** 地区下拉里「全部地区」的哨兵值：Radix Select 不接受空字符串。 */
const ALL_PROVINCES = '__all__';

/** 我自己保存的教务条目所在一组的组名。 */
const SAVED_SCHOOLS_GROUP = '我已保存的学校';

export interface SchoolPickerProps {
  /** 预设上下文（决定徽标与版本号）；null 表示还在读取中 */
  context: PresetContext | null;
  /** 选中一所学校 */
  onPick: (school: School) => void;
  /** 已选学校 id：用于高亮与「已选」标记 */
  selectedId?: string | null;
  /** 内置 + 用户保存的教务条目：命中的会补一组「我已保存的学校」 */
  entries?: readonly SchoolEntry[];
  /** 搜索框的 `aria-label`（导入页沿用「搜索学校」，便于既有断言与无障碍一致性） */
  searchLabel?: string;
  placeholder?: string;
  /** 结果区最大高度类 */
  listClassName?: string;
  className?: string;
}

export function SchoolPicker({
  context,
  onPick,
  selectedId = null,
  entries,
  searchLabel = '搜索学校',
  placeholder = '输入校名、简称或拼音，如 清华 / 苏科大 / beida',
  listClassName = 'max-h-72',
  className,
}: SchoolPickerProps) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [province, setProvince] = useState<string | null>(null);
  const [moreTagsOpen, setMoreTagsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const filters = useMemo(() => ({ tag, province }), [tag, province]);
  const results = useMemo(() => filterSchools(query, filters), [query, filters]);

  /** 展平后的行顺序就是键盘 ↑↓ 的顺序；`start` 让分组直接切片，避免每行 indexOf。 */
  const { flat, groups, hidden } = useMemo(() => {
    const shown = limitSchools(results);
    const built: Array<{ province: string; schools: School[]; start: number }> = [];
    const list: School[] = [];
    const push = (groupProvince: string, schools: School[]): void => {
      if (schools.length === 0) return;
      built.push({ province: groupProvince, schools, start: list.length });
      list.push(...schools);
    };
    push(SAVED_SCHOOLS_GROUP, matchingEntrySchools(entries ?? [], query, results));
    for (const group of groupSchoolsByProvince(shown)) push(group.province, group.schools);
    return { flat: list, groups: built, hidden: results.length - shown.length };
  }, [entries, query, results]);

  // 换了关键词或筛选条件就回到第一行，免得高亮停在一个已经不在列表里的下标上
  useEffect(() => {
    setActive(0);
  }, [query, tag, province]);

  const primaryTags = primarySchoolTags();
  const foldedTags = extraSchoolTags();
  const version = context?.version ?? '…';

  return (
    <div
      data-role="school-picker"
      data-preset-version={version}
      className={cn('flex flex-col gap-2 rounded-md border border-line bg-surface p-3', className)}
    >
      <Input
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={searchLabel}
        aria-activedescendant={flat[active] === undefined ? undefined : `${listId}-${active}`}
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => Math.min(current + 1, Math.max(0, flat.length - 1)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter') {
            const picked = flat[active];
            if (picked !== undefined) {
              event.preventDefault();
              onPick(picked);
            }
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-2" data-role="school-filters">
        <Button
          size="sm"
          variant={tag === null ? 'primary' : 'secondary'}
          aria-label="筛选 全部"
          aria-pressed={tag === null}
          onClick={() => setTag(null)}
        >
          全部
        </Button>
        {primaryTags.map((item) => (
          <Button
            key={item}
            size="sm"
            variant={tag === item ? 'primary' : 'secondary'}
            aria-label={`筛选 ${item}`}
            aria-pressed={tag === item}
            onClick={() => setTag(tag === item ? null : item)}
          >
            {item}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          aria-label="更多标签"
          aria-expanded={moreTagsOpen}
          onClick={() => setMoreTagsOpen((open) => !open)}
        >
          {moreTagsOpen ? '收起标签' : `更多标签（${foldedTags.length}）`}
        </Button>
        <Select value={province ?? ALL_PROVINCES} onValueChange={(value) => setProvince(value === ALL_PROVINCES ? null : value)}>
          <SelectTrigger aria-label="地区" className="w-32">
            {province ?? '全部地区'}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROVINCES}>全部地区</SelectItem>
            {provinceOptions().map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {moreTagsOpen && (
        <div className="flex flex-wrap gap-2" data-role="school-more-tags">
          {foldedTags.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={tag === item ? 'primary' : 'secondary'}
              aria-label={`筛选 ${item}`}
              aria-pressed={tag === item}
              onClick={() => setTag(tag === item ? null : item)}
            >
              {item}
            </Button>
          ))}
        </div>
      )}

      <span className="text-xs text-muted" data-role="school-count">
        共 {results.length} 所
        {hidden > 0 ? ` · 仅显示前 ${flat.length} 所` : ''}
        {tag === null ? '' : ` · 筛选 ${tag}`}
        {province === null ? '' : ` · ${province}`}
      </span>

      <div
        id={listId}
        role="listbox"
        aria-label={`${searchLabel}结果`}
        className={cn('flex flex-col overflow-y-auto rounded-md border border-line', listClassName)}
      >
        {flat.length === 0 && (
          <div data-role="school-empty" className="p-3 text-sm text-muted">
            没有匹配的学校，请调整关键词（校名、简称、拼音首字母均可）
          </div>
        )}
        {groups.map((group) => (
          <div key={group.province} role="group" aria-label={group.province} data-role="school-group" data-province={group.province}>
            <div className="sticky top-0 flex items-center justify-between bg-surface-muted px-3 py-1 text-xs text-muted">
              <span>{group.province}</span>
              <span className="tabular">{group.schools.length}</span>
            </div>
            {group.schools.map((school, offset) => {
              const index = group.start + offset;
              const info = adapterInfo(context, school);
              const badge = adapterBadgeText(info, version);
              const subtitle = schoolSubtitle(school);
              const picked = selectedId === school.id;
              return (
                <div
                  key={`${school.id}-${index}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  data-role="school-row"
                  data-school-id={school.id}
                  data-adapted={info.adapted ? 'true' : 'false'}
                  data-picked={picked ? 'true' : 'false'}
                  aria-label={`${school.name}${subtitle === '' ? '' : `，${subtitle}`}，${badge}`}
                  className={cn(
                    'flex min-h-tap cursor-pointer items-center justify-between gap-2 px-3 py-1',
                    index === active && 'bg-surface-muted',
                    picked && 'border-l-2 border-primary-strong',
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(school)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-ink">{school.name}</span>
                    {subtitle !== '' && <span className="truncate text-xs text-muted">{subtitle}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {picked && <span className="text-xs text-primary-strong">已选</span>}
                    <span
                      data-role="school-badge"
                      title={info.reason}
                      className={cn('text-xs', info.adapted ? 'text-success-strong' : 'text-muted')}
                    >
                      {badge}
                    </span>
                    {!info.adapted && (
                      <a
                        data-role="request-school"
                        href={requestSchoolUrl(school.name)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`请求适配 ${school.name}`}
                        className="text-xs text-primary-strong underline-offset-4 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        请求适配
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-xs text-muted">
          {context === null
            ? '正在读取预设…'
            : context.problem !== null
              ? `预设索引不可用：${context.problem}`
              : `适配状态来自预设 ${context.version}：已适配为有解析脚本，暂未适配为无解析脚本`}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted">
          找不到你的学校？
          <a
            data-role="request-school-form"
            href={requestSchoolUrl()}
            target="_blank"
            rel="noreferrer"
            aria-label="提交学校信息"
            className="text-primary-strong underline-offset-4 hover:underline"
          >
            提交学校信息
          </a>
        </span>
      </div>
    </div>
  );
}
