import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_BOOKMARKLET,
  detectSystem,
  extractTimetableFromHtml,
  inspectPage,
  looksLikeTimetablePage,
  stripPageMarkers,
} from '../src/import/page-tables.ts';

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
  assert.equal(stripPageMarkers(GRID_PAGE), GRID_PAGE, '无标记时原样返回');
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
