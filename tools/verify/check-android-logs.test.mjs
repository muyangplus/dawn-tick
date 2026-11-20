import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AREAS,
  bracePairs,
  checkAndroidLogs,
  checkSource,
  DELEGATED,
  enclosingFunction,
  findExceptionMessages,
  forbiddenInExpression,
  functionRanges,
  innermostBlock,
  maskSource,
  PACKAGE_DIR,
  templateExpressions,
} from './check-android-logs.mjs';
import { lexSource, SCOPE_SOURCES } from './check-log-scopes.mjs';

const SCOPES = ['app', 'reminder', 'credentials', 'update', 'backup'];
const opts = (extra = {}) => ({ scope: 'reminder', scopes: SCOPES, ...extra });

// ---------------------------------------------------------------- 结构

test('遮罩：字符串与注释换成空白，模板里的花括号不参与配对', () => {
  const source = 'fun a() { val s = "x=${b { 1 }}" /* { */ }';
  const masked = maskSource(source, lexSource(source, 'kotlin'));
  assert.equal(masked.length, source.length);
  assert.deepEqual(
    bracePairs(masked).map((pair) => [pair.open, pair.close]),
    [[8, source.length - 1]],
  );
});

test('最内层块与所属函数：块体、表达式体与嵌套 lambda', () => {
  const source = `object V {
    fun cause(): Exception? = try {
        null
    } catch (error: Exception) {
        error
    }
    fun run(items: List<Int>) {
        items.forEach { item ->
            mark(item)
        }
    }
}`;
  const masked = maskSource(source, lexSource(source, 'kotlin'));
  const pairs = bracePairs(masked);
  const ranges = functionRanges(masked, pairs);
  assert.equal(enclosingFunction(ranges, source.indexOf('error\n')), 'cause');
  const markAt = source.indexOf('mark(');
  assert.equal(enclosingFunction(ranges, markAt), 'run');
  const block = innermostBlock(pairs, markAt);
  assert.equal(masked.slice(block.open, block.open + 9), '{ item ->');
});

// ---------------------------------------------------------------- 规则 1：失败分支

test('catch：块里直接有 warn / error 通过；只在嵌套分支里、只有 info 或没有日志的报出', () => {
  const source = `class P {
    fun a() {
        try { x() } catch (error: SecurityException) {
            NativeLog.warn(context, SCOPE, "被拒 id=$id", error)
        }
        try { x() } catch (error: ActivityNotFoundException) {
            if (retry) {
                NativeLog.error(context, SCOPE, "没有应用", error)
            }
        }
        try { x() } catch (error: Exception) {
            NativeLog.info(context, SCOPE, "失败")
        }
        try { x() } catch (_: IllegalStateException) {
            // 什么都不做
        }
    }
    companion object { const val SCOPE = "reminder" }
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(result.unlogged, [
    { line: 6, site: 'a#catch(ActivityNotFoundException)' },
    { line: 11, site: 'a#catch(Exception)' },
    { line: 14, site: 'a#catch(IllegalStateException)' },
  ]);
  assert.equal(result.sites.length, 4);
});

test('catch：后面兄弟块里的 warn 不算本块的', () => {
  const source = `fun a() {
    try { x() } catch (error: LocalFileException) {
        fallback()
    }
    if (bad) { NativeLog.warn(context, "reminder", "坏了") }
}`;
  assert.deepEqual(checkSource(source, opts()).unlogged, [{ line: 2, site: 'a#catch(LocalFileException)' }]);
});

test('call.reject：同块有 warn 通过；没有的按「函数#reject(资源名)」报出', () => {
  const source = `class P : Plugin() {
    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getLong("id")
        if (id == null) {
            NativeLog.warn(context, SCOPE, "缺少参数 id")
            call.reject(context.getString(R.string.reminder_missing_id))
            return
        }
        if (!startSend(uri)) {
            call.reject(context.getString(R.string.share_no_app))
            return
        }
        if (busy) {
            call.reject("busy")
        }
    }
    private companion object { const val SCOPE = "reminder" }
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(result.unlogged, [
    { line: 11, site: 'cancel#reject(R.string.share_no_app)' },
    { line: 15, site: 'cancel#reject("busy")' },
  ]);
});

test('call.reject 在带 warn 的 catch 块里通过；登记的 site 放行并记为已用', () => {
  const source = `fun encrypt(call: PluginCall) {
    try {
        call.resolve(work())
    } catch (error: Exception) {
        NativeLog.warn(context, "credentials", "加密失败 cause=\${error.javaClass.simpleName}")
        call.reject(context.getString(R.string.secret_encrypt_failed, error.javaClass.simpleName))
    }
    if (!startSend(uri)) {
        call.reject(context.getString(R.string.share_no_app))
    }
}`;
  const allowSites = new Set(['encrypt#reject(R.string.share_no_app)', 'encrypt#reject(R.string.unused)']);
  const result = checkSource(source, opts({ scope: 'credentials', allowSites }));
  assert.deepEqual(result.unlogged, []);
  assert.deepEqual([...result.usedSites], ['encrypt#reject(R.string.share_no_app)']);
});

test('注释与字符串里的 catch / call.reject 不算', () => {
  const source = `fun a() {
    // try { } catch (e: Exception) { }
    val hint = "call.reject(x) 之后 catch (e: Exception) {"
    /* call.reject("缺少 id") */
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(result.sites, []);
  assert.deepEqual(result.cjk, []);
});

// ---------------------------------------------------------------- 规则 2：范围

test('范围：常量与字面量都解析；与区域约定不符、未登记、无法核对的分别报出', () => {
  const source = `object A {
    private const val SCOPE = "reminder"
    fun a(dynamic: String) {
        NativeLog.debug(context, SCOPE, "ok")
        NativeLog.info(context, "reminder", "ok")
        NativeLog.info(context, "backup", "区域不对")
        NativeLog.warn(context, "probe", "未登记")
        NativeLog.warn(context, dynamic, "动态范围")
    }
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(
    result.scopeProblems.map((item) => [item.line, item.problem]),
    [
      [6, '范围 "backup"，本区域应为 "reminder"'],
      [7, '范围 "probe" 不在 NativeLog.SCOPES'],
      [7, '范围 "probe"，本区域应为 "reminder"'],
      [8, '范围 dynamic 不是字面量或同文件常量'],
    ],
  );
});

// ---------------------------------------------------------------- 规则 3：敏感值

test('模板表达式：${expr} 与 $name，转义的 \\$ 跳过；Java 没有模板', () => {
  assert.deepEqual(templateExpressions('"a=$a b=${b.c} c=${if (x) "是" else "否"} \\$d"', 'kotlin'), [
    'a',
    'b.c',
    'if (x) "是" else "否"',
  ]);
  assert.deepEqual(templateExpressions('"$a"', 'java'), []);
});

test('表达式：按链尾判定，越过 trim 一类；名字、编号、长度、判空不算', () => {
  for (const [expr, hits] of [
    ['value', ['value']],
    ['record.title', ['record.title']],
    ['record', ['record']],
    ['file.path', ['file.path']],
    ['file.file', ['file.file']],
    ['file.file.absolutePath', ['file.file.absolutePath']],
    ['value.trim()', ['value.trim']],
    ['plain.take(4)', ['plain.take']],
    ['encode(ciphertext)', ['ciphertext']],
    ['uri', ['uri']],
  ]) {
    assert.deepEqual(forbiddenInExpression(expr), hits, expr);
  }
  for (const expr of [
    'file.file.name',
    'name',
    'record.id',
    'record.kind',
    'value.length',
    'title != null',
    'null == body',
    'records.size',
    'intent.action',
    'error.javaClass.simpleName',
    'error.message',
  ]) {
    assert.deepEqual(forbiddenInExpression(expr), [], expr);
  }
});

test('credentials：异常 message 也算敏感', () => {
  assert.deepEqual(forbiddenInExpression('error.message', { credentials: true }), ['error.message']);
  assert.deepEqual(forbiddenInExpression('error.localizedMessage', { credentials: true }), ['error.localizedMessage']);
  assert.deepEqual(forbiddenInExpression('error.javaClass.simpleName', { credentials: true }), []);
});

test('日志消息：插值与拼接的敏感值报出，正文里的同名词、上下文实参与异常实参不扫', () => {
  const source = `object S {
    private const val SCOPE = "reminder"
    fun a(record: ReminderRecord, file: LocalFile, value: String) {
        NativeLog.warn(context, SCOPE, "缺少参数 value title body")
        NativeLog.info(context, SCOPE, "已排定 id=\${record.id} hasTitle=\${record.title != null}")
        NativeLog.info(context, SCOPE, "已展示 \${record.title}")
        NativeLog.debug(context, SCOPE, "正文 $value")
        NativeLog.warn(context, SCOPE, "路径 " + file.file.absolutePath, error)
        NativeLog.info(context, SCOPE, "name=\${file.file.name} mime=\${resolve(name, "x")}")
        NativeLog.debug(
            context,
            SCOPE,
            "跨行 record=$record",
        )
    }
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(
    result.forbidden.map((item) => [item.line, item.reason]),
    [
      [6, '插值 record.title'],
      [7, '插值 value'],
      [8, '拼接 file.file.absolutePath'],
      [10, '插值 record'],
    ],
  );
});

test('credentials 范围：不带异常对象，不取 message；其他范围带异常对象照常', () => {
  const source = `class P {
    fun a(error: Exception) {
        NativeLog.warn(context, SCOPE, "加密失败 cause=\${error.javaClass.simpleName}")
        NativeLog.warn(context, SCOPE, "解密失败", error)
        NativeLog.warn(context, SCOPE, "解密失败 \${error.message}")
    }
    private companion object { const val SCOPE = "credentials" }
}`;
  assert.deepEqual(
    checkSource(source, opts({ scope: 'credentials' })).forbidden.map((item) => [item.line, item.reason]),
    [
      [4, '带了异常对象（会附上 message），只记类名'],
      [5, '插值 error.message'],
    ],
  );
  const update = source.replace('"credentials"', '"update"').replace(/\$\{error\.message\}/, '');
  assert.deepEqual(checkSource(update, opts({ scope: 'update' })).forbidden, []);
});

// ---------------------------------------------------------------- 规则 4：reject 文案

test('call.reject：中文字面量报出，资源取值、英文、注释与 error.message 不报', () => {
  const source = `fun a(call: PluginCall) {
    NativeLog.warn(context, "reminder", "失败")
    call.reject("缺少 id")
    call.reject(
        context.getString(R.string.reminder_missing_id), // 缺少 id
    )
    call.reject("missing id")
    call.reject(error.message ?: context.getString(R.string.file_path_invalid), error)
    call.reject("\${name}：打不开")
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(result.cjk, [
    { line: 3, text: '"缺少 id"' },
    { line: 9, text: '"${name}：打不开"' },
  ]);
  assert.deepEqual(result.unlogged, [], '同一个函数块里已有 warn');
});

test('异常消息：旧 SecretVault.decrypt 的 require 中文消息报出', () => {
  const source = `internal object SecretVault {
    fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > IV_BYTES) { "密文长度不对" }
        return String(combined)
    }
}`;
  const result = checkSource(source, opts({ scope: 'credentials' }));
  assert.deepEqual(result.exceptionCjk, [{ line: 4, kind: 'require', text: '"密文长度不对"' }]);
  assert.deepEqual(result.cjk, [], 'call.reject 规则本身不覆盖这里');
  const fixed = source.replace('"密文长度不对"', '"ciphertext shorter than IV"');
  assert.deepEqual(checkSource(fixed, opts({ scope: 'credentials' })).exceptionCjk, []);
});

test('异常消息：require / check / requireNotNull / checkNotNull / error / throw 的中文字面量报出', () => {
  const source = `fun a(id: String?, size: Int) {
    check(size > 0) { "大小为 0" }
    val v = requireNotNull(id) { "缺少 \${size}" }
    checkNotNull(id) {
        "未初始化"
    }
    if (size > 9) error("太大")
    if (size > 8) return error("也太大")
    throw IllegalStateException("状态不对")
    throw java.io.IOException("读不到 $size", cause)
    throw new IllegalArgumentException("Java 写法")
}`;
  const result = checkSource(source, opts());
  assert.deepEqual(
    result.exceptionCjk.map((item) => [item.line, item.kind, item.text]),
    [
      [2, 'check', '"大小为 0"'],
      [3, 'requireNotNull', '"缺少 \${size}"'],
      [5, 'checkNotNull', '"未初始化"'],
      [7, 'error', '"太大"'],
      [8, 'error', '"也太大"'],
      [9, 'throw IllegalStateException', '"状态不对"'],
      [10, 'throw IOException', '"读不到 $size"'],
      [11, 'throw IllegalArgumentException', '"Java 写法"'],
    ],
  );
});

test('异常消息：英文、注释、NativeLog 消息、无 lambda 的 require、方法调用与声明不报', () => {
  const source = `fun a(id: String?, call: PluginCall) {
    require(id != null) { "missing id" } // 缺少 id
    require(id.isNotEmpty())
    check(id.length < 9) {
        NativeLog.warn(context, "reminder", "id 过长")
        "id too long"
    }
    /* throw IllegalStateException("注释里") */
    val text = "require(x) { \"字符串里\" }"
    validator.check(id) { "接收者上的方法" }
    Result::error
    throw IllegalStateException(context.getString(R.string.reminder_missing_id))
    throw error
    catch (error: Exception) { NativeLog.warn(context, "reminder", "失败 \${error.javaClass.simpleName}") }
}
fun error(message: String): Nothing = throw IllegalStateException(message)
fun check(flag: Boolean) { }`;
  const result = checkSource(source, opts());
  assert.deepEqual(result.exceptionCjk, []);
  const masked = maskSource(source, lexSource(source, 'kotlin'));
  const kinds = findExceptionMessages(masked, bracePairs(masked)).map((item) => item.kind);
  assert.deepEqual(
    kinds,
    ['require', 'check', 'throw IllegalStateException', 'throw IllegalStateException'],
    '无 lambda 的 require、接收者上的方法、函数引用、throw 变量与 fun 声明都不收',
  );
});

// ---------------------------------------------------------------- 全仓

const NATIVE_LOG = `object NativeLog {
    val SCOPES: Set<String> = setOf("app", "reminder", "credentials", "update", "backup")
}`;

function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'dt-android-logs-'));
  for (const [rel, text] of Object.entries(files)) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

test('checkAndroidLogs：缺失区域、未记日志、委托核对与失效登记', (t) => {
  const pkg = (rel) => `${PACKAGE_DIR}/${rel}`;
  const root = fixtureRepo({
    [SCOPE_SOURCES.android]: NATIVE_LOG,
    [pkg('share/FileSharePlugin.kt')]: `class F {
    fun shareFile(call: PluginCall) {
        if (!startSend()) {
            call.reject(context.getString(R.string.share_no_app))
        }
        if (!startQuiet()) {
            call.reject(context.getString(R.string.quiet))
        }
    }
    private fun startSend(): Boolean = try { go(); true } catch (error: ActivityNotFoundException) {
        NativeLog.warn(context, SCOPE, "没有应用", error)
        false
    }
    private fun startQuiet(): Boolean { return false }
    companion object { private const val SCOPE = "backup" }
}`,
    [pkg('reminder/A.kt')]: `object A {
    fun a() {
        try { x() } catch (error: Exception) { }
    }
}`,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const delegated = [
    { file: 'share/FileSharePlugin.kt', site: 'shareFile#reject(R.string.share_no_app)', delegate: 'share/FileSharePlugin.kt#startSend', reason: '' },
    { file: 'share/FileSharePlugin.kt', site: 'shareFile#reject(R.string.quiet)', delegate: 'share/FileSharePlugin.kt#startQuiet', reason: '' },
    { file: 'share/FileSharePlugin.kt', site: 'shareFile#reject(R.string.gone)', delegate: null, reason: '' },
  ];
  const result = checkAndroidLogs({ root, areas: AREAS, delegated });
  assert.deepEqual(result.missingAreas, ['secret/', 'install/ApkInstallerPlugin.kt']);
  assert.deepEqual(result.files, ['reminder/A.kt', 'share/FileSharePlugin.kt']);
  assert.deepEqual(
    result.unlogged.map((item) => [item.file, item.site]),
    [['reminder/A.kt', 'a#catch(Exception)']],
  );
  assert.deepEqual(
    result.badDelegates.map((item) => [item.site, item.problem]),
    [['shareFile#reject(R.string.quiet)', '函数里没有 NativeLog.warn / error']],
  );
  assert.deepEqual(
    result.stale.map((item) => item.site),
    ['shareFile#reject(R.string.gone)'],
  );
});

test('DELEGATED 每条都写了原因，委托指向 文件#函数 或 null', () => {
  for (const entry of DELEGATED) {
    assert.ok(entry.reason.length > 0, entry.site);
    assert.match(entry.site, /^\w+#(?:catch|reject)\(.+\)$/);
    assert.ok(entry.delegate === null || /^[\w/]+\.(?:kt|java)#\w+$/.test(entry.delegate), entry.site);
  }
});

test('仓库内提醒、密钥库、安装、分享四块的失败分支日志符合约定', () => {
  const result = checkAndroidLogs();
  const problems = [
    ...result.missingAreas,
    ...result.unlogged.map((item) => `${item.file}:${item.line} ${item.site}`),
    ...result.scopeProblems.map((item) => `${item.file}:${item.line} ${item.problem}`),
    ...result.forbidden.map((item) => `${item.file}:${item.line} ${item.reason}`),
    ...result.cjk.map((item) => `${item.file}:${item.line} ${item.text}`),
    ...result.exceptionCjk.map((item) => `${item.file}:${item.line} ${item.kind} ${item.text}`),
    ...result.badDelegates.map((item) => `${item.site} ${item.problem}`),
    ...result.stale.map((item) => `${item.site} 已失效`),
  ];
  assert.deepEqual(problems, []);
  assert.ok(result.files.length >= 10);
  assert.ok(result.sites > 0 && result.calls > 0);
});
