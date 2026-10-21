import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NATIVE_COMMANDS } from '../src/lib/native.ts';

/**
 * Tauri 命令名是跨语言手写同构：TS 侧拼错或 Rust 侧改名都不会编译报错，
 * 只会在运行时 invoke 失败。这里静态核对 `invoke_handler` 注册表。
 */
const TAURI_LIB_RS = new URL('../../desktop/src-tauri/src/lib.rs', import.meta.url);

test('Tauri 命令清单与 Rust invoke_handler 一一对应', () => {
  const source = readFileSync(fileURLToPath(TAURI_LIB_RS), 'utf8');
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  assert.ok(block !== null, 'lib.rs 缺少 invoke_handler / generate_handler');
  const rustCommands = (block[1] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.split('::').at(-1) ?? item);
  assert.deepEqual(rustCommands.toSorted(), [...NATIVE_COMMANDS].toSorted());
});
