import { useEffect, useRef, useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { Button } from '../../components/ui/button.tsx';
import { Field, Input } from '../../components/ui/input.tsx';
import { StatusLine, type StatusMessage, type StatusTone } from '../../components/ui/status-line.tsx';
import { toast } from '../../components/ui/toaster.tsx';
import { uiCopy } from '../../copy/ui.ts';
import { useAction } from '../../lib/action.ts';
import { loadAiClient } from '../../lib/ai.ts';
import { isWebApp } from '../../lib/capabilities.ts';
import {
  AI_API_KEY_META_KEY,
  ENCRYPTION_UNAVAILABLE_TEXT,
  readStoredSecret,
  saveStoredSecret,
  type WebdavPasswordInfo,
} from '../../lib/credentials.ts';
import { errorMessage } from '../../lib/errors.ts';
import { fail } from '../../copy/common.ts';
import { aiCopy as copy } from '../../copy/settings-ai.ts';
import { said } from './format.ts';

export interface AiCardProps {
  storage: Storage;
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}

function keyStatus(info: WebdavPasswordInfo | null, busy: boolean, saveError: string | null): { text: string; tone: StatusTone } {
  if (busy) return { text: copy.keySaving, tone: 'muted' };
  if (saveError !== null) return { text: saveError, tone: 'danger' };
  if (info === null) return { text: copy.keyReading, tone: 'muted' };
  if (info.state === 'error') return { text: info.message ?? copy.keyDecryptFailed, tone: 'danger' };
  if (info.state === 'plaintext') return { text: info.message ?? ENCRYPTION_UNAVAILABLE_TEXT, tone: 'danger' };
  if (info.state === 'encrypted' || info.state === 'migrated') return { text: copy.keyEncrypted, tone: 'success' };
  return info.encryptionAvailable ? { text: copy.keyEmpty, tone: 'muted' } : { text: copy.keyNoEncryption, tone: 'danger' };
}

function keyPlaceholder(info: WebdavPasswordInfo | null): string {
  if (info === null) return '';
  if (info.state === 'encrypted' || info.state === 'migrated') return copy.keyPlaceholderEncrypted;
  if (info.state === 'error') return copy.keyPlaceholderReenter;
  if (info.state === 'plaintext') return copy.keyPlaceholderPlaintext;
  return copy.keyPlaceholder;
}

/**
 * 设置 → AI：OpenAI 兼容接口的地址、模型与密钥。
 * 密钥与 WebDAV 密码同一套加密存储：只写不回显，离开输入框才保存。
 */
export function AiCard({ storage, settings, onPatch }: AiCardProps) {
  const action = useAction();
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [keyInfo, setKeyInfo] = useState<WebdavPasswordInfo | null>(null);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keySaveError, setKeySaveError] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readStoredSecret(storage, AI_API_KEY_META_KEY).then((info) => {
      if (alive) setKeyInfo(info);
    });
    return () => {
      alive = false;
    };
  }, [storage]);

  function updateDraft(value: string): void {
    draftRef.current = value;
    setKeyDraft(value);
    setKeySaveError(null);
  }

  async function commitKey(): Promise<void> {
    const next = draftRef.current;
    if (next === null) return;
    draftRef.current = null;
    setKeyDraft(null);
    setKeyBusy(true);
    setKeySaveError(null);
    const result = await saveStoredSecret(storage, AI_API_KEY_META_KEY, next);
    setKeyBusy(false);
    if (result.error !== null) {
      setKeySaveError(fail(copy.keySaveWhat, result.error, copy.retryLater));
      return;
    }
    setKeyInfo({
      password: next,
      state: result.state === 'encrypted' ? 'encrypted' : result.state === 'plaintext' ? 'plaintext' : 'empty',
      message: result.message,
      encryptionAvailable: result.encryptionAvailable,
    });
  }

  async function test(): Promise<void> {
    await commitKey();
    setStatus(said(copy.testing));
    const result = await action.run({
      scope: 'settings',
      label: copy.testing,
      fail: false,
      // 只读：Esc / 返回键可取消，请求一起中止
      cancellable: true,
      task: async (signal) => {
        try {
          const client = await loadAiClient(storage);
          await client.complete({ messages: [{ role: 'user', content: 'ping' }], signal });
          if (signal.aborted) return;
          setStatus(said(copy.testOk));
          toast.success(copy.testOk);
        } catch (cause: unknown) {
          if (signal.aborted) return;
          const message = fail(copy.testWhat, errorMessage(cause), copy.testNext);
          setStatus(said(message));
          toast.error(message);
        }
      },
    });
    if (result.cancelled === true) setStatus(said(uiCopy.back.cancelled));
  }

  const keyView = keyStatus(keyInfo, keyBusy, keySaveError);
  const ready = settings.aiBaseUrl.trim() !== '' && settings.aiModel.trim() !== '';

  return (
    <div className="flex flex-col gap-1" data-role="ai-settings">
      <span className="text-sm font-medium text-ink">{copy.title}</span>
      <p className="text-xs text-muted">{copy.intro}</p>
      {isWebApp() && <p className="text-xs text-muted" data-role="ai-web-note">{copy.webNote}</p>}
      <Field label={copy.baseUrlLabel}>
        <Input
          data-role="ai-base-url"
          value={settings.aiBaseUrl}
          placeholder={copy.baseUrlPlaceholder}
          onChange={(event) => void onPatch({ aiBaseUrl: event.target.value })}
        />
      </Field>
      <Field label={copy.modelLabel}>
        <Input
          data-role="ai-model"
          value={settings.aiModel}
          placeholder={copy.modelPlaceholder}
          onChange={(event) => void onPatch({ aiModel: event.target.value })}
        />
      </Field>
      <Field label={copy.keyLabel} hint={copy.keyHint}>
        <Input
          data-role="ai-api-key"
          type="password"
          autoComplete="new-password"
          value={keyDraft ?? ''}
          placeholder={keyPlaceholder(keyInfo)}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={() => void commitKey()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </Field>
      <StatusLine dataRole="ai-key-state" tone={keyView.tone}>
        {keyView.text}
      </StatusLine>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={action.busy} disabled={!ready} onClick={() => void test()}>
          {copy.testButton}
        </Button>
      </div>
      {status !== null && (
        <StatusLine dataRole="ai-status" at={status.at}>
          {status.text}
        </StatusLine>
      )}
    </div>
  );
}
