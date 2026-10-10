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
  type JwglxtFetchResponse,
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

test('RSA 加密与 Base64 转换', () => {
  // n = 0xCA1 = 3233，e = 0x11 = 17，明文 'A' = 65 → 65^17 mod 3233 = 2790
  assert.equal(rsaEncryptHex('CA1', '11', 'A'), 'ae6');
  assert.equal(hexToBase64('ae6'), 'CuY=');
  assert.equal(encryptPassword('CA1', '11', 'A'), 'CuY=');
  assert.throws(() => rsaEncryptHex('zz', '11', 'A'), /非法十六进制/);
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
