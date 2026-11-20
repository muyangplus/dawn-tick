import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiClient, AiEventDraft, AiRequest } from '@dawn-tick/core';
import { AI_DEFAULT_TIME, eventInputOfDraft, generateEventDrafts } from '../src/screens/todo-form/ai-events.ts';

const CONTEXT = { userId: 'u1', semesterId: 'sem-1', timeZone: 'Asia/Shanghai' };

function draftOf(overrides: Partial<AiEventDraft> = {}): AiEventDraft {
  return {
    kind: 'todo',
    title: '交材料',
    date: '2026-11-27',
    startTime: null,
    endTime: null,
    location: null,
    note: null,
    ...overrides,
  };
}

/** 上海墙钟 → UTC 毫秒（上海无夏令时，固定 +8），不依赖本机时区。 */
function shanghai(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

test('普通日程：类型为 temp，没有时刻按 09:00，不带截止与地点', () => {
  const input = eventInputOfDraft(draftOf({ location: '图书馆', note: '带学生证' }), CONTEXT);
  assert.equal(AI_DEFAULT_TIME, '09:00');
  assert.deepEqual(input, {
    userId: 'u1',
    type: 'temp',
    title: '交材料',
    semesterId: 'sem-1',
    onDate: '2026-11-27',
    startAt: shanghai('2026-11-27', '09:00'),
    endAt: null,
    dueAt: null,
    subject: null,
    location: null,
    seatNo: null,
    note: '带学生证',
    countdown: false,
    manualDone: false,
    startTime: null,
    endTime: null,
    showInTimetable: false,
  });
});

test('普通日程：起止时刻齐全时按自定义时间写', () => {
  const input = eventInputOfDraft(draftOf({ startTime: '14:00', endTime: '15:30' }), CONTEXT);
  assert.equal(input.startAt, shanghai('2026-11-27', '14:00'));
  assert.equal(input.endAt, shanghai('2026-11-27', '15:30'));
  assert.equal(input.startTime, '14:00');
  assert.equal(input.endTime, '15:30');
  assert.equal(input.dueAt, null);
});

test('只有开始时刻：开始按该时刻，不算自定义时间', () => {
  const input = eventInputOfDraft(draftOf({ startTime: '14:00' }), CONTEXT);
  assert.equal(input.startAt, shanghai('2026-11-27', '14:00'));
  assert.equal(input.endAt, null);
  assert.equal(input.startTime, null);
  assert.equal(input.endTime, null);
});

test('作业：截止取结束时刻，没有结束取开始；默认倒计时与手动完成', () => {
  const withEnd = eventInputOfDraft(draftOf({ kind: 'homework', startTime: '14:00', endTime: '23:59', location: '教三' }), CONTEXT);
  assert.equal(withEnd.type, 'homework');
  assert.equal(withEnd.dueAt, shanghai('2026-11-27', '23:59'));
  assert.equal(withEnd.location, null, '地点只给考试');
  assert.equal(withEnd.countdown, true);
  assert.equal(withEnd.manualDone, true);

  const startOnly = eventInputOfDraft(draftOf({ kind: 'homework', startTime: '15:00' }), CONTEXT);
  assert.equal(startOnly.dueAt, shanghai('2026-11-27', '15:00'));
  assert.equal(startOnly.dueAt, startOnly.startAt);

  const noTime = eventInputOfDraft(draftOf({ kind: 'homework' }), CONTEXT);
  assert.equal(noTime.dueAt, shanghai('2026-11-27', '09:00'));
});

test('考试：保留地点，倒计时开、手动完成关', () => {
  const input = eventInputOfDraft(
    draftOf({ kind: 'exam', title: '高数期中', date: '2026-12-01', startTime: '09:00', endTime: '11:00', location: 'A101' }),
    CONTEXT,
  );
  assert.equal(input.type, 'exam');
  assert.equal(input.location, 'A101');
  assert.equal(input.dueAt, null);
  assert.equal(input.countdown, true);
  assert.equal(input.manualDone, false);
  assert.equal(input.startAt, shanghai('2026-12-01', '09:00'));
  assert.equal(input.endAt, shanghai('2026-12-01', '11:00'));
  assert.equal(input.showInTimetable, false);
});

test('时刻按上下文时区换算，不看本机时区', () => {
  const tokyo = eventInputOfDraft(draftOf({ startTime: '09:00' }), { ...CONTEXT, timeZone: 'Asia/Tokyo' });
  assert.equal(tokyo.startAt, Date.UTC(2026, 10, 27, 0, 0));
  const newYork = eventInputOfDraft(draftOf({ startTime: '09:00' }), { ...CONTEXT, timeZone: 'America/New_York' });
  assert.equal(newYork.startAt, Date.UTC(2026, 10, 27, 14, 0), '11 月纽约为 UTC-5');
});

function fakeClient(output: string): { client: AiClient; requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    requests,
    client: {
      complete: async (request) => {
        requests.push(request);
        return output;
      },
    },
  };
}

test('generateEventDrafts：按给定时区的今天与星期写进提示词', async () => {
  // UTC 2026-11-20 17:00：上海已是 11-21 周六，UTC 仍是 11-20 周五
  const now = Date.UTC(2026, 10, 20, 17, 0);
  const output = JSON.stringify([{ kind: 'exam', title: '期中', date: '2026-11-24', startTime: '09:00', endTime: '08:00' }]);

  const shanghaiRun = fakeClient(output);
  const result = await generateEventDrafts(shanghaiRun.client, '下周二 9 点期中考试', now, 'Asia/Shanghai');
  const [system, user] = shanghaiRun.requests[0]!.messages;
  assert.match(system!.content, /今天是 2026-11-21，星期 6，时区 Asia\/Shanghai/);
  assert.equal(user!.content, '下周二 9 点期中考试');
  assert.deepEqual(result.items, [
    { kind: 'exam', title: '期中', date: '2026-11-24', startTime: '09:00', endTime: null, location: null, note: null },
  ]);
  assert.deepEqual(result.warnings, ['「期中」结束时刻无法识别，已去掉']);

  const utcRun = fakeClient('[]');
  await generateEventDrafts(utcRun.client, 'x', now, 'UTC');
  assert.match(utcRun.requests[0]!.messages[0]!.content, /今天是 2026-11-20，星期 5，时区 UTC/);

  const sundayRun = fakeClient('[]');
  await generateEventDrafts(sundayRun.client, 'x', Date.UTC(2026, 10, 22, 4, 0), 'America/New_York');
  assert.match(sundayRun.requests[0]!.messages[0]!.content, /今天是 2026-11-21，星期 6/);
  await generateEventDrafts(sundayRun.client, 'x', Date.UTC(2026, 10, 22, 12, 0), 'America/New_York');
  assert.match(sundayRun.requests[1]!.messages[0]!.content, /今天是 2026-11-22，星期 7/, '周日为 7');
});

test('generateEventDrafts：模型输出无法解析时抛可读错误', async () => {
  const { client } = fakeClient('好的，已为你添加');
  await assert.rejects(generateEventDrafts(client, 'x', Date.UTC(2026, 10, 20), 'Asia/Shanghai'), /没有 JSON/);
});
