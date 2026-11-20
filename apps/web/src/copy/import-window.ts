import { COUNT } from './common.ts';

/** 教务窗口导入：应用内登录教务、选校、手填入口，以及交回页（import-submit.html）。 */
export const importWindowCopy = {
  intro: '在应用内登录教务，带回课表',
  schoolTitle: '选择学校',
  schoolNone: '未选择学校',
  schoolPicked: (name: string) => `已选：${name}`,
  manualEntry: '手动填写入口地址',
  systemLabel: '教务系统',
  domainLabel: '学校域名',
  fillEntry: '按入口补齐',
  saveSchool: '保存到我的学校',
  urlLabel: '入口地址',
  openWindow: '打开教务窗口',
  closeWindow: '关闭窗口',
  unsupported: '当前平台没有内嵌教务窗口，请改用粘贴文本或文件',
  usePaste: '改用粘贴文本',

  /** 状态行 */
  noBuiltInEntry: (school: string) => `${school} 没有内置入口，请填写学校域名后点「按入口补齐」`,
  entryFilled: (school: string, system: string) => `已填入 ${school} 的教务入口（${system}）`,
  schoolSaved: (name: string) => `「${name}」已保存到我的学校列表`,
  warningSeparator: '；',
  recognized: (count: number) => `已从教务窗口识别到 ${COUNT('schedule', count)}排课，请核对后导入`,
  recognizedToast: (count: number) => `已从教务窗口识别到 ${COUNT('schedule', count)}排课`,
  openFailed: '打开教务窗口失败，请重试',
  closedEmpty: '已关闭教务窗口，没有带回页面内容',
  opened: '窗口已打开。登录后点窗口右下角「导入到晓刻」',
  closed: '已关闭教务窗口',
  windowUnsupported: '当前平台不支持内嵌窗口，请改用粘贴文本',
  openTimeout: '打开教务窗口超时，请关闭后重试',

  /** 交回页 */
  submitBack: '返回教务页面',
  submitEmptyTitle: '没有收到内容',
  submitEmptyDetail: '请回到教务页面，重新点击右下角「导入到晓刻」。',
  submitDecodeTitle: '内容读取失败',
  submitDecodeDetail: '请回到晓刻，改用书签或粘贴页面内容',
  submitFailTitle: '交回失败',
  submitUnsupported: '当前平台不支持内嵌导入，请回到晓刻粘贴页面内容',
  submitDoneTitle: '已交给晓刻',
  submitDoneDetail: (bytes: number) => `共 ${bytes} 字节。可关闭本窗口或返回教务页面`,
} as const;
