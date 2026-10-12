import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILTIN_TIMETABLES,
  DEFAULT_TIMETABLE_ID,
  SCHOOL_SYSTEM_IDS,
  findTimetable,
  presetToTimeSlots,
  readSystemsConfig,
  validateSystems,
  validateTimetables,
  type TimetablePeriod,
} from '../src/config/index.ts';
import { SYSTEM_ENTRIES } from '../src/import/school-list.ts';
import { formatClock, parseClock, reflowPeriods } from '../src/timetable.ts';

/** 直接读 JSON 原文：它是事实来源，用来和 TS 常量对拍，防止两处漂移。 */
const timetablesJson: unknown = JSON.parse(
  readFileSync(new URL('../src/config/timetables.json', import.meta.url), 'utf8'),
) as unknown;
const systemsJson: unknown = JSON.parse(
  readFileSync(new URL('../src/config/systems.json', import.meta.url), 'utf8'),
) as unknown;

/** 苏州科技大学 14 节作息（教务处公告）：45 分钟一节，第 2→3 节课间 15 分钟，其余 10 分钟。 */
const USTS_EXPECTED = [
  '1 08:00-08:45',
  '2 08:55-09:40',
  '3 09:55-10:40',
  '4 10:50-11:35',
  '5 11:45-12:30',
  '6 12:40-13:25',
  '7 13:35-14:20',
  '8 14:30-15:15',
  '9 15:25-16:10',
  '10 16:20-17:05',
  '11 17:15-18:00',
  '12 18:10-18:55',
  '13 19:05-19:50',
  '14 20:00-20:45',
];

const describePeriods = (periods: readonly { periodNo: number; start: string; end: string }[]) =>
  periods.map((period) => `${period.periodNo} ${period.start}-${period.end}`);

test('苏科大作息表：14 节逐节与教务处公告一致', () => {
  const usts = findTimetable('usts');
  assert.ok(usts !== undefined, '内置作息表应含苏州科技大学（id: usts）');
  assert.equal(usts.name, '苏州科技大学');
  assert.match(usts.source ?? '', /教务处/);
  assert.equal(usts.periods.length, 14);
  assert.deepEqual(
    usts.periods.map((period) => period.periodNo),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  );
  assert.deepEqual(describePeriods(usts.periods), USTS_EXPECTED);
});

test('苏科大作息表：每节 45 分钟，第 2→3 节课间 15 分钟、其余 10 分钟', () => {
  const usts = findTimetable('usts');
  assert.ok(usts !== undefined);
  const periods: readonly TimetablePeriod[] = usts.periods;

  for (const period of periods) {
    assert.equal(
      parseClock(period.end) - parseClock(period.start),
      45,
      `第 ${period.periodNo} 节应为 45 分钟：${period.start}-${period.end}`,
    );
  }

  for (let index = 1; index < periods.length; index += 1) {
    const previous: TimetablePeriod | undefined = periods[index - 1];
    const current: TimetablePeriod | undefined = periods[index];
    if (previous === undefined || current === undefined) throw new Error('作息表数据不完整');
    const gap: number = parseClock(current.start) - parseClock(previous.end);
    const expectedGap: number = previous.periodNo === 2 ? 15 : 10;
    assert.equal(gap, expectedGap, `第 ${previous.periodNo}→${current.periodNo} 节课间应为 ${expectedGap} 分钟`);
  }
});

test('通用作息表：08:00 起 12 节，每节 45 分钟、课间 10 分钟', () => {
  assert.equal(DEFAULT_TIMETABLE_ID, 'default');
  const preset = findTimetable(DEFAULT_TIMETABLE_ID);
  assert.ok(preset !== undefined, '默认作息表应存在');
  assert.equal(preset.periods.length, 12);

  let expectedStart = parseClock('08:00');
  for (const [index, period] of preset.periods.entries()) {
    assert.equal(period.periodNo, index + 1);
    assert.equal(period.start, formatClock(expectedStart), `第 ${index + 1} 节的开始时间`);
    assert.equal(period.end, formatClock(expectedStart + 45), `第 ${index + 1} 节的结束时间`);
    expectedStart += 45 + 10;
  }
});

test('findTimetable：按 id 查找，未知 id 返回 undefined', () => {
  assert.equal(findTimetable('usts')?.id, 'usts');
  assert.equal(findTimetable('  USTS  ')?.id, 'usts', 'id 查找忽略大小写与空白');
  assert.equal(findTimetable('不存在的学校'), undefined);
});

test('JSON 事实来源与 TS 常量逐字段一致（防止两处漂移）', () => {
  assert.deepEqual(timetablesJson, BUILTIN_TIMETABLES, 'timetables.json 与 BUILTIN_TIMETABLES 不一致');
  assert.deepEqual(systemsJson, readSystemsConfig(), 'systems.json 与 readSystemsConfig() 不一致');
  // 两个文件都要能通过启动期校验
  assert.doesNotThrow(() => validateTimetables(timetablesJson));
  assert.doesNotThrow(() => validateSystems(systemsJson));
});

test('readSystemsConfig：id 唯一、顺序稳定且包含 jwglxt', () => {
  const systems = readSystemsConfig();
  const ids = systems.map((system) => system.id);
  assert.equal(new Set(ids).size, ids.length, '教务系统 id 不应重复');
  assert.ok(ids.includes('jwglxt'), '必须包含正方教务 jwglxt');
  assert.deepEqual(ids, [...SCHOOL_SYSTEM_IDS], '配置顺序即识别优先级');

  const jwglxt = systems.find((system) => system.id === 'jwglxt');
  assert.equal(jwglxt?.name, '正方教务');
  assert.equal(jwglxt?.entryPath, '/jwglxt/xtgl/login_slogin.html');
  assert.ok((jwglxt?.detect.markers.length ?? 0) > 0, '正方教务应有页面标记');
  assert.ok((jwglxt?.detect.gridCellIdPatterns.length ?? 0) > 0, '正方教务应有「日-节」网格特征');
});

test('SYSTEM_ENTRIES 视图与 systems.json 内容一致（防止两处漂移）', () => {
  const raw = systemsJson as Array<Record<string, unknown>>;
  assert.equal(SYSTEM_ENTRIES.length, raw.length);
  SYSTEM_ENTRIES.forEach((entry, index) => {
    const source = raw[index];
    assert.ok(source !== undefined);
    assert.equal(entry.id, source['id']);
    assert.equal(entry.label, source['name']);
    assert.equal(entry.loginPath, source['entryPath']);
    assert.equal(entry.hint, source['hint']);
  });
  // 与 readSystemsConfig() 的适配视图必须逐条一致
  assert.deepEqual(
    SYSTEM_ENTRIES.map((entry) => ({ id: entry.id, label: entry.label, loginPath: entry.loginPath, hint: entry.hint })),
    readSystemsConfig().map((system) => ({
      id: system.id,
      label: system.name,
      loginPath: system.entryPath,
      hint: system.hint,
    })),
  );
});

test('配置校验：periodNo 重复或乱序会抛错', () => {
  const duplicated = [
    {
      id: 'demo',
      name: '示例作息',
      periods: [
        { periodNo: 1, start: '08:00', end: '08:45' },
        { periodNo: 1, start: '08:55', end: '09:40' },
      ],
    },
  ];
  assert.throws(() => validateTimetables(duplicated), /periodNo 应严格递增且不重复/);

  const unsorted = [
    {
      id: 'demo',
      name: '示例作息',
      periods: [
        { periodNo: 2, start: '08:55', end: '09:40' },
        { periodNo: 1, start: '08:00', end: '08:45' },
      ],
    },
  ];
  assert.throws(() => validateTimetables(unsorted), /periodNo 应严格递增且不重复/);

  const duplicatedId = [
    { id: 'demo', name: '示例作息', periods: [{ periodNo: 1, start: '08:00', end: '08:45' }] },
    { id: 'demo', name: '另一张', periods: [{ periodNo: 1, start: '09:00', end: '09:45' }] },
  ];
  assert.throws(() => validateTimetables(duplicatedId), /作息表 id 重复/);
});

test('配置校验：时间非法或 end ≤ start 会抛错', () => {
  const badTime = [
    { id: 'demo', name: '示例作息', periods: [{ periodNo: 1, start: '8:00', end: '08:45' }] },
  ];
  assert.throws(() => validateTimetables(badTime), /HH:MM/);

  const outOfRange = [
    { id: 'demo', name: '示例作息', periods: [{ periodNo: 1, start: '25:00', end: '25:45' }] },
  ];
  assert.throws(() => validateTimetables(outOfRange), /HH:MM/);

  const reversed = [
    { id: 'demo', name: '示例作息', periods: [{ periodNo: 1, start: '08:45', end: '08:45' }] },
  ];
  assert.throws(() => validateTimetables(reversed), /end 应晚于 start/);

  const backwards = [
    { id: 'demo', name: '示例作息', periods: [{ periodNo: 1, start: '09:00', end: '08:45' }] },
  ];
  assert.throws(() => validateTimetables(backwards), /end 应晚于 start/);

  assert.throws(() => validateTimetables([]), /不能为空/);
  assert.throws(() => validateTimetables({ id: 'demo' }), /应为数组/);
  assert.throws(
    () => validateTimetables([{ id: 'demo', name: '示例作息', periods: [] }]),
    /periods 应为非空数组/,
  );
});

test('配置校验：教务系统 id 未知或重复、入口路径非法会抛错', () => {
  const base = {
    name: '示例教务',
    entryPath: '/demo/',
    hint: '示例',
    detect: { markers: [] },
  };
  assert.throws(() => validateSystems([{ ...base, id: 'unknown-system' }]), /未知的教务系统 id/);
  assert.throws(
    () => validateSystems([{ ...base, id: 'jwglxt' }, { ...base, id: 'jwglxt' }]),
    /教务系统 id 重复/,
  );
  assert.throws(() => validateSystems([{ ...base, id: 'urp', entryPath: 'jwglxt/x' }]), /应以 \/ 开头/);
  assert.throws(() => validateSystems([]), /不能为空/);
  assert.throws(() => validateSystems(['not-an-object']), /应为对象/);
});

test('presetToTimeSlots：作息表摊平成 time_slots 的字段口径', () => {
  const usts = findTimetable('usts');
  assert.ok(usts !== undefined);
  const slots = presetToTimeSlots(usts);
  assert.equal(slots.length, 14);
  assert.deepEqual(slots[0], { periodNo: 1, startTime: '08:00', endTime: '08:45', section: 'am' });
  assert.deepEqual(slots[5], { periodNo: 6, startTime: '12:40', endTime: '13:25', section: 'pm' });
  assert.deepEqual(slots[11], { periodNo: 12, startTime: '18:10', endTime: '18:55', section: 'night' });
  assert.deepEqual(slots[13], { periodNo: 14, startTime: '20:00', endTime: '20:45', section: 'night' });
});

test('苏科大作息等价于「以第 3 节 09:55 为锚点」的顺延重排', () => {
  const usts = findTimetable('usts');
  assert.ok(usts !== undefined);
  const reflowed = reflowPeriods(usts.periods, {
    anchorPeriodNo: 3,
    durationMinutes: 45,
    breakMinutes: 10,
  });
  assert.deepEqual(describePeriods(reflowed), USTS_EXPECTED);
});
