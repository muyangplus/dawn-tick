/**
 * 页面导入诊断的共用样例。
 *
 * 桌面注入脚本（`apps/desktop/src-tauri/src/import-injection.js`）与书签小工具
 * （`page-tables.ts` 的 `PAGE_BOOKMARKLET`）跑同一份页面，断言同一组计数；
 * 计数口径以 `PAGE_DIAGNOSTICS_FIELDS` 的注释为准。
 *
 * 页面故意做成「主文档 1 个普通表格 + iframe 1 个课表表格」：
 * `tables`（2）与 `kbTables`（1）必须能区分开，`gridCells` 只数「日-节」单元格。
 */
export const DIAGNOSTICS_OUTER_PAGE = `<!doctype html><html><head><title>个人课表查询</title></head><body>
<table id="notice"><tr><td>2026-2027 学年第 1 学期</td></tr></table>
<iframe id="iframe1" src="/jwglxt/xskb/xskb_list.do"></iframe>
</body></html>`;

export const DIAGNOSTICS_INNER_PAGE = `<!doctype html><html><body>
<table id="kbtable"><tr>
  <td id="1-1"><div class="timetable_con"><span class="title">高等数学</span><p>张老师</p><p>教三-201</p><p>1-16周</p></div></td>
  <td id="3-1"><div class="timetable_con"><span class="title">大学物理</span><p>李老师</p><p>理科楼-105</p><p>1-16周</p></div></td>
</tr></table>
</body></html>`;

export const DIAGNOSTICS_URL = 'https://jw.example.edu.cn/jwglxt/xskb/xskb_list.do';

/** 两端必须报出同一组计数：2 段文档、2 个表格、1 个疑似课表、2 个网格单元格。 */
export const EXPECTED_DIAGNOSTICS = {
  frames: 2,
  tables: 2,
  kbTables: 1,
  gridCells: 2,
} as const;

/** 两端带回的页面内容都应能解析出这两门课。 */
export const EXPECTED_COURSE_NAMES = ['高等数学', '大学物理'] as const;

/** 从诊断对象里取出共用样例关心的计数字段，供两端断言。 */
export function diagnosticCountsOf(info: {
  frames?: number;
  tables?: number;
  kbTables?: number;
  gridCells?: number;
}): {
  frames: number | undefined;
  tables: number | undefined;
  kbTables: number | undefined;
  gridCells: number | undefined;
} {
  return {
    frames: info.frames,
    tables: info.tables,
    kbTables: info.kbTables,
    gridCells: info.gridCells,
  };
}
