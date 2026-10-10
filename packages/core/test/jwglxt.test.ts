import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptPassword,
  fetchTimetable,
  hexToBase64,
  jwglxtUrls,
  normalizeBaseUrl,
  parseLoginForm,
  parsePublicKey,
  parseTimetable,
  rsaEncryptHex,
  toHexKey,
  type JwglxtFetchResponse,
  type JwglxtLogEntry,
} from '../src/import/jwglxt.ts';

test('教务地址归一化', () => {
  assert.equal(normalizeBaseUrl('https://jw.example.edu.cn'), 'https://jw.example.edu.cn');
  assert.equal(normalizeBaseUrl('jw.example.edu.cn/'), 'https://jw.example.edu.cn');
  assert.equal(
    normalizeBaseUrl('https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html'),
    'https://jw.example.edu.cn',
  );
  assert.equal(normalizeBaseUrl('http://10.0.0.8:8080/jwglxt'), 'http://10.0.0.8:8080');
  assert.throws(() => normalizeBaseUrl('   '), /不能为空/);
});

test('端点拼接带学期参数', () => {
  const urls = jwglxtUrls('jw.example.edu.cn', { xnm: '2026', xqm: '3' });
  assert.equal(urls.login, 'https://jw.example.edu.cn/jwglxt/xtgl/login_slogin.html');
  assert.equal(urls.publicKey, 'https://jw.example.edu.cn/jwglxt/xtgl/login_getPublicKey.html');
  assert.ok(urls.timetable.includes('/jwglxt/xskb/xskb_list.do?gnmkdm=N253508'));
  assert.ok(urls.timetable.includes('xnm=2026'));
});

test('登录表单字段提取', () => {
  const html = `
    <form id="loginForm" method="post">
      <input type="hidden" name="csrftoken" value="abc123">
      <input type="hidden" name="language" value="zh_CN"/>
      <input name="yhm" type="text" value="">
    </form>`;
  const fields = parseLoginForm(html);
  assert.equal(fields['csrftoken'], 'abc123');
  assert.equal(fields['language'], 'zh_CN');
  assert.equal(fields['yhm'], '');
});

test('公钥解析', () => {
  const key = parsePublicKey('{"modulus":"a1b2","exponent":"010001"}');
  assert.equal(key.modulus, 'a1b2');
  assert.equal(key.exponent, '010001');
  assert.throws(() => parsePublicKey('{"modulus":"a1b2"}'), /公钥格式不正确/);
});

test('公钥编码兼容十六进制、Base64 与前缀写法', () => {
  assert.equal(toHexKey('010001'), '010001');
  assert.equal(toHexKey('0x010001'), '010001');
  assert.equal(toHexKey('AQAB'), '010001');
  assert.equal(toHexKey('AQAB', '公钥指数'), '010001');
  assert.throws(() => toHexKey('not*valid', '公钥模数'), /格式无法识别/);
  assert.throws(() => toHexKey('   '), /为空/);
});

test('Base64 模数可解析并加密（真实教务返回）', () => {
  const modulus =
    'ANacTWk/2veUNxVmmP/C1LUWzeySVtc8f6AlAQv/pR4/iaF1EYazATex0zKv1jaEjNovnpvEdogNxImtXvzuXS60yTYgypcJyefKK2c/teDHHptU1N99heXdQ75QrRN+iQX5jFDhXSc1sCx+A/5sGV23mDiWHkdrhyFj';
  const key = parsePublicKey(JSON.stringify({ modulus, exponent: '010001' }));
  assert.equal(key.modulus.length, 246, `Base64 解码应为 123 字节，实际 ${key.modulus.length / 2}`);
  assert.match(key.modulus, /^[0-9a-f]+$/);
  assert.equal(key.modulus.slice(0, 2), '00', '保留原始前导零字节');
  assert.equal(key.exponent, '010001');

  const ascii = encryptPassword(key.modulus, key.exponent, 'password123', 'hex-ascii');
  const binary = encryptPassword(key.modulus, key.exponent, 'password123', 'hex-binary');
  assert.equal(ascii.length, 328, '246 位十六进制 ASCII 的 Base64 长度');
  assert.equal(binary.length, 164, '123 字节密文的 Base64 长度');
  assert.notEqual(ascii, binary);
  assert.equal(encryptPassword(modulus, 'AQAB', 'password123', 'hex-ascii'), ascii, 'Base64 与十六进制入口结果一致');
});

test('RSA 加密与 Base64 转换', () => {
  // n = 0xCA1 = 3233，e = 0x11 = 17，明文 'A' = 65 → 65^17 mod 3233 = 2790
  assert.equal(rsaEncryptHex('CA1', '11', 'A'), 'ae6');
  assert.equal(hexToBase64('ae6'), 'CuY=');
  assert.equal(encryptPassword('CA1', '11', 'A', 'hex-binary'), 'CuY=');
  assert.equal(encryptPassword('CA1', '11', 'A', 'hex-ascii'), 'YWU2');
});

const GRID_HTML = `
<table id="kbgrid_table_0">
  <tr>
    <td id="1-1"><div class="timetable_con"><span class="title">高等数学</span><p>张老师</p><p>教三-201</p><p>1-16周</p></div></td>
    <td id="3-1"><div class="timetable_con"><span class="title">大学物理</span><p>李老师</p><p>理科楼-105</p><p>2-16周(双)</p></div></td>
  </tr>
  <tr>
    <td id="1-2"><div class="timetable_con"><span class="title">高等数学</span><p>张老师</p><p>教三-201</p><p>1-16周</p></div></td>
    <td id="5-3"><div class="timetable_con"><span class="title">体育</span><p>1,3,5周</p></div></td>
  </tr>
</table>`;

test('课表页解析与连堂合并', () => {
  const { schedules, warnings } = parseTimetable(GRID_HTML, { totalWeeks: 20 });
  assert.deepEqual(warnings, []);

  const math = schedules.find((item) => item.courseName === '高等数学');
  assert.equal(math?.dayOfWeek, 1);
  assert.equal(math?.periodStart, 1);
  assert.equal(math?.periodEnd, 2);
  assert.equal(math?.room, '教三-201');
  assert.equal(math?.teacher, '张老师');
  assert.equal(math?.weeks.length, 16);

  const physics = schedules.find((item) => item.courseName === '大学物理');
  assert.equal(physics?.dayOfWeek, 3);
  assert.deepEqual(physics?.weeks, [2, 4, 6, 8, 10, 12, 14, 16]);

  const sport = schedules.find((item) => item.courseName === '体育');
  assert.equal(sport?.dayOfWeek, 5);
  assert.equal(sport?.periodStart, 3);
  assert.deepEqual(sport?.weeks, [1, 3, 5]);
  assert.equal(sport?.room, null);
});

test('无法解析的页面给出警告', () => {
  const { schedules, warnings } = parseTimetable('<html>登录页</html>');
  assert.deepEqual(schedules, []);
  assert.ok(warnings.some((warning) => warning.includes('未从课表页解析出课程')));
});

test('登录流程：密码不以明文提交', async () => {
  const calls: Array<{ url: string; body?: string | undefined }> = [];
  const pages: Record<string, string> = {
    login: '<form><input type="hidden" name="csrftoken" value="tok"></form>',
    key: '{"modulus":"CA1","exponent":"11"}',
    timetable: GRID_HTML,
  };
  const fetchImpl = async (url: string, init?: { body?: string }): Promise<JwglxtFetchResponse> => {
    calls.push({ url, body: init?.body });
    const body =
      url.includes('login_getPublicKey') ? pages.key : url.includes('xskb_list') ? pages.timetable : pages.login;
    return { status: 200, text: async () => body ?? '', setCookie: ['JSESSIONID=abc; Path=/'] };
  };

  const result = await fetchTimetable({
    baseUrl: 'jw.example.edu.cn',
    username: '20260001',
    password: 'secret-password',
    fetchImpl,
    totalWeeks: 20,
  });

  assert.equal(result.schedules.length, 3);
  const post = calls.find((call) => call.body !== undefined);
  assert.ok(post !== undefined);
  assert.ok(post.body?.includes('yhm=20260001'));
  assert.ok(post.body?.includes('csrftoken=tok'));
  assert.ok(!post.body?.includes('secret-password'), '密码不得以明文出现在请求体');
  assert.ok(post.body?.includes('mm='));
});

test('过程日志不含明文密码与密文', async () => {
  const entries: JwglxtLogEntry[] = [];
  const fetchImpl = async (url: string): Promise<JwglxtFetchResponse> => {
    const body = url.includes('login_getPublicKey')
      ? '{"modulus":"CA1","exponent":"11"}'
      : url.includes('xskb_list')
        ? GRID_HTML
        : '<html>ok</html>';
    return { status: 200, text: async () => body, setCookie: ['JSESSIONID=abc; Path=/'] };
  };

  await fetchTimetable({
    baseUrl: 'jw.example.edu.cn',
    username: '20260001',
    password: 'secret-password',
    fetchImpl,
    totalWeeks: 20,
    onLog: (entry) => entries.push(entry),
  });

  const dumped = JSON.stringify(entries);
  assert.ok(!dumped.includes('secret-password'), '日志不得含明文密码');
  assert.ok(!dumped.includes('mm='), '日志不得含加密后的提交体');
  assert.deepEqual(
    entries.map((entry) => entry.step),
    ['login-page', 'public-key', 'login-post', 'timetable', 'parse'],
  );
  assert.equal(entries.at(-1)?.detail?.['schedules'], 3);
  assert.equal(entries[1]?.detail?.['modulusHexChars'], 3);
  assert.equal(entries[1]?.detail?.['modulusEncoding'], 'hex');
});

test('登录失败与会话失效被识别', async () => {
  const failing = async (url: string): Promise<JwglxtFetchResponse> => ({
    status: 200,
    text: async () =>
      url.includes('login_getPublicKey')
        ? '{"modulus":"CA1","exponent":"11"}'
        : url.includes('login_slogin')
          ? '<div>用户名或密码不正确</div>'
          : '<html></html>',
  });
  await assert.rejects(
    () =>
      fetchTimetable({ baseUrl: 'jw.example.edu.cn', username: 'u', password: 'p', fetchImpl: failing }),
    /用户名或密码不正确/,
  );

  const expired = async (url: string): Promise<JwglxtFetchResponse> => ({
    status: 200,
    text: async () =>
      url.includes('login_getPublicKey') ? '{"modulus":"CA1","exponent":"11"}' : '<html>login_slogin</html>',
  });
  await assert.rejects(
    () =>
      fetchTimetable({ baseUrl: 'jw.example.edu.cn', username: 'u', password: 'p', fetchImpl: expired }),
    /会话失效/,
  );
});

test('密码编码不匹配时自动改用另一种重试', async () => {
  const accepted = encryptPassword('CA1', '11', 'p', 'hex-binary');
  const posts: string[] = [];
  const fetchImpl = async (url: string, init?: { body?: string }): Promise<JwglxtFetchResponse> => {
    if (url.includes('login_getPublicKey')) {
      return { status: 200, text: async () => '{"modulus":"CA1","exponent":"11"}', setCookie: ['JSESSIONID=x'] };
    }
    if (url.includes('login_slogin') && init?.body !== undefined) {
      posts.push(init.body);
      const mm = new URLSearchParams(init.body).get('mm');
      return {
        status: 200,
        text: async () => (mm === accepted ? '<html>ok</html>' : '<div>用户名或密码不正确</div>'),
        setCookie: ['JSESSIONID=y'],
      };
    }
    return { status: 200, text: async () => GRID_HTML, setCookie: [] };
  };

  const result = await fetchTimetable({
    baseUrl: 'jw.example.edu.cn',
    username: 'u',
    password: 'p',
    fetchImpl,
    totalWeeks: 20,
  });
  assert.equal(posts.length, 2, '第一次编码被拒后应换编码重试一次');
  assert.equal(new URLSearchParams(posts[0]).get('mm'), encryptPassword('CA1', '11', 'p', 'hex-ascii'));
  assert.equal(new URLSearchParams(posts[1]).get('mm'), accepted);
  assert.ok(result.schedules.length > 0);
});

test('两种编码都被拒时报密码错误', async () => {
  const fetchImpl = async (url: string, init?: { body?: string }): Promise<JwglxtFetchResponse> => {
    if (url.includes('login_getPublicKey')) {
      return { status: 200, text: async () => '{"modulus":"CA1","exponent":"11"}' };
    }
    if (url.includes('login_slogin') && init?.body !== undefined) {
      return { status: 200, text: async () => '<div>密码错误</div>' };
    }
    return { status: 200, text: async () => '<html></html>' };
  };
  await assert.rejects(
    () => fetchTimetable({ baseUrl: 'jw.example.edu.cn', username: 'u', password: 'p', fetchImpl }),
    /密码不正确/,
  );
});
