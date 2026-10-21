import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_TIME_ZONES,
  MAX_TIME_ZONE_RESULTS,
  allTimeZones,
  isValidTimeZoneName,
  timeZoneCandidates,
} from '../src/lib/timezones.ts';

test('常用时区约 30 个、无重复且都是合法时区', () => {
  assert.ok(COMMON_TIME_ZONES.length >= 28 && COMMON_TIME_ZONES.length <= 40);
  assert.equal(new Set(COMMON_TIME_ZONES).size, COMMON_TIME_ZONES.length);
  assert.ok(COMMON_TIME_ZONES.includes('Asia/Shanghai'));
  assert.ok(COMMON_TIME_ZONES.includes('UTC'));
  for (const zone of COMMON_TIME_ZONES) {
    assert.equal(isValidTimeZoneName(zone), true, `${zone} 应当是合法时区`);
  }
});

test('全部时区合并常用表并补上 UTC，且不重复', () => {
  const zones = allTimeZones();
  assert.ok(zones.length >= COMMON_TIME_ZONES.length);
  assert.equal(new Set(zones).size, zones.length);
  assert.ok(zones.includes('UTC'), 'supportedValuesOf 不含 UTC，需要补上');
  // 别名不在 supportedValuesOf 里（Node 返回 Asia/Calcutta），常用表要能搜到它
  assert.ok(zones.includes('Asia/Kolkata'));
  assert.ok(zones.includes('Asia/Shanghai'));
});

test('空关键词给常用时区列表', () => {
  assert.deepEqual(timeZoneCandidates('', []), [...COMMON_TIME_ZONES]);
  assert.deepEqual(timeZoneCandidates('   ', []), [...COMMON_TIME_ZONES]);
});

test('搜索过滤：忽略大小写与下划线，支持空格写法', () => {
  const zones = ['Asia/Shanghai', 'America/New_York', 'Asia/Kolkata', 'Europe/London'];
  assert.deepEqual(timeZoneCandidates('new york', zones), ['America/New_York']);
  assert.deepEqual(timeZoneCandidates('NEW_YORK', zones), ['America/New_York']);
  assert.deepEqual(timeZoneCandidates(' shang ', zones), ['Asia/Shanghai']);
  assert.deepEqual(timeZoneCandidates('kolkata', zones), ['Asia/Kolkata']);
  assert.deepEqual(timeZoneCandidates('zzz', zones), []);
});

test('搜索结果有上限，避免一次渲染 400+ 项', () => {
  const zones = Array.from({ length: MAX_TIME_ZONE_RESULTS + 20 }, (_, index) => `Test/Zone_${index}`);
  assert.equal(timeZoneCandidates('test/zone', zones).length, MAX_TIME_ZONE_RESULTS);
});

test('时区名校验：IANA 名有效，空串 / 未知地区 / 时间本身无效', () => {
  for (const valid of ['Asia/Shanghai', 'UTC', 'America/New_York', 'Asia/Kolkata']) {
    assert.equal(isValidTimeZoneName(valid), true, `${valid} 应当有效`);
  }
  for (const invalid of ['', '   ', 'Mars/Base', 'Asia/Shanghai/Extra', 'Z']) {
    assert.equal(isValidTimeZoneName(invalid), false, `${JSON.stringify(invalid)} 应当无效`);
  }
});

/** 新引擎把 ISO 8601 偏移（+08:00）也当合法时区标识符，老引擎会抛 RangeError。 */
function runtimeAcceptsOffsetZone(): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: '+08:00' });
    return true;
  } catch {
    return false;
  }
}

test(
  'ISO 时区校验：运行时支持偏移标识符时接受 +08:00 / -03:30',
  { skip: !runtimeAcceptsOffsetZone() },
  () => {
    assert.equal(isValidTimeZoneName('+08:00'), true);
    assert.equal(isValidTimeZoneName('-03:30'), true);
    assert.equal(isValidTimeZoneName(' +08:00 '), true, '首尾空白按去掉处理');
    assert.equal(isValidTimeZoneName('+24:00'), false, '偏移小时超出 23 无效');
    assert.equal(isValidTimeZoneName('+08:60'), false, '偏移分钟超出 59 无效');
  },
);
