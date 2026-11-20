/** 粘贴文本 / 文件导入：网页课表粘贴、书签小工具、文件选择与识别失败。 */
export const importPasteCopy = {
  tabsAria: '取材方式',
  tabs: {
    page: '粘贴网页课表',
    file: '选择文件',
  },

  /** 粘贴网页课表 */
  bookmarkStep: '1. 安装书签（可选）',
  bookmarkAria: '书签小工具代码',
  copyBookmark: '复制书签代码',
  copied: '已复制',
  runBookmarkStep: '2. 在课表页执行书签，页面内容进剪贴板',
  pasteStep: '3. 回到这里粘贴，自动识别课表',
  pasteAria: '粘贴课表页面内容',
  pastePlaceholder: '将课表页面内容（或书签复制的内容）粘贴到这里',
  recognize: '识别并预览',
  openMapping: '手动指定表格',
  useMapping: '改用手动指定表格',
  recognizeFailWhat: '识别失败',
  pageFailNext: '请换一种导入方式，或手动添加课程',
  fileFailNext: '请检查文件格式，或改用其他导入方式',

  /** 选择文件 */
  fileAria: '选择课表文件',
  pickFile: '选择文件',
  fileFormats: '支持 .csv / .xlsx / .ics / .txt',
  readingFile: '正在读取课表文件…',
  noSemester: '学期不存在，请先新建学期',
  fileNotRecognized: '文件里没有识别到课表',

  /** 识别结果与剪贴板 */
  warningSeparator: '；',
  noSchedules: '没有识别到排课',
  diagnosticsCopied: '诊断信息已复制',
  clipboardDenied: '浏览器未允许写入剪贴板，请改用「导出诊断日志」',
  diagnosticsSaveTitle: '导入诊断日志',
  diagnosticsExported: '已导出导入诊断日志',
  bookmarkCopied: '已复制，请粘贴到浏览器书签的地址栏',
  bookmarkClipboardDenied: '浏览器未允许写入剪贴板，请手动复制下方代码',
} as const;
