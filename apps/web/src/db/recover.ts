/**
 * 运行中数据库自愈的原生入口：调用 Rust `recover_database`。
 *
 * Rust 侧负责挑快照、留存损坏库、复制主库；本模块只做平台能力判断与错误归一。
 * 恢复成功后由调用方重启应用——运行中的 sqlx 连接已经不可用，不能热切换。
 */
import { invokeNative, nativeErrorMessage } from '../lib/native.ts';
import { logInfo, logWarn } from '../log.ts';

/** 与 Rust `recover::RecoverOutcome` 的 camelCase 序列化逐字对应。 */
export interface RecoverDatabaseOutcome {
  /** 是否已用快照覆盖主库；为 true 时必须重启应用才生效 */
  recovered: boolean;
  /** 恢复用的快照文件名 */
  snapshot: string | null;
  /** 失败原因或“无需恢复”的说明，可直接展示 */
  reason: string | null;
}

/** 非桌面端（浏览器/Android）没有文件级恢复入口时的可读原因。 */
export const RECOVER_UNSUPPORTED = '当前平台不支持自动恢复，请从备份文件导入或手动处理数据目录';

/** 失败结果统一构造：reason 一定非空，方便界面直接展示。 */
function failed(reason: string): RecoverDatabaseOutcome {
  return { recovered: false, snapshot: null, reason };
}

/**
 * 尝试从最近一份通过自检的快照恢复主库。
 *
 * 任何失败都归一成 `{ recovered: false, reason }`，不向界面抛原始 sqlx/Tauri 文案。
 */
export async function recoverDatabase(): Promise<RecoverDatabaseOutcome> {
  try {
    const outcome = await invokeNative<RecoverDatabaseOutcome>('recover_database');
    if (outcome === undefined || typeof outcome.recovered !== 'boolean') {
      logWarn('storage', '自动恢复在当前平台不可用');
      return failed(RECOVER_UNSUPPORTED);
    }
    if (outcome.recovered) {
      logInfo('storage', '运行中数据库已从快照恢复', { snapshot: outcome.snapshot });
    } else {
      logWarn('storage', '运行中数据库恢复未完成', { snapshot: outcome.snapshot, reason: outcome.reason });
    }
    return {
      recovered: outcome.recovered,
      snapshot: outcome.snapshot ?? null,
      reason: outcome.reason ?? null,
    };
  } catch (cause: unknown) {
    const reason = nativeErrorMessage(cause);
    logWarn('storage', '运行中数据库恢复失败', { message: reason });
    return failed(reason);
  }
}
