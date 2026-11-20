import test from 'node:test';
import assert from 'node:assert/strict';
import { pathForLog, textForLog, urlForLog } from '../src/lib/log-redact.ts';

test('urlForLog：去掉路径、查询串与片段，只留协议与主机', () => {
  assert.equal(urlForLog('https://jw.example.edu.cn/jsxsd/kbcx?token=abc&sid=42#top'), 'https://jw.example.edu.cn');
  assert.equal(urlForLog('http://192.168.1.8:37421/sync/pull?since=1'), 'http://192.168.1.8:37421');
});

test('urlForLog：userinfo 里的账号密码不落盘', () => {
  const redacted = urlForLog('https://alice:s3cret@dav.example.com/remote.php/dav/files/alice/');
  assert.equal(redacted, 'https://dav.example.com');
  assert.ok(!redacted.includes('alice'));
  assert.ok(!redacted.includes('s3cret'));
});

test('urlForLog：没有主机的链接只留协议，解析不了只记长度', () => {
  assert.equal(urlForLog('mailto:someone@example.com'), 'mailto:');
  assert.equal(urlForLog('not a url ?token=abc'), '<invalid url, 20 chars>');
  assert.equal(urlForLog(''), '<invalid url, 0 chars>');
});

test('pathForLog：Windows 用户目录折成 ~，大小写与分隔符都认', () => {
  assert.equal(pathForLog('C:\\Users\\张三\\AppData\\Local\\DawnTick\\dawn-tick.db'), '~\\AppData\\Local\\DawnTick\\dawn-tick.db');
  assert.equal(pathForLog('d:/users/li.si/Documents/备份.zip'), '~/Documents/备份.zip');
  assert.equal(pathForLog('C:\\Documents and Settings\\wang\\桌面'), '~\\桌面');
});

test('pathForLog：macOS 与 Linux 主目录折成 ~', () => {
  assert.equal(pathForLog('/Users/zhangsan/Library/Application Support/x'), '~/Library/Application Support/x');
  assert.equal(pathForLog('/home/zhangsan/.config/dawn-tick'), '~/.config/dawn-tick');
  assert.equal(pathForLog('/home/zhangsan'), '~');
});

test('pathForLog：主目录外的路径原样保留，空值返回 null', () => {
  assert.equal(pathForLog('D:\\DawnTick\\data\\dawn-tick.db'), 'D:\\DawnTick\\data\\dawn-tick.db');
  assert.equal(pathForLog('/data/user/0/com.dawntick.app/files'), '/data/user/0/com.dawntick.app/files');
  assert.equal(pathForLog('/var/home/zhangsan'), '/var/home/zhangsan', '只认开头的主目录');
  assert.equal(pathForLog(null), null);
  assert.equal(pathForLog(undefined), null);
});

test('textForLog：报错文本里的链接逐个折成协议与主机，其余文字不动', () => {
  assert.equal(
    textForLog('error sending request for url (https://dav.example.com/dav/a.zip?sig=xyz): timed out'),
    'error sending request for url (https://dav.example.com): timed out',
  );
  assert.equal(
    textForLog('先连 http://u:p@10.0.0.2:8080/a?b=1，再试 https://b.example.org/x#frag 都失败'),
    '先连 http://10.0.0.2:8080，再试 https://b.example.org 都失败',
  );
  assert.equal(textForLog('没有链接的原因'), '没有链接的原因');
});
