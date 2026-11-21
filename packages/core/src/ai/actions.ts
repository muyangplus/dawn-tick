/**
 * AI 助手的操作清单：每个功能登记为一个动作。
 * 查询类直接执行把结果交回模型；写入与高危类只进计划，用户确认后才执行。
 * 上下文类型由登记方决定：core 的动作只用存储，web 的动作再带上界面与平台能力。
 */
import type { AiToolSpec } from './client.ts';

export type AiActionRisk = 'query' | 'write' | 'danger';

export type AiArgs = Readonly<Record<string, unknown>>;

export interface AiAction<C, P = unknown> {
  /** 函数名：小写字母、数字与下划线 */
  name: string;
  /** 给模型看的中文说明 */
  description: string;
  /** 参数的 JSON Schema（顶层 object） */
  parameters: Record<string, unknown>;
  risk: AiActionRisk;
  /** 校验并规范参数；不合法时抛 `AiArgError`，消息回给模型改正 */
  parse(args: AiArgs, context: C): P | Promise<P>;
  /** 计划卡片上的一行说明；查询类不用 */
  preview(params: P, context: C): string | Promise<string>;
  /** 查询类返回可 JSON 化的结果；写入类返回一句执行结果 */
  run(params: P, context: C): Promise<unknown>;
}

/** 登记一个动作：只为让 P 在 parse / preview / run 之间推导一致。 */
export function defineAction<C, P>(action: AiAction<C, P>): AiAction<C, unknown> {
  return action as AiAction<C, unknown>;
}

export class AiArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiArgError';
  }
}

export function actionTools<C>(actions: readonly AiAction<C>[]): AiToolSpec[] {
  return actions.map((action) => ({
    name: action.name,
    description: action.risk === 'query' ? action.description : `${action.description}（写入：进入待执行计划，用户确认后执行）`,
    parameters: action.parameters,
  }));
}

export function findAction<C>(actions: readonly AiAction<C>[], name: string): AiAction<C> | undefined {
  return actions.find((action) => action.name === name);
}

// ---- JSON Schema 片段 ----

type Schema = Record<string, unknown>;

export function objectSchema(properties: Record<string, Schema>, required: readonly string[] = []): Schema {
  return { type: 'object', properties, required: [...required], additionalProperties: false };
}

export const schema = {
  string: (description: string): Schema => ({ type: 'string', description }),
  integer: (description: string, minimum?: number, maximum?: number): Schema => ({
    type: 'integer',
    description,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  }),
  boolean: (description: string): Schema => ({ type: 'boolean', description }),
  enumOf: (description: string, values: readonly string[]): Schema => ({ type: 'string', enum: [...values], description }),
  date: (description: string): Schema => ({ type: 'string', description: `${description}，YYYY-MM-DD` }),
  time: (description: string): Schema => ({ type: 'string', description: `${description}，HH:MM（24 小时）` }),
  integers: (description: string): Schema => ({ type: 'array', items: { type: 'integer' }, description }),
};

// ---- 参数读取：缺省返回 undefined，类型不对抛 AiArgError ----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function present(args: AiArgs, key: string): boolean {
  return args[key] !== undefined && args[key] !== null;
}

function missing(key: string): AiArgError {
  return new AiArgError(`缺少参数 ${key}`);
}

export function optString(args: AiArgs, key: string): string | undefined {
  if (!present(args, key)) return undefined;
  const value = args[key];
  if (typeof value !== 'string') throw new AiArgError(`参数 ${key} 应为文本`);
  return value.trim();
}

export function reqString(args: AiArgs, key: string): string {
  const value = optString(args, key);
  if (value === undefined || value === '') throw missing(key);
  return value;
}

/** 可清空的文本：传空串或 null 表示清空，返回 null；未传返回 undefined。 */
export function clearableString(args: AiArgs, key: string): string | null | undefined {
  if (args[key] === undefined) return undefined;
  if (args[key] === null) return null;
  const value = optString(args, key);
  return value === undefined || value === '' ? null : value;
}

export function optInt(args: AiArgs, key: string, min?: number, max?: number): number | undefined {
  if (!present(args, key)) return undefined;
  const raw = args[key];
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new AiArgError(`参数 ${key} 应为整数`);
  if (min !== undefined && value < min) throw new AiArgError(`参数 ${key} 不能小于 ${min}`);
  if (max !== undefined && value > max) throw new AiArgError(`参数 ${key} 不能大于 ${max}`);
  return value;
}

export function reqInt(args: AiArgs, key: string, min?: number, max?: number): number {
  const value = optInt(args, key, min, max);
  if (value === undefined) throw missing(key);
  return value;
}

export function optBool(args: AiArgs, key: string): boolean | undefined {
  if (!present(args, key)) return undefined;
  const value = args[key];
  if (typeof value !== 'boolean') throw new AiArgError(`参数 ${key} 应为 true 或 false`);
  return value;
}

export function optDate(args: AiArgs, key: string): string | undefined {
  const value = optString(args, key);
  if (value === undefined || value === '') return undefined;
  if (!validDate(value)) throw new AiArgError(`参数 ${key} 应为有效日期 YYYY-MM-DD`);
  return value;
}

export function reqDate(args: AiArgs, key: string): string {
  const value = optDate(args, key);
  if (value === undefined) throw missing(key);
  return value;
}

export function optTime(args: AiArgs, key: string): string | undefined {
  const value = optString(args, key);
  if (value === undefined || value === '') return undefined;
  const padded = /^\d:\d{2}$/.test(value) ? `0${value}` : value;
  if (!TIME_RE.test(padded)) throw new AiArgError(`参数 ${key} 应为 HH:MM`);
  return padded;
}

export function optEnum<T extends string>(args: AiArgs, key: string, values: readonly T[]): T | undefined {
  const value = optString(args, key);
  if (value === undefined || value === '') return undefined;
  if (!(values as readonly string[]).includes(value)) throw new AiArgError(`参数 ${key} 只能是 ${values.join(' / ')}`);
  return value as T;
}

export function reqEnum<T extends string>(args: AiArgs, key: string, values: readonly T[]): T {
  const value = optEnum(args, key, values);
  if (value === undefined) throw missing(key);
  return value;
}

export function optInts(args: AiArgs, key: string, min: number, max: number): number[] | undefined {
  if (!present(args, key)) return undefined;
  const raw = args[key];
  if (!Array.isArray(raw)) throw new AiArgError(`参数 ${key} 应为整数数组`);
  const result = new Set<number>();
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < min || item > max) {
      throw new AiArgError(`参数 ${key} 里的值应为 ${min}-${max} 的整数`);
    }
    result.add(item);
  }
  return [...result].sort((left, right) => left - right);
}
