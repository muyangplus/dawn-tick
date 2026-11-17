import { useCallback } from 'react';
import { logWarn } from '../log.ts';
import { useBusyAction } from './busy.ts';
import { errorMessage } from './errors.ts';
import { fail } from './fail.ts';
import { toast } from './toast.ts';

/** 失败提示的句式：发生了什么 + 下一步；失败原因由 `errorMessage` 统一归一。 */
export interface ActionFailure {
  what: string;
  next?: string;
}

export interface ActionSpec<T> {
  /** 日志 scope，例如 `course`、`timetable` */
  scope: string;
  /** 进行中的整页蒙版文案 */
  label: string;
  /** 成功 toast：给了才弹 */
  ok?: string;
  /** 失败 toast：给了才弹，`false` 表示调用方自己提示、只记日志 */
  fail?: ActionFailure | false;
  /** 失败日志文案；默认用 `fail.what`，传 `false` 关掉日志 */
  log?: string | false;
  /** 二次确认：返回 false 直接放弃，且不进入 busy */
  confirm?: () => boolean | Promise<boolean>;
  task: () => Promise<T>;
}

export interface ActionResult<T> {
  /** 任务是否真正执行并成功；被 confirm 取消或重复触发时为 false */
  ok: boolean;
  value: T | undefined;
  /** 失败原因（已归一）；取消或重复触发时为 null */
  error: string | null;
}

export interface ActionApi {
  busy: boolean;
  run: <T>(spec: ActionSpec<T>) => Promise<ActionResult<T>>;
}

/**
 * 异步动作的统一入口：busy 状态 + 重复触发保护 + 错误归一 + 可选 toast/日志/确认。
 *
 * 只负责进行中与失败呈现，不接管表单校验与成功后的刷新；底层复用 `useBusyAction`，
 * 因此仍会挂整页蒙版、并在已有操作时忽略重复点击。
 */
export function useAction(): ActionApi {
  const { busy, run: runBusyAction } = useBusyAction();
  const run = useCallback(
    async <T,>(spec: ActionSpec<T>): Promise<ActionResult<T>> => {
      if (spec.confirm !== undefined) {
        const proceed = await spec.confirm();
        if (!proceed) return { ok: false, value: undefined, error: null };
      }
      // task 是否真的跑过：重复触发会被 useBusyAction 静默忽略，用它区分成功与忽略
      let started = false;
      try {
        // 日志由本 hook 按 scope 统一记录，关掉底层的通用失败日志避免一处失败两条
        const value = await runBusyAction(
          spec.label,
          async () => {
            started = true;
            return await spec.task();
          },
          { log: false },
        );
        if (!started) return { ok: false, value: undefined, error: null };
        if (spec.ok !== undefined) toast.success(spec.ok);
        return { ok: true, value, error: null };
      } catch (cause: unknown) {
        const message = errorMessage(cause);
        if (spec.log !== false) {
          const failure = spec.fail === undefined || spec.fail === false ? undefined : spec.fail.what;
          logWarn(spec.scope, typeof spec.log === 'string' ? spec.log : (failure ?? '操作失败'), {
            message,
          });
        }
        if (spec.fail !== undefined && spec.fail !== false) {
          toast.error(fail(spec.fail.what, message, spec.fail.next ?? '请重试').text);
        }
        return { ok: false, value: undefined, error: message };
      }
    },
    [runBusyAction],
  );
  return { busy, run };
}
