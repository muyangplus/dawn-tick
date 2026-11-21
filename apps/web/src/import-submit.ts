import { logError, logInfo } from './log.ts';
import { isDesktopApp } from './lib/capabilities.ts';
import { invokeNative, nativeErrorMessage } from './lib/native.ts';
import { importWindowCopy } from './copy/import-window.ts';

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
  back.textContent = importWindowCopy.submitBack;
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
  const params = new URLSearchParams(hash);
  const encoded = params.get('d');
  const nonce = params.get('n') ?? '';
  if (encoded === null || encoded.length === 0) {
    show(importWindowCopy.submitEmptyTitle, importWindowCopy.submitEmptyDetail);
    return;
  }

  let payload = '';
  try {
    payload = decodePayload(encoded);
  } catch (cause: unknown) {
    logError('import', '内容解码失败', { message: String(cause) });
    show(importWindowCopy.submitDecodeTitle, importWindowCopy.submitDecodeDetail);
    return;
  }

  if (!isDesktopApp()) {
    show(importWindowCopy.submitFailTitle, importWindowCopy.submitUnsupported);
    return;
  }

  try {
    await invokeNative('submit_page_import', { payload, nonce });
    logInfo('import', '页面内容已交回', { bytes: payload.length });
    show(importWindowCopy.submitDoneTitle, importWindowCopy.submitDoneDetail(payload.length));
    window.setTimeout(() => window.history.back(), 2000);
  } catch (cause: unknown) {
    const message = nativeErrorMessage(cause);
    logError('import', '页面内容交回失败', { message });
    show(importWindowCopy.submitFailTitle, message);
  }
}

void main();
