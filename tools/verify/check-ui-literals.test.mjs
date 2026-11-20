import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ALLOW,
  allowedBy,
  checkSource,
  checkUiLiterals,
  filesToScan,
  hasCjk,
  isLogOption,
  scanSource,
  WEB_SRC,
} from './check-ui-literals.mjs';

/** 只看含中文的字面量：`[kind, text]`。 */
function cjkLiterals(source, options) {
  return scanSource(source, options)
    .literals.filter((literal) => hasCjk(literal.text))
    .map((literal) => [literal.kind, literal.text.trim()]);
}

function hitTexts(source, options) {
  return checkSource(source, options).hits.map((hit) => [hit.line, hit.kind, hit.text]);
}

// ---------------------------------------------------------------- 字符判定

test('hasCjk：汉字、CJK 标点与全角符号算，ASCII 与 emoji 不算', () => {
  assert.equal(hasCjk('课表'), true);
  assert.equal(hasCjk('、'), true);
  assert.equal(hasCjk('（'), true);
  assert.equal(hasCjk('：'), true);
  assert.equal(hasCjk('Wi-Fi 8765 · –'), false);
  assert.equal(hasCjk('✓ 🎉'), false);
});

// ---------------------------------------------------------------- 词法

test('字符串、模板静态段、JSX 文本与 JSX 属性都能认出', () => {
  const source = `
export function A({ n }: { n: number }) {
  const title = '标题';
  const line = \`共 \${n} 条\`;
  return (
    <section aria-label="分组" title={'属性表达式'}>
      <h2>{title}</h2>
      正文文本
      <Button label='单引号属性'>按钮</Button>
    </section>
  );
}`;
  assert.deepEqual(cjkLiterals(source), [
    ['string', "'标题'"],
    ['template', '共'],
    ['template', '条'],
    ['jsx-attr', '"分组"'],
    ['string', "'属性表达式'"],
    ['jsx-text', '正文文本'],
    ['jsx-attr', "'单引号属性'"],
    ['jsx-text', '按钮'],
  ]);
});

test('注释不算：行注释、块注释与 JSX 里的 {/* */}', () => {
  const source = `
// 行注释
/** 文档注释 */
export const A = () => (
  <div>
    {/* JSX 注释 */}
    <span>x</span>
  </div>
);`;
  const { literals, comments } = scanSource(source);
  assert.deepEqual(literals.filter((literal) => hasCjk(literal.text)), []);
  assert.equal(comments.length, 3);
});

test('JSX 文本里的引号、斜杠与 // 不会被当成字符串或注释', () => {
  const source = `const A = () => <p>Don't 打开 https://example.com 后 "确认"</p>;
const after = '之后的字符串';`;
  assert.deepEqual(cjkLiterals(source), [
    ['jsx-text', 'Don\'t 打开 https://example.com 后 "确认"'],
    ['string', "'之后的字符串'"],
  ]);
});

test('正则字面量与除号：正则里的引号不打乱后续词法', () => {
  const source = `const re = /['"]/g;
const half = total / 2 / count;
const label = '中文';`;
  assert.deepEqual(cjkLiterals(source), [['string', "'中文'"]]);
});

test('模板嵌套：${} 里的字符串与再下一层模板都能认出', () => {
  const source = 'const a = `外层${flag ? \'是\' : `内层${n}个`}结尾`;';
  assert.deepEqual(cjkLiterals(source), [
    ['template', '外层'],
    ['string', "'是'"],
    ['template', '内层'],
    ['template', '个'],
    ['template', '结尾'],
  ]);
});

test('泛型与比较不当成 JSX：useState<string>、a < b、<T,>(x: T) => x', () => {
  const source = `const [v] = useState<string>('初值');
if (a < b && c > d) x = '比较之后';
const id = <T,>(x: T) => x;
const tail = '泛型之后';`;
  assert.deepEqual(cjkLiterals(source), [
    ['string', "'初值'"],
    ['string', "'比较之后'"],
    ['string', "'泛型之后'"],
  ]);
});

test('.ts 文件不认 JSX：<Type>value 断言按代码处理', () => {
  const source = `const n = <number>raw;
const label = '标签';`;
  assert.deepEqual(cjkLiterals(source, { jsx: false }), [['string', "'标签'"]]);
});

test('片段 <>…</> 与嵌套元素、属性里的箭头函数与 > 比较', () => {
  const source = `const A = () => (
  <>
    <Row onClick={() => count > 1 && go('点击')} />
    <Row>{list.map((item) => <Cell key={item}>单元</Cell>)}</Row>
  </>
);`;
  assert.deepEqual(cjkLiterals(source), [
    ['string', "'点击'"],
    ['jsx-text', '单元'],
  ]);
});

test('字面量带外层调用与顶层声明名', () => {
  const source = `const TABLE = { a: ['甲'] };
function View() {
  return wrap(fn('乙'));
}`;
  const literals = scanSource(source).literals.filter((literal) => hasCjk(literal.text));
  assert.deepEqual(
    literals.map((literal) => [literal.text, literal.decl, literal.calls]),
    [
      ["'甲'", 'TABLE', []],
      ["'乙'", 'View', ['fn', 'wrap']],
    ],
  );
});

// ---------------------------------------------------------------- 判定

test('日志调用实参放行，含嵌套对象与模板；同一行的界面文案照报', () => {
  const source = `logWarn('sync', '拉取失败', { reason: \`对方 \${host} 无响应\` });
logError('app', describe('嵌套调用'));
toast.error('界面提示');`;
  const result = checkSource(source);
  assert.equal(result.logged, 4);
  assert.deepEqual(
    result.hits.map((hit) => hit.text),
    ["'界面提示'"],
  );
});

test('log: 选项的值按日志放行，其它键照报', () => {
  const source = `await run({
  label: '正在保存…',
  log: '保存失败',
  catalog: '目录',
});`;
  assert.deepEqual(hitTexts(source), [
    [2, 'string', "'正在保存…'"],
    [4, 'string', "'目录'"],
  ]);
  const at = (text) => text.lastIndexOf("'");
  assert.equal(isLogOption("x = { log: '", at("x = { log: '")), true);
  assert.equal(isLogOption("x = { catalog: '", at("x = { catalog: '")), false);
  assert.equal(isLogOption("x = { a.log: '", at("x = { a.log: '")), false);
});

test('放行清单：按文件或文件内的顶层声明名匹配', () => {
  const allow = [
    { file: 'a.ts', name: 'KEYWORDS', reason: '测试' },
    { file: 'b.tsx', reason: '整份文件' },
  ];
  const source = `export const KEYWORDS = ['星期'];
export const LABEL = '标题';`;
  const result = checkSource(source, { file: 'a.ts', jsx: false, allow });
  assert.equal(result.allowed, 1);
  assert.deepEqual(result.hits.map((hit) => [hit.decl, hit.text]), [['LABEL', "'标题'"]]);
  assert.equal(checkSource(source, { file: 'b.tsx', allow }).hits.length, 0);
  assert.equal(allowedBy('c.tsx', { decl: 'KEYWORDS' }, allow), null);
});

test('命中带行号与种类', () => {
  const source = `export const A = () => (
  <div title="提示">
    正文
  </div>
);`;
  assert.deepEqual(hitTexts(source), [
    [2, 'jsx-attr', '"提示"'],
    [3, 'jsx-text', '正文'],
  ]);
});

// ---------------------------------------------------------------- 全仓

function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'dt-ui-literals-'));
  for (const [rel, text] of Object.entries(files)) {
    const file = join(root, WEB_SRC, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

test('filesToScan：tsx 全扫（copy/ 除外），ts 只扫 screens/ 与 components/', (t) => {
  const root = fixtureRepo({
    'App.tsx': '',
    'copy/home.ts': '',
    'copy/widget.tsx': '',
    'lib/util.ts': '',
    'screens/model.ts': '',
    'screens/types.d.ts': '',
    'components/ui/button.tsx': '',
    'components/form-model.ts': '',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(filesToScan(join(root, WEB_SRC)), [
    'App.tsx',
    'components/form-model.ts',
    'components/ui/button.tsx',
    'screens/model.ts',
  ]);
});

test('checkUiLiterals：合成仓库里汇总命中，并报出用不上的放行条目', (t) => {
  const root = fixtureRepo({
    'App.tsx': "export const App = () => <p>欢迎</p>;\n",
    'copy/home.ts': "export const homeCopy = { title: '首页' };\n",
    'lib/net.ts': "export const reason = '网络不可达';\n",
    'screens/model.ts': "logInfo('app', '日志');\nexport const TAGS = ['标签'];\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const allow = [
    { file: 'screens/model.ts', name: 'TAGS', reason: '数据匹配' },
    { file: 'screens/gone.ts', reason: '已删除的文件' },
  ];
  const result = checkUiLiterals({ root, allow });
  assert.deepEqual(result.files, ['App.tsx', 'screens/model.ts']);
  assert.deepEqual(
    result.hits.map((hit) => [hit.file, hit.line, hit.kind, hit.text]),
    [['App.tsx', 1, 'jsx-text', '欢迎']],
  );
  assert.equal(result.logged, 1);
  assert.equal(result.allowed, 1);
  assert.deepEqual(result.staleAllow, [allow[1]]);
});

test('仓库内界面源文件没有散落的中文字面量，放行条目都有原因且仍在用', () => {
  const { files, hits, staleAllow } = checkUiLiterals();
  assert.ok(files.some((file) => file.endsWith('.tsx')), '应扫描到 tsx 源文件');
  assert.ok(files.some((file) => file.startsWith('screens/') && file.endsWith('.ts')), '应扫描到 screens/ 下的 ts');
  assert.ok(!files.some((file) => file.startsWith('copy/')), 'copy/ 不扫');
  assert.deepEqual(
    hits.map((hit) => `${hit.file}:${hit.line} ${hit.text}`),
    [],
  );
  assert.deepEqual(staleAllow, []);
  assert.ok(ALLOW.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0));
});
