/** 学校选择器：搜索 + 标签/地区筛选 + 按省份分组；导入流程与作息设置共用，只对外给 `onPick(school)`。 */
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
import { ExternalLink } from './ui/external-link.tsx';
import { Input } from './ui/input.tsx';

/** 地区下拉里「全部地区」的哨兵值：Radix Select 不接受空字符串。 */
const ALL_PROVINCES = '__all__';

/** 我自己保存的教务条目所在一组的组名。 */
const SAVED_SCHOOLS_GROUP = '我已保存的学校';
/** 上次选过的学校置顶成这一组。 */
const RECENT_SCHOOL_GROUP = '最近使用';

export interface SchoolPickerProps {
  /** 预设上下文（决定徽标与版本号）；null 表示还在读取中 */
  context: PresetContext | null;
  /** 选中一所学校 */
  onPick: (school: School) => void;
  /** 已选学校 id：用于高亮与「已选」标记 */
  selectedId?: string | null;
  /** 上次选的学校：不就关键词搜索时置顶成「最近使用」一组 */
  pinned?: School | null;
  /** 内置 + 用户保存的教务条目：命中的会补一组「我已保存的学校」 */
  entries?: readonly SchoolEntry[];
  /** 搜索框的 `aria-label`（导入流程沿用「搜索学校」，便于既有断言与无障碍一致性） */
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
  pinned = null,
  entries,
  searchLabel = '搜索学校',
  placeholder = '校名 / 简称 / 拼音',
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
    // 置顶只在没搜索、没筛选时出现：一旦开始收敛结果，最近使用就不该占位置
    const pinnedRow = pinned !== null && query.trim() === '' && tag === null && province === null ? pinned : null;
    const built: Array<{ province: string; schools: School[]; start: number }> = [];
    const list: School[] = [];
    const push = (groupProvince: string, schools: School[]): void => {
      if (schools.length === 0) return;
      built.push({ province: groupProvince, schools, start: list.length });
      list.push(...schools);
    };
    push(RECENT_SCHOOL_GROUP, pinnedRow === null ? [] : [pinnedRow]);
    push(SAVED_SCHOOLS_GROUP, matchingEntrySchools(entries ?? [], query, results));
    for (const group of groupSchoolsByProvince(shown)) {
      // 置顶那一行已经在「最近使用」里出现过，省份分组不再重复
      const schools =
        pinnedRow === null ? group.schools : group.schools.filter((school) => school.id !== pinnedRow.id);
      push(group.province, schools);
    }
    return { flat: list, groups: built, hidden: results.length - shown.length };
  }, [entries, pinned, province, query, results, tag]);

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
                      <ExternalLink
                        dataRole="request-school"
                        href={requestSchoolUrl(school.name)}
                        ariaLabel={`请求适配 ${school.name}`}
                        className="text-xs text-primary-strong underline-offset-4 hover:underline"
                      >
                        请求适配
                      </ExternalLink>
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
              : `预设 ${context.version} · 已适配=有解析脚本`}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted">
          找不到你的学校？
          <ExternalLink
            dataRole="request-school-form"
            href={requestSchoolUrl()}
            ariaLabel="提交学校信息"
            className="text-primary-strong underline-offset-4 hover:underline"
          >
            提交学校信息
          </ExternalLink>
        </span>
      </div>
    </div>
  );
}
