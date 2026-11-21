import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './button.tsx';
import { Dialog, DialogContent, DialogFooter } from './dialog.tsx';
import { Input } from './input.tsx';
import { toast } from './toaster.tsx';
import { useAction } from '../../lib/action.ts';
import { copyText, openExternalUrlDetailed } from '../../system-actions.ts';
import { uiCopy } from '../../copy/ui.ts';

type Listener = (url: string | null) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

function publish(url: string | null): void {
  pending = url;
  for (const listener of listeners) listener(url);
}

/** 请求打开外部链接确认框：同一时刻只保留一个待确认的地址。 */
export function requestExternalLink(url: string): void {
  publish(url);
}

export function closeExternalLink(): void {
  publish(null);
}

function useExternalLinkRequest(): string | null {
  const [url, setUrl] = useState<string | null>(pending);
  useEffect(() => {
    const listener: Listener = (next) => setUrl(next);
    listeners.add(listener);
    listener(pending);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return url;
}

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  dataRole?: string;
}

/** 应用内置链接：点击不导航，先弹确认框，确认后交给默认浏览器或复制链接；href 与 target 照常保留。 */
export function ExternalLink({ href, children, className, ariaLabel, dataRole }: ExternalLinkProps) {
  return (
    <a
      data-role={dataRole}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        requestExternalLink(href);
      }}
    >
      {children}
    </a>
  );
}

/** 外部链接确认框：挂在应用根节点，全局只渲染一个。 */
export function ExternalLinkConfirm() {
  const url = useExternalLinkRequest();
  const { busy, run } = useAction();
  /** 打开失败时在弹窗内停留并展示原因：只弹 toast 容易被忽略，看起来像「点确认没反应」 */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [url]);

  async function open(url: string): Promise<void> {
    setError(null);
    const result = await run({
      scope: 'link',
      label: uiCopy.externalLink.busy,
      task: () => openExternalUrlDetailed(url),
    });
    if (!result.ok) {
      setError(result.error ?? uiCopy.externalLink.openFailed);
      return;
    }
    const outcome = result.value;
    if (outcome === null || outcome === undefined || !outcome.ok) {
      setError(outcome?.error ?? uiCopy.externalLink.openFailedUseCopy);
      return;
    }
    closeExternalLink();
    toast.success(uiCopy.externalLink.opened);
  }

  async function act(action: () => Promise<boolean>, done: string, failed: string): Promise<void> {
    const result = await run({ scope: 'link', label: uiCopy.externalLink.busy, task: action });
    if (!result.ok) {
      if (result.error !== null) toast.info(failed);
      return;
    }
    if (result.value !== true) {
      toast.info(failed);
      return;
    }
    closeExternalLink();
    toast.success(done);
  }

  return (
    <Dialog
      open={url !== null}
      onOpenChange={(open) => {
        if (!open) closeExternalLink();
      }}
    >
      <DialogContent title={uiCopy.externalLink.title} description={uiCopy.externalLink.description}>
        <Input
          readOnly
          data-role="external-link-url"
          aria-label={uiCopy.externalLink.urlAria}
          value={url ?? ''}
          onFocus={(event) => event.currentTarget.select()}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => closeExternalLink()}>
            {uiCopy.externalLink.cancelButton}
          </Button>
          <Button
            variant="secondary"
            data-role="external-link-copy"
            loading={busy}
            onClick={() => void act(() => copyText(url ?? ''), uiCopy.externalLink.copied, uiCopy.externalLink.copyFailed)}
          >
            {uiCopy.externalLink.copyButton}
          </Button>
          <Button
            variant="primary"
            data-role="external-link-open"
            loading={busy}
            onClick={() => void open(url ?? '')}
          >
            {uiCopy.externalLink.openButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
