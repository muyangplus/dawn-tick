import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkLogScopes,
  checkSource,
  compareScopeLists,
  findLogCalls,
  isSensitiveName,
  lexSource,
  parseAndroidScopes,
  parseRustScopes,
  parseWebScopes,
  resolveScope,
  SCOPE_SOURCES,
  sensitiveInLiteral,
  sensitiveNamesInCode,
  splitWords,
  stringConstants,
} from './check-log-scopes.mjs';

const SCOPES = ['app', 'storage', 'sync', 'widget', 'link'];

const WEB = `/** 说明 */
export const LOG_SCOPES = {
  app: '启动',
  // 注释里的 fake: 不算
  storage: '数据库',
  'sync': '同步',
} as const;
export type LogScope = keyof typeof LOG_SCOPES;`;

const RUST = `/// 清单
pub(crate) const LOG_SCOPES: &[&str] = &[
    "app", "storage", // 行尾注释 "ghost"
    "sync",
];`;

const KOTLIN = `object NativeLog {
    @JvmField
    val SCOPES: Set<String> = setOf(
        "app", "storage",
        "sync",
    )
    private val LEVELS = listOf("error", "warn")
}`;

// ---------------------------------------------------------------- 清单解析

test('三端清单解析：TS 对象键、Rust 数组、Kotlin setOf，跳过注释', () => {
  assert.deepEqual(parseWebScopes(WEB), ['app', 'storage', 'sync']);
  assert.deepEqual(parseRustScopes(RUST), ['app', 'storage', 'sync']);
  assert.deepEqual(parseAndroidScopes(KOTLIN), ['app', 'storage', 'sync']);
});

test('清单解析不到时返回 null', () => {
  assert.equal(parseWebScopes('export const OTHER = {};'), null);
  assert.equal(parseRustScopes('const LOG_LEVELS: &[&str] = &["info"];'), null);
  assert.equal(parseAndroidScopes('val LEVELS = listOf("info")'), null);
});

test('清单比对：一致时无问题', () => {
  assert.deepEqual(compareScopeLists({ web: ['a', 'b'], rust: ['b', 'a'], android: ['a', 'b'] }), []);
});

test('清单比对：列出缺少、多出与重复的范围', () => {
  const problems = compareScopeLists({
    web: ['app', 'storage', 'sync'],
    rust: ['app', 'storage', 'sync', 'legacy'],
    android: ['app', 'app', 'sync'],
  });
  assert.deepEqual(problems, [
    { platform: 'rust', missing: [], extra: ['legacy'], duplicates: [] },
    { platform: 'android', missing: ['storage'], extra: [], duplicates: ['app'] },
  ]);
});

test('清单比对：某端解析失败标为 missing=null', () => {
  const problems = compareScopeLists({ web: ['app'], rust: null, android: ['app'] });
  assert.deepEqual(problems, [{ platform: 'rust', missing: null, extra: [], duplicates: [] }]);
});

// ---------------------------------------------------------------- 词法与调用

test('词法：注释、普通串、原始串、字符字面量与生命周期', () => {
  const source = `fn a<'a>(x: &'a str) { let c = '"'; let r = r#"log_info("x")"#; /* /* 嵌套 */ log_warn("y") */ }`;
  const kinds = lexSource(source, 'rust').map((segment) => [segment.kind, source.slice(segment.start, segment.end)]);
  assert.ok(kinds.some(([kind, text]) => kind === 'string' && text === `'"'`), '字符字面量里的引号不开串');
  assert.ok(kinds.some(([kind, text]) => kind === 'string' && text === 'r#"log_info("x")"#'));
  assert.ok(kinds.some(([kind, text]) => kind === 'comment' && text === '/* /* 嵌套 */ log_warn("y") */'));
  assert.ok(kinds.some(([kind, text]) => kind === 'code' && text.includes("<'a>")), '生命周期按代码处理');
});

test('词法：Kotlin 模板里的嵌套串不提前结束字符串', () => {
  const source = 'val s = "a=${if (x) "是" else "否"} b"; val t = 1';
  const strings = lexSource(source, 'kotlin').filter((segment) => segment.kind === 'string');
  assert.deepEqual(
    strings.map((segment) => source.slice(segment.start, segment.end)),
    ['"a=${if (x) "是" else "否"} b"'],
  );
});

test('Rust：找出各级调用（含跨行与路径前缀），跳过定义、注释与字符串', () => {
  const source = `
pub(crate) fn log_warn(scope: &str, message: impl AsRef<str>) {
    log_at(LogLevel::Warn, scope, message.as_ref());
}
// log_error("ghost", "注释里")
fn run() {
    let text = "log_info(\\"ghost\\", 1)";
    log_error("storage", "坏了");
    crate::log_trace(
        "widget",
        format!("位置 {x},{y}", x = 1, y = 2),
    );
    log_at(LogLevel::Debug, "app", "调试");
}`;
  const calls = findLogCalls(source, 'rust');
  assert.deepEqual(
    calls.map((call) => [call.callee, call.level, call.line, call.forwarder]),
    [
      ['log_at', 'warn', 3, 'log_warn'],
      ['log_error', 'error', 8, null],
      ['log_trace', 'trace', 9, null],
      ['log_at', 'debug', 13, null],
    ],
  );
  const trace = calls[2];
  assert.equal(source.slice(trace.scope.start, trace.scope.end).trim(), '"widget"');
  assert.equal(trace.messages.length, 1, '格式化宏里的逗号不切实参');
});

test('Kotlin / Java：NativeLog 调用取第二个实参为范围', () => {
  const kotlin = `
NativeLog.warn(context, "widget", "读快照失败", error)
NativeLog
    .debug(
        context,
        SCOPE,
        "x=\${listOf(1, 2).size}",
    )`;
  const calls = findLogCalls(kotlin, 'kotlin');
  assert.deepEqual(
    calls.map((call) => [call.callee, call.line, kotlin.slice(call.scope.start, call.scope.end).trim(), call.messages.length]),
    [
      ['NativeLog.warn', 2, '"widget"', 2],
      ['NativeLog.debug', 3, 'SCOPE', 1],
    ],
  );
  const java = `NativeLog.error(getContext(), "link", "打不开 " + NativeLog.redactUrl(raw), e);`;
  assert.deepEqual(
    findLogCalls(java, 'java').map((call) => java.slice(call.scope.start, call.scope.end).trim()),
    ['"link"'],
  );
});

test('常量：Rust const、Kotlin const val / val、Java static final', () => {
  const constants = stringConstants(`
const SCOPE: &str = "sync";
private const val TAG_SCOPE = "widget"
val OTHER: String = "link"
private static final String JAVA_SCOPE = "app";
val TEMPLATE = "x$y"`);
  assert.equal(constants.get('SCOPE'), 'sync');
  assert.equal(constants.get('TAG_SCOPE'), 'widget');
  assert.equal(constants.get('OTHER'), 'link');
  assert.equal(constants.get('JAVA_SCOPE'), 'app');
  assert.equal(constants.has('TEMPLATE'), false, '带模板的串不是常量');
});

test('范围实参解析：字面量、常量、限定名与无法核对的表达式', () => {
  const constants = new Map([['SCOPE', 'sync']]);
  assert.deepEqual(resolveScope(' "widget" ', constants), { scope: 'widget' });
  assert.deepEqual(resolveScope('SCOPE', constants), { scope: 'sync' });
  assert.deepEqual(resolveScope('Companion.SCOPE', constants), { scope: 'sync' });
  assert.deepEqual(resolveScope('Self::SCOPE', constants), { scope: 'sync' });
  assert.deepEqual(resolveScope('scopeFor(kind)', constants), { unresolved: 'scopeFor(kind)' });
  assert.deepEqual(resolveScope('OTHER', constants), { unresolved: 'OTHER' });
});

test('checkSource：未登记范围与无法核对的范围分别报出，常量与日志函数内转调放行', () => {
  const rust = `
fn log_info(scope: &str, message: impl AsRef<str>) { log_at(LogLevel::Info, scope, message.as_ref()); }
const SCOPE: &str = "sync";
fn a(dynamic: &str) {
    log_info(SCOPE, "ok");
    log_warn("storage", "ok");
    log_warn(
        "probe",
        "未登记",
    );
    log_error(dynamic, "运行时决定的范围");
}`;
  const result = checkSource(rust, 'rust', { scopes: SCOPES });
  assert.equal(result.calls.length, 5);
  assert.deepEqual(result.unknown, [{ line: 7, callee: 'log_warn', scope: 'probe' }]);
  assert.deepEqual(result.unresolved, [{ line: 11, callee: 'log_error', text: 'dynamic' }]);
  assert.deepEqual(result.secrets, []);

  const kotlin = `class P {
    private fun diagWarn(message: String) { NativeLog.warn(context, SCOPE, message) }
    fun x() { NativeLog.info(context, "timetable", "未登记") }
    companion object { private const val SCOPE = "sync" }
}`;
  const android = checkSource(kotlin, 'kotlin', { scopes: SCOPES });
  assert.deepEqual(android.unknown, [{ line: 3, callee: 'NativeLog.info', scope: 'timetable' }]);
  assert.deepEqual(android.unresolved, []);
});

// ---------------------------------------------------------------- 敏感字段

test('拆词：camelCase、snake_case 与全大写', () => {
  assert.deepEqual(splitWords('accessToken'), ['access', 'token']);
  assert.deepEqual(splitWords('user_password'), ['user', 'password']);
  assert.deepEqual(splitWords('PIN_CODE'), ['pin', 'code']);
  assert.deepEqual(splitWords('HTTPCookie'), ['http', 'cookie']);
});

test('敏感标识符：按最后一个词判定，计数 / 长度 / 布尔判断不算', () => {
  for (const name of ['password', 'passwd', 'token', 'accessToken', 'pair_pin', 'pin', 'sessionCookie', 'clientSecret', 'authorization', 'PIN']) {
    assert.equal(isSensitiveName(name), true, name);
  }
  for (const name of ['pinLength', 'tokenCount', 'token_len', 'passwordHint', 'hasToken', 'isPin', 'pinned', 'spinner', 'tokens_used', 'secretary']) {
    assert.equal(isSensitiveName(name), false, name);
  }
  assert.equal(isSensitiveName('deviceToken', new Set(['devicetoken'])), false, '放行名单');
});

test('代码里的敏感标识符：取链的最后一节，越过 as_str 一类，脱敏函数内的不算', () => {
  assert.deepEqual(sensitiveNamesInCode('cred.password'), ['cred.password']);
  assert.deepEqual(sensitiveNamesInCode('password.len()'), []);
  assert.deepEqual(sensitiveNamesInCode('token.as_str()'), ['token.as_str']);
  assert.deepEqual(sensitiveNamesInCode('pin.length + tokenCount'), []);
  assert.deepEqual(sensitiveNamesInCode('redact_url(&token)'), []);
  assert.deepEqual(sensitiveNamesInCode('NativeLog.redactUrl(raw)'), []);
  assert.deepEqual(sensitiveNamesInCode('urlForLog(secret) + secret'), ['secret']);
});

test('字面量：键名紧跟待填值、Rust 内联占位、Kotlin 模板', () => {
  assert.deepEqual(sensitiveInLiteral('"token="', 'kotlin'), ['键名 token']);
  assert.deepEqual(sensitiveInLiteral('"配对 pin={}"', 'rust'), ['键名 pin']);
  assert.deepEqual(sensitiveInLiteral('"Authorization: $header"', 'kotlin'), ['键名 Authorization']);
  assert.deepEqual(sensitiveInLiteral('"登录 {password}"', 'rust'), ['插值 {password}']);
  assert.deepEqual(sensitiveInLiteral('"x={cred.password:?}"', 'rust'), ['插值 {cred.password}']);
  assert.deepEqual(sensitiveInLiteral('"x=$accessToken"', 'kotlin'), ['插值 ${accessToken}']);
  assert.deepEqual(sensitiveInLiteral('"x=${pair.pin}"', 'kotlin'), ['插值 ${pair.pin}']);
});

test('字面量：正文里的词、计数与转义花括号不算', () => {
  assert.deepEqual(sensitiveInLiteral('"PIN 不正确，请重新输入"', 'kotlin'), []);
  assert.deepEqual(sensitiveInLiteral('"WidgetPinPlugin.requestPin 已发起"', 'kotlin'), []);
  assert.deepEqual(sensitiveInLiteral('"pinLength={pin_length} tokenCount=$tokenCount"', 'rust'), []);
  assert.deepEqual(sensitiveInLiteral('"x=$tokenCount len=${pin.length}"', 'kotlin'), []);
  assert.deepEqual(sensitiveInLiteral('"{{token}}"', 'rust'), [], '{{ }} 是转义花括号');
  assert.deepEqual(sensitiveInLiteral('"token 已过期，重新配对"', 'rust'), []);
  assert.deepEqual(sensitiveInLiteral('"$token"', 'java'), [], 'Java 没有模板');
});

test('checkSource：消息里的敏感内容逐条报出，范围与上下文实参不扫', () => {
  const rust = `fn a(token: &str, pin_length: usize) {
    log_info("sync", format!("配对 pin_length={pin_length}"));
    log_warn("sync", format!("令牌 {}", token));
    log_debug("sync", format!("password={}", "***"));
}`;
  assert.deepEqual(checkSource(rust, 'rust', { scopes: SCOPES }).secrets, [
    { line: 3, callee: 'log_warn', reason: '实参 token' },
    { line: 4, callee: 'log_debug', reason: '键名 password' },
  ]);

  const kotlin = `fun b(secret: String) {
    NativeLog.info(context, "sync", "已保存 length=\${secret.length}")
    NativeLog.warn(context, "sync", "cookie=" + cookie, error)
    NativeLog.debug(
        context,
        "sync",
        "secret=\${redactSecret(secret)}",
    )
}`;
  assert.deepEqual(checkSource(kotlin, 'kotlin', { scopes: SCOPES }).secrets, [
    { line: 3, callee: 'NativeLog.warn', reason: '键名 cookie' },
    { line: 3, callee: 'NativeLog.warn', reason: '实参 cookie' },
  ]);
});

// ---------------------------------------------------------------- 全仓

function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'dt-log-scopes-'));
  for (const [rel, text] of Object.entries(files)) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

test('checkLogScopes：合成仓库里汇总清单差异、未登记范围与敏感字段', (t) => {
  const root = fixtureRepo({
    [SCOPE_SOURCES.web]: WEB,
    [SCOPE_SOURCES.rust]: RUST.replace('"sync",', '"sync", "legacy",'),
    [SCOPE_SOURCES.android]: KOTLIN,
    'apps/desktop/src-tauri/src/tray.rs': 'fn a() {\n    log_info("tray", "x");\n}\n',
    'apps/mobile/android/app/src/main/java/com/x/A.kt':
      'fun a() {\n    NativeLog.warn(context, "sync", "token=$token")\n}\n',
    'apps/mobile/android/app/src/main/java/com/x/B.java':
      'class B { void b() { NativeLog.info(getContext(), "app", "ok"); } }\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = checkLogScopes({ root });
  assert.deepEqual(result.lists.web, ['app', 'storage', 'sync']);
  assert.deepEqual(result.listProblems, [{ platform: 'rust', missing: [], extra: ['legacy'], duplicates: [] }]);
  assert.equal(result.files.length, 5, '含 NativeLog.kt 自身');
  assert.equal(result.calls, 3);
  assert.deepEqual(
    result.unknown.map((item) => [item.file.endsWith('tray.rs'), item.line, item.scope]),
    [[true, 2, 'tray']],
  );
  assert.deepEqual(
    result.secrets.map((item) => [item.file.endsWith('A.kt'), item.reason]),
    [
      [true, '键名 token'],
      [true, '插值 ${token}'],
    ],
  );
});

test('仓库内三端日志范围一致，原生日志调用范围均已登记且无敏感字段', () => {
  const { lists, listProblems, files, calls, unknown, unresolved, secrets } = checkLogScopes();
  assert.ok(lists.web !== null && lists.web.length > 0, '应解析到 Web 清单');
  assert.deepEqual(listProblems, []);
  assert.ok(files.some((file) => file.endsWith('.rs')), '应扫描到 Rust 源文件');
  assert.ok(files.some((file) => file.endsWith('.kt')), '应扫描到 Kotlin 源文件');
  assert.ok(calls > 0, '应找到日志调用');
  assert.deepEqual(unknown, []);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(secrets, []);
});
