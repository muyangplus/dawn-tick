import { isValidTimeZone } from '@dawn-tick/core';

/**
 * 常用时区：下拉的默认候选（约 30 个），按国内用户的使用频率排序——默认上海，
 * 其次港澳台、东亚、东南亚、南亚/中东、欧洲、美洲、大洋洲，UTC 兜底。
 * 全部 IANA 时区（400+）不硬编码，靠 `Intl.supportedValuesOf` 搜索。
 */
export const COMMON_TIME_ZONES: readonly string[] = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Macau',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Ho_Chi_Minh',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
  'UTC',
];

/** 一次渲染的候选上限：全部时区有 400+，一次全列会卡；继续输入可缩小范围。 */
export const MAX_TIME_ZONE_RESULTS = 60;

let cachedAllZones: readonly string[] | null = null;

/** 读引擎支持的 IANA 时区；不支持（或抛错）时返回空表，交给常用表兜底。 */
function supportedTimeZones(): readonly string[] {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

/**
 * 全部 IANA 时区：常用表在前（保证 `Asia/Kolkata` 这类别名也能搜到），
 * 再拼 `Intl.supportedValuesOf('timeZone')`；引擎不支持时只回退常用表。
 * `supportedValuesOf` 不含 `UTC`（各引擎不一致），这里显式补上。
 */
export function allTimeZones(): readonly string[] {
  if (cachedAllZones !== null) return cachedAllZones;
  const zoneSet = new Set<string>(['UTC', ...COMMON_TIME_ZONES, ...supportedTimeZones()]);
  cachedAllZones = [...zoneSet];
  return cachedAllZones;
}

/**
 * 下拉候选：空关键词给常用列表；有输入时在全部 IANA 时区里按名字搜。
 * `_` 按空格处理，所以「new york」「new_york」都能命中 `America/New_York`。
 */
export function timeZoneCandidates(
  query: string,
  zones: readonly string[] = allTimeZones(),
): string[] {
  const keyword = query.trim().toLowerCase().replaceAll('_', ' ');
  if (keyword === '') return [...COMMON_TIME_ZONES];
  const hits = zones.filter((zone) => zone.toLowerCase().replaceAll('_', ' ').includes(keyword));
  return hits.slice(0, MAX_TIME_ZONE_RESULTS);
}

/**
 * 时区名校验：与 Intl 同口径，接受 IANA 名（含 UTC）与运行时支持的 ISO 8601 偏移（如 +08:00），
 * 空串、未知地区与时间本身（Z）都算无效。设置项落库前用它与运行时能力对齐。
 */
export function isValidTimeZoneName(value: string): boolean {
  const name = value.trim();
  return name.length > 0 && isValidTimeZone(name);
}
