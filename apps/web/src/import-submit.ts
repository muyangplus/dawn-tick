import { logError, logInfo } from './log.ts';
import { isDesktopApp } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';

const root = document.getElementById('root');

function show(title: string, detail: string): void {
  if (root === null) return;
  root.textContent = '';
  const box = document.createElement('div');
  box.style.cssText =
    'display:flex;flex-direction:column;gap:12px;align-items:flex-start;max-width:520px;margin:12vh auto;padding:24px;font:15px/1.6 system-ui,sans-serif;color:#141414';
  const heading = document.createElement('h1');
  heading.textContent = title;
  heading.style.cssText = 'font-size:20px;margin:0';
  const text = document.createElement('p');
  text.textContent = detail;
  text.style.cssText = 'margin:0;color:#555';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '返回教务页面';
  back.style.cssText = 'padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#f5f5f5;cursor:pointer';
  back.onclick = () => {
    window.history.back();
  };
  box.appendChild(heading);
  box.appendChild(text);
  box.appendChild(back);
  root.appendChild(box);
}

function decodePayload(encoded: string): string {
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function main(): Promise<void> {
  const hash = window.location.hash.replace(/^#/, '');
  const encoded = new URLSearchParams(hash).get('d');
  if (encoded === null || encoded.length === 0) {
    show('没有收到内容', '请回到教务页面，重新点击右下角「导入到晓刻」。');
    return;
  }

  let payload = '';
  try {
    payload = decodePayload(encoded);
  } catch (cause: unknown) {
    logError('import-window', '内容解码失败', { message: String(cause) });
    show('内容读取失败', '请回到晓刻，用书签或粘贴页面内容');
    return;
  }

  if (!isDesktopApp()) {
    show('交回失败', '当前平台不支持内嵌导入');
    return;
  }

  try {
    await invokeNative('submit_page_import', { payload });
    logInfo('import-window', '交回页面内容', { bytes: payload.length });
    show('已交给晓刻', `共 ${payload.length} 字节；关闭本窗口或返回教务页面`);
    window.setTimeout(() => window.history.back(), 2000);
  } catch (cause: unknown) {
    const message = nativeErrorMessage(cause);
    logError('import-window', '交回失败', { message });
    show('交回失败', message);
  }
}

void main();
