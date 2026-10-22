import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPage, type PageInspection } from '@dawn-tick/core';
import {
  PAGE_TITLE_MAX_CHARS,
  SAMPLE_ROW_MAX_CHARS,
  buildImportDiagnostics,
  importDiagnosticsLogDetail,
  renderImportDiagnosticsText,
  sanitizePageUrl,
  truncateText,
  type ImportDiagnosticsMeta,
} from '../src/lib/import-diagnostics.ts';

const META: ImportDiagnosticsMeta = {
  version: '0.5.0',
  channel: '开发版',
  source: '粘贴网页课表',
  generatedAt: Date.parse('2026-10-22T18:04:27+08:00'),
};

const WEEKDAY_PAGE = `<html><head><title>个人课表</title></head><body><table>
  <tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td></tr>
  <tr><td>第1节</td><td>高等数学<br>1-16周</td><td></td><td></td></tr>
  <tr><td>第2节</td><td></td><td>大学物理<br>2-16周</td><td></td></tr>
</table></body></html>`;

test('无诊断：按粘贴内容估算计数，仍给出字段映射与样例行', () => {
  const summary = buildImportDiagnostics({
    text: WEEKDAY_PAGE,
    diagnostics: null,
    inspection: inspectPage(WEEKDAY_PAGE),
    result: { shape: 'weekday-table', schedules: 1 },
  });

  assert.equal(summary.fromPage, false);
  assert.equal(summary.frames, 1);
  assert.equal(summary.tables, 1);
  assert.equal(summary.kbTables, 0);
  assert.equal(summary.gridCells, 0);
  assert.equal(summary.loading, false);
  assert.equal(summary.system, '通用识别');
  assert.equal(summary.shape, 'weekday-table');
  assert.equal(summary.schedules, 1);
  assert.equal(summary.pageDiagnostics, null);

  assert.equal(summary.mapping?.headerRow, 0);
  assert.equal(summary.mapping?.dayStartColumn, 1);
  assert.equal(summary.mapping?.dayCount, 3);
  assert.equal(summary.mapping?.periodColumn, 0);
  assert.equal(summary.mapping?.dayLabels.join('/'), '星期一/星期二/星期三');
  assert.equal(summary.sampleRows.length, 3);

  const text = renderImportDiagnosticsText(summary, META);
  assert.ok(text.includes('表格数：1（按粘贴内容估算）'));
  assert.ok(text.includes('字段映射：表头行 0 · 星期列 1–3（星期一 星期二 星期三） · 节次列 0'));
  assert.ok(text.includes('无（内容没有携带书签或窗口诊断）'));
});

test('无表格也无诊断：样例行给占位文案，不拼接空行', () => {
  const summary = buildImportDiagnostics({ text: '只有一段文字', diagnostics: null, inspection: null });
  assert.deepEqual(summary.sampleRows, []);
  assert.equal(summary.mapping, null);
  assert.equal(summary.tables, 0);

  const text = renderImportDiagnosticsText(summary, META);
  assert.ok(text.includes('（没有可用的表格样例）'));
  assert.ok(text.includes('字段映射：未匹配到星期表头（按通用启发式解析）'));
});

test('加载中：诊断字段原样透出，计数来自书签诊断', () => {
  const summary = buildImportDiagnostics({
    text: '<<<DAWNTICK>>>{"v":2}<<<END>>>',
    diagnostics: {
      v: 2,
      url: 'https://jwgl.usts.edu.cn/jwglxt/xk?token=secret#top',
      title: '正方教务管理系统 - 学生个人课表查询页面 - 当前学期 - 2026-2027 学年第一学期',
      frames: 2,
      tables: 7,
      kbTables: 1,
      gridCells: 12,
      ready: 'interactive',
      loading: true,
    },
    result: { shape: 'none', schedules: 0 },
  });

  assert.equal(summary.fromPage, true);
  assert.equal(summary.loading, true);
  assert.equal(summary.frames, 2);
  assert.equal(summary.tables, 7);
  assert.equal(summary.kbTables, 1);
  assert.equal(summary.gridCells, 12);
  assert.equal(summary.ready, 'interactive');
  assert.equal(summary.url, 'https://jwgl.usts.edu.cn');
  assert.equal(summary.pageDiagnostics?.url, 'https://jwgl.usts.edu.cn');
  assert.equal(summary.title?.length, PAGE_TITLE_MAX_CHARS);
  assert.ok(summary.title?.endsWith('…'));

  const text = renderImportDiagnosticsText(summary, META);
  assert.ok(text.includes('是否仍在加载：是'));
  assert.ok(text.includes('页面地址：https://jwgl.usts.edu.cn'));
  assert.ok(!text.includes('token=secret'));
  assert.ok(!text.includes('/jwglxt'));
  assert.ok(!text.includes('#top'));
  assert.ok(text.includes('识别形态：未识别'));

  const serialized = JSON.stringify(importDiagnosticsLogDetail(summary, META));
  assert.ok(!serialized.includes('secret'));
  assert.ok(!serialized.includes('/jwglxt'));
  assert.ok(serialized.includes('"kbTables":1'));
});

test('大量表格：计数取诊断值，样例行始终只保留 3 行且逐行截断', () => {
  const rows = Array.from({ length: 80 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => `第${rowIndex}行第${columnIndex}列-${'很长的单元格'.repeat(4)}`),
  );
  const inspection: PageInspection = {
    tables: [{ index: 0, rows }],
    system: { id: 'unknown', label: '通用识别' },
  };
  const summary = buildImportDiagnostics({
    text: '<table></table>',
    diagnostics: { frames: 3, tables: 120, kbTables: 4, gridCells: 56 },
    inspection,
  });

  assert.equal(summary.tables, 120);
  assert.equal(summary.kbTables, 4);
  assert.equal(summary.gridCells, 56);
  assert.equal(summary.sampleRows.length, 3);
  assert.ok(summary.sampleRows.every((row) => row.length <= SAMPLE_ROW_MAX_CHARS));
  assert.ok(summary.sampleRows.every((row) => row.endsWith('…')));
  assert.ok(summary.sampleRows[0]?.startsWith('第0行第0列'));
});

test('URL 脱敏：只保留协议 + 主机，拒绝非 http(s) 与不可解析内容', () => {
  assert.equal(sanitizePageUrl('https://jwgl.usts.edu.cn/jwglxt/xk?x=1#top'), 'https://jwgl.usts.edu.cn');
  assert.equal(sanitizePageUrl('http://user:pass@example.com:8080/a/b?token=1'), 'http://example.com:8080');
  assert.equal(sanitizePageUrl('jwgl.usts.edu.cn/jwglxt/xk?x=1#top'), 'https://jwgl.usts.edu.cn');
  assert.equal(sanitizePageUrl('  '), null);
  assert.equal(sanitizePageUrl(null), null);
  assert.equal(sanitizePageUrl('javascript:alert(1)'), null);
  assert.equal(sanitizePageUrl('ftp://example.com/file'), null);
});

test('标题截断：压成单行、超长补省略号', () => {
  const short = truncateText('  个人\n课表   查询 ', 40);
  assert.equal(short, '个人 课表 查询');

  const long = truncateText('超'.repeat(60), PAGE_TITLE_MAX_CHARS);
  assert.equal(long.length, PAGE_TITLE_MAX_CHARS);
  assert.ok(long.endsWith('…'));

  assert.equal(truncateText('abc', 0), '');
});

test('复制文本包含版本、渠道、来源、诊断 JSON 与样例行', () => {
  const summary = buildImportDiagnostics({
    text: WEEKDAY_PAGE,
    diagnostics: {
      v: 2,
      url: 'https://jwgl.usts.edu.cn/jwglxt/xk?token=secret',
      title: '个人课表',
      frames: 1,
      tables: 1,
      kbTables: 1,
      gridCells: 0,
      ready: 'complete',
      loading: false,
    },
    inspection: inspectPage(WEEKDAY_PAGE),
    result: { shape: 'weekday-table', schedules: 1 },
  });
  const text = renderImportDiagnosticsText(summary, META);

  assert.ok(text.includes('应用版本：0.5.0（开发版）'));
  assert.ok(text.includes('导入来源：粘贴网页课表'));
  assert.ok(text.includes('"kbTables": 1'));
  assert.ok(text.includes('1. 节次 | 星期一 | 星期二 | 星期三'));
  assert.ok(!text.includes('token=secret'));
});

test('导出文本可追加相关日志，复制文本不追加', () => {
  const summary = buildImportDiagnostics({ text: WEEKDAY_PAGE, diagnostics: null });
  const withLogs = renderImportDiagnosticsText(summary, META, {
    logLines: ['2026-10-22 18:04:27.000 +08:00 [info] import: 识别诊断'],
  });

  assert.ok(withLogs.includes('— 相关日志 —'));
  assert.ok(withLogs.includes('[info] import: 识别诊断'));
  assert.ok(!renderImportDiagnosticsText(summary, META).includes('— 相关日志 —'));
});
