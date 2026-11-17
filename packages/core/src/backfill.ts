import type { Storage } from './storage.ts';
import { describeWeeks } from './weeks.ts';

/** 回填完成标记：存在即跳过，避免每次启动重扫。 */
export const WEEKS_RAW_BACKFILL_KEY = 'weeks_raw_backfill_v1';

type Row = Record<string, unknown>;

/**
 * 一次性回填历史排课的 `weeks_raw`：由 `weeks_mask` 生成周次文本。
 * 早期手工新建的排课只写了 mask，详情页与搜索副标题因此显示「未标注周次」。
 * 已带文本的行不改；无 mask 的残行跳过；重复调用幂等。
 */
export async function backfillWeeksRaw(storage: Storage): Promise<number> {
  if ((await storage.readMeta(WEEKS_RAW_BACKFILL_KEY)) === '1') return 0;
  const collection = storage.collection<Row>('course_schedules');
  const rows = await collection.getAll();
  let updated = 0;
  for (const row of rows) {
    const current = row['weeks_raw'];
    if (typeof current === 'string' && current.length > 0) continue;
    const mask = Number(row['weeks_mask'] ?? 0);
    if (!Number.isInteger(mask) || mask <= 0) continue;
    const text = describeWeeks(mask);
    if (text === '') continue;
    await collection.put({
      ...row,
      weeks_raw: text,
      updated_at: Date.now(),
      dirty: 1,
    });
    updated += 1;
  }
  await storage.writeMeta(WEEKS_RAW_BACKFILL_KEY, '1');
  return updated;
}
