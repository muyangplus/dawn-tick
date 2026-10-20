import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOOKMARKLET_VERSION,
  PAGE_BOOKMARKLET,
  PAGE_DIAGNOSTICS_FIELDS,
  PAGE_FRAME_SEPARATOR,
  countPastedFrames,
  detectSystem,
  extractTimetableFromHtml,
  inspectPage,
  looksLikeTimetablePage,
  parsePageDiagnostics,
  stripPageMarkers,
} from '../src/import/page-tables.ts';
import { EXPECTED_DIAGNOSTICS, diagnosticCountsOf } from './fixtures/import-diagnostics.ts';

/** 桌面注入脚本与书签是同一协议的两种实现：字段清单在这里静态核对。 */
const INJECTION_SOURCE = readFileSync(
  fileURLToPath(new URL('../../../apps/desktop/src-tauri/src/import-injection.js', import.meta.url)),
  'utf8',
);

const GRID_PAGE = `<!doctype html><html><body>
<table id="kbtable">
  <tr>
    <td id="1-1"><div class="timetable_con"><span class="title">高等数学</span><p>张老师</p><p>教三-201</p><p>1-16周</p></div></td>
    <td id="3-1"><div class="timetable_con"><span class="title">大学物理</span><p>李老师</p><p>理科楼-105</p><p>2-16周(双)</p></div></td>
  </tr>
  <tr>
    <td id="1-2"><div class="timetable_con"><span class="title">高等数学</span><p>张老师</p><p>教三-201</p><p>1-16周</p></div></td>
    <td id="5-3"><div class="timetable_con"><span class="title">体育</span><p>1,3,5周</p></div></td>
  </tr>
</table></body></html>`;

const WEEKDAY_TABLE_PAGE = `<!doctype html><html><body>
<table class="mytable">
  <tr><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th></tr>
  <tr>
    <td>第1节 08:00-08:45</td>
    <td>高等数学<br>张老师<br>教三-201<br>1-16周</td>
    <td></td><td>程序设计<br>王老师<br>信息楼-302<br>1-8周</td><td></td><td></td>
  </tr>
  <tr>
    <td>第2节 08:55-09:40</td>
    <td>高等数学<br>张老师<br>教三-201<br>1-16周</td>
    <td>大学物理<br>李老师<br>理科楼-105<br>2-16周(双)</td><td></td><td></td><td>体育<br>1,3,5周</td>
  </tr>
</table></body></html>`;

const OTHER_PAGE = '<html><body><h1>教务系统首页</h1><p>请选择学期</p></body></html>';

test('识别正方式「日-节」网格', () => {
  const result = extractTimetableFromHtml(GRID_PAGE, { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.equal(result.schedules.length, 3);
  const math = result.schedules.find((item) => item.courseName === '高等数学');
  assert.equal(math?.dayOfWeek, 1);
  assert.equal(math?.periodStart, 1);
  assert.equal(math?.periodEnd, 2, '连堂应合并');
  assert.equal(math?.room, '教三-201');
  assert.equal(math?.teacher, '张老师');
});

test('识别星期表头表格', () => {
  const result = extractTimetableFromHtml(WEEKDAY_TABLE_PAGE, { totalWeeks: 20 });
  assert.equal(result.shape, 'weekday-table');
  assert.equal(result.schedules.length, 5);
  const physics = result.schedules.find((item) => item.courseName === '大学物理');
  assert.equal(physics?.dayOfWeek, 2);
  assert.equal(physics?.periodStart, 2);
  assert.equal(physics?.room, '理科楼-105');
  assert.deepEqual(physics?.weeks, [2, 4, 6, 8, 10, 12, 14, 16]);

  const pe = result.schedules.find((item) => item.courseName === '体育');
  assert.equal(pe?.dayOfWeek, 5);
  assert.deepEqual(pe?.weeks, [1, 3, 5]);

  const programming = result.schedules.find((item) => item.courseName === '程序设计');
  assert.equal(programming?.dayOfWeek, 3);
  assert.equal(programming?.periodStart, 1);
  assert.equal(programming?.weeks.length, 8);
});

test('非课表页面给出提示且判为非课表', () => {
  const result = extractTimetableFromHtml(OTHER_PAGE);
  assert.equal(result.shape, 'none');
  assert.equal(result.schedules.length, 0);
  assert.match(result.warnings.join('；'), /未在页面中识别到课表/);
  assert.equal(looksLikeTimetablePage(OTHER_PAGE), false);
  assert.equal(looksLikeTimetablePage(GRID_PAGE), true);
  assert.equal(looksLikeTimetablePage(WEEKDAY_TABLE_PAGE), true);
});

test('无周次标注时按全周导入', () => {
  const page = `<table><tr><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th></tr>
    <tr><td>1</td><td>自习</td><td>自习</td><td>自习</td></tr></table>`;
  const result = extractTimetableFromHtml(page, { totalWeeks: 18 });
  assert.equal(result.schedules.length, 3);
  assert.equal(result.schedules[0]?.weeks.length, 18);
});

test('书签小工具标记可剥离', () => {
  const payload = `${PAGE_BOOKMARKLET.slice(0, 0)}<<<DAWNTICK>>><table></table><<<END>>>`;
  assert.equal(stripPageMarkers(payload), '<table></table>');
  assert.match(PAGE_BOOKMARKLET, /^javascript:/);
  assert.match(PAGE_BOOKMARKLET, /<<<DAWNTICK>>>/);
  assert.match(PAGE_BOOKMARKLET, /iframe/, '书签需收集 iframe 内容');
  assert.equal(stripPageMarkers(GRID_PAGE), GRID_PAGE, '无标记时原样返回');
});

test('诊断字段清单与两端实现一致', () => {
  // 共用样例只断言计数字段，元信息字段由两端各自补全
  assert.deepEqual(Object.keys(EXPECTED_DIAGNOSTICS), ['frames', 'tables', 'kbTables', 'gridCells']);
  for (const field of PAGE_DIAGNOSTICS_FIELDS) {
    assert.match(PAGE_BOOKMARKLET, new RegExp(`\\b${field}\\s*:`), `书签缺少诊断字段 ${field}`);
    assert.match(INJECTION_SOURCE, new RegExp(`\\b${field}\\s*:`), `注入脚本缺少诊断字段 ${field}`);
  }
  // 版本号两端同源：书签直接内联常量，注入脚本读不到 TS，只能写死并在测试里核对
  assert.match(PAGE_BOOKMARKLET, new RegExp(`\\bv:${BOOKMARKLET_VERSION}\\b`));
  assert.match(INJECTION_SOURCE, new RegExp(`DIAGNOSTICS_VERSION\\s*=\\s*${BOOKMARKLET_VERSION}\\b`));

  // 计数字段必须能完整往返（注入脚本与书签共用同一个解析器）
  const payload = `<<<DAWNTICK>>>${JSON.stringify({
    v: BOOKMARKLET_VERSION,
    url: 'https://jw.example.edu.cn/',
    title: '个人课表查询',
    ...EXPECTED_DIAGNOSTICS,
    ready: 'complete',
    loading: false,
  })}<<<END>>>`;
  const diagnostics = parsePageDiagnostics(payload);
  assert.deepEqual(diagnosticCountsOf(diagnostics ?? {}), EXPECTED_DIAGNOSTICS);
});

test('桌面注入脚本的诊断字段进入未识别提示', () => {
  // 导入页（import-flow）把 warnings 直接展示给用户：桌面端带回的表格数应出现在提示里
  const payload = `<<<DAWNTICK>>>${JSON.stringify({
    v: BOOKMARKLET_VERSION,
    ...EXPECTED_DIAGNOSTICS,
  })}<<<END>>>${OTHER_PAGE}`;
  const result = extractTimetableFromHtml(payload);
  assert.equal(result.schedules.length, 0);
  assert.match(result.warnings.join('；'), /表格 0 个/);
  assert.match(result.warnings.join('；'), /页面片段 2 段/);
  assert.match(result.warnings.join('；'), /疑似课表 1 个/);
  assert.match(result.warnings.join('；'), /整点 2 个/);
});

test('课表在 iframe 里也能识别', () => {
  const outer = `<html><head><title>个人课表查询</title></head><body><iframe id="iframe1" src="/jwglxt/xskb/xskb_list.do"></iframe></body></html>`;
  const pasted = `<<<DAWNTICK>>>${outer}${PAGE_FRAME_SEPARATOR}${GRID_PAGE}<<<END>>>`;

  assert.equal(countPastedFrames(pasted), 2);
  const result = extractTimetableFromHtml(stripPageMarkers(pasted), { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.equal(result.schedules.length, 3);
  assert.equal(result.schedules[0]?.courseName, '高等数学');
});

test('解析某校真实课表单元格（校园+教室、教师、周次）', () => {
  // 取自真实页面：属性顺序为 rowspan 在前，教室写作「石湖  石C6-403」，周次写作「(1-2节)1-15周」
  const page = `<table id="kbgrid_table_0" class="table table-hover table-bordered text-center timetable1"><tbody>
    <tr><td colspan="9"><div class="timetable_title"><h6 class="pull-left">2026-2027学年第1学期</h6>徐照杰的课表</div></td></tr>
    <tr><td><span class="time">时间段</span></td><td><span class="time">节次</span></td><td><span class="time">星期一</span></td><td><span class="time">星期二</span></td><td><span class="time">星期三</span></td></tr>
    <tr><td rowspan="6"><span class="time">上午</span></td><td><span class="festival">1</span></td>
      <td rowspan="2" id="1-1" class="td_wrap"><div class="timetable_con text-left"><span class="title"><font color="blue">固体废物处理与处置</font></span><p><span title="节/周"><font color="blue"> (1-2节)1-15周</font></span></p><p><span title="上课地点"><font color="blue"> 石湖  石C6-403</font></span></p><p><span title="教师 "><font color="blue"> 何欣,金伟</font></span></p><p><span title="学分"><font color="blue"> 3</font></span></p></div></td>
      <td rowspan="2" id="2-1" class="td_wrap"><div class="timetable_con text-left"><span class="title"><font color="blue">大气污染控制工程(一)</font></span><p><font color="blue"> (1-2节)1-13周</font></p><p><font color="blue"> 石湖  石C4-307</font></p><p><font color="blue"> 朱一芝</font></p></div></td>
      <td rowspan="1" id="3-1" class="td_wrap"></td></tr>
    <tr><td><span class="festival">2</span></td><td rowspan="1" id="3-2" class="td_wrap"></td></tr>
    <tr><td><span class="festival">3</span></td>
      <td rowspan="2" id="1-3" class="td_wrap"><div class="timetable_con text-left"><span class="title"><font color="blue">工程技术经济与管理</font></span><p><font color="blue"> (3-4节)1-13周</font></p><p><font color="blue"> 石湖  石C6-403</font></p><p><font color="blue"> 李雅婕</font></p></div></td>
      <td rowspan="1" id="2-3" class="td_wrap"></td>
      <td rowspan="2" id="3-3" class="td_wrap"><div class="timetable_con text-left"><span class="title"><font color="blue">水污染控制工程(一)</font></span><p><font color="blue"> (3-4节)1-13周</font></p><p><font color="blue"> 石湖  石C6-403</font></p><p><font color="blue"> 陈重军,李博达,潘杨</font></p></div></td></tr>
    <tr><td><span class="festival">4</span></td><td rowspan="1" id="2-4" class="td_wrap"></td></tr>
    <tr><td><span class="festival">7</span></td>
      <td rowspan="2" id="5-7" class="td_wrap"><div class="timetable_con text-left"><span class="title"><font color="blue">物理性污染控制工程</font></span><p><font color="blue"> (7-8节)1-11周(单)</font></p><p><font color="blue"> 石湖  石C6-403</font></p><p><font color="blue"> 赵雪涛,梅娟</font></p></div></td>
      <td rowspan="1" id="6-7" class="td_wrap"></td><td rowspan="1" id="7-7" class="td_wrap"></td></tr>
    <tr><td><span class="festival">8</span></td><td rowspan="1" id="6-8" class="td_wrap"></td><td rowspan="1" id="7-8" class="td_wrap"></td></tr>
  </tbody></table>`;

  const result = extractTimetableFromHtml(page, { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.equal(result.schedules.length, 5, `应为 5 条排课，实际 ${JSON.stringify(result.schedules)}`);

  const solid = result.schedules.find((item) => item.courseName === '固体废物处理与处置');
  assert.equal(solid?.dayOfWeek, 1);
  assert.equal(solid?.periodStart, 1);
  assert.equal(solid?.periodEnd, 2, '连堂应合并');
  assert.equal(solid?.room, '石湖 石C6-403', '应识别出校园+教室');
  assert.equal(solid?.teacher, '何欣,金伟');
  assert.equal(solid?.weeks.length, 15);

  const physics = result.schedules.find((item) => item.courseName === '物理性污染控制工程');
  assert.equal(physics?.dayOfWeek, 5);
  assert.equal(physics?.periodStart, 7);
  assert.deepEqual(physics?.weeks, [1, 3, 5, 7, 9, 11], '单周应被识别');

  const water = result.schedules.find((item) => item.courseName === '水污染控制工程(一)');
  assert.equal(water?.dayOfWeek, 3);
  assert.equal(water?.room, '石湖 石C6-403');
  assert.equal(water?.teacher, '陈重军,李博达,潘杨');
});

test('识别失败时给出页面诊断', () => {
  const result = extractTimetableFromHtml(`<<<DAWNTICK>>>${OTHER_PAGE}<<<END>>>`);
  assert.equal(result.schedules.length, 0);
  assert.match(result.warnings.join('；'), /表格 \d+ 个/);
  assert.match(result.warnings.join('；'), /页面片段 \d+ 段/);
});

test('兼容下划线分隔的日-节网格', () => {
  const page = `<table><tr>
    <td id="1_1"><div><span class="title">下划线网格课程</span><p>张老师</p><p>教三-101</p><p>1-16周</p></div></td>
    <td id="4_3"><div><span class="title">下划线网格课程二</span><p>1-8周</p></div></td>
  </tr></table>`;
  const result = extractTimetableFromHtml(page, { totalWeeks: 20 });
  assert.equal(result.shape, 'grid');
  assert.equal(result.schedules.length, 2);
  assert.equal(result.schedules[0]?.dayOfWeek, 1);
  assert.equal(result.schedules[1]?.dayOfWeek, 4);
  assert.equal(result.schedules[1]?.periodStart, 3);
});

test('识别常见教务系统标记', () => {
  assert.equal(detectSystem(GRID_PAGE).id, 'jwglxt');
  assert.equal(detectSystem('<html><script src="/qzdatasource.js"></script></html>').id, 'qzdatasource');
  assert.equal(detectSystem('<html><title>教学信息服务平台</title></html>').id, 'urp');
  assert.equal(detectSystem(OTHER_PAGE).id, 'unknown');
});

test('手动映射可覆盖启发式', () => {
  // 表头在第 0 行，星期三列从第 1 列开始共 5 列，节次在第 0 列
  const page = `<table>
    <tr><td>节次</td><td>周一</td><td>周二</td><td>周三</td><td>周四</td><td>周五</td></tr>
    <tr><td>第1节</td><td>课程A<br>1-16周</td><td></td><td>课程C<br>1-8周</td><td></td><td></td></tr>
    <tr><td>第2节</td><td></td><td>课程B<br>1-16周</td><td></td><td></td><td>课程E<br>3-5周</td></tr>
  </table>`;
  const result = extractTimetableFromHtml(page, {
    totalWeeks: 20,
    mapping: { headerRow: 0, dayStartColumn: 1, dayCount: 5, periodColumn: 0 },
  });
  assert.equal(result.shape, 'weekday-table');
  assert.equal(result.schedules.length, 4);
  const courseC = result.schedules.find((item) => item.courseName === '课程C');
  assert.equal(courseC?.dayOfWeek, 3);
  assert.equal(courseC?.periodStart, 1);
  const courseE = result.schedules.find((item) => item.courseName === '课程E');
  assert.equal(courseE?.dayOfWeek, 5);
  assert.equal(courseE?.periodStart, 2);
  assert.match(result.warnings.join('；'), /按手动映射解析/);
});

test('映射不匹配时给出提示', () => {
  const result = extractTimetableFromHtml(OTHER_PAGE, {
    mapping: { headerRow: 0, dayStartColumn: 1, dayCount: 5, periodColumn: 0 },
  });
  assert.equal(result.schedules.length, 0);
  assert.match(result.warnings.join('；'), /按指定映射未解析到课程/);
});

test('页面表格预览供手动校正', () => {
  const inspection = inspectPage(WEEKDAY_TABLE_PAGE);
  assert.ok(inspection.tables.length >= 1);
  assert.equal(inspection.tables[0]?.rows[0]?.[1], '星期一');
  assert.equal(inspection.system.id, 'unknown');
  assert.ok(inspection.tables[0]?.rows.length ?? 0 >= 2);
});
