/** 设置 · 启动（Windows 开机自启）。 */
import { fail } from './common.ts';

export const startupCopy = {
  title: '启动',
  autoStartLabel: '开机自动启动',
  registered: '已注册',
  unregistered: '未注册',
  savingLabel: '正在设置开机自启…',
  registerFailed: (reason: string | null, enabling: boolean) =>
    fail('注册', reason ?? '未知原因', enabling ? '请以管理员权限注册' : undefined),
  elevatingLabel: '正在申请管理员权限…',
  elevatingMessage: '请在系统弹窗中允许管理员权限',
  elevateFailed: fail('提权', null, '请手动以管理员身份运行一次'),
  elevatedRegistered: '开机自启已注册（管理员权限）',
  elevatedNotDetected: '未检测到启动项。请以管理员身份运行一次',
  elevateButton: '以管理员权限注册',
  startHiddenLabel: '启动时隐藏窗口',
  startHiddenDescription: '仅对开机自启生效',
} as const;
