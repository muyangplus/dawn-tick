import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './button.tsx';
import { Dialog, DialogContent, DialogFooter } from './dialog.tsx';
import { Input } from './input.tsx';
import { toast } from './toaster.tsx';
import { useAction } from '../../lib/action.ts';
import { copyText, openExternalUrlDetailed } from '../../system-actions.ts';

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
      label: '正在打开链接…',
      task: () => openExternalUrlDetailed(url),
    });
    if (!result.ok) {
      setError(result.error ?? '打开失败，请稍后重试');
      return;
    }
    const outcome = result.value;
    if (outcome === null || outcome === undefined || !outcome.ok) {
      setError(outcome?.error ?? '打开失败，请改用「复制链接」');
      return;
    }
    closeExternalLink();
    toast.success('已在默认浏览器打开');
  }

  async function act(action: () => Promise<boolean>, done: string, failed: string): Promise<void> {
    const result = await run({ scope: 'link', label: '正在打开链接…', task: action });
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
      <DialogContent title="打开外部链接" description="应用内不加载该页面，交给系统浏览器">
        <Input
          readOnly
          data-role="external-link-url"
          aria-label="链接地址"
          value={url ?? ''}
          onFocus={(event) => event.currentTarget.select()}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => closeExternalLink()}>
            取消
          </Button>
          <Button
            variant="secondary"
            data-role="external-link-copy"
            loading={busy}
            onClick={() => void act(() => copyText(url ?? ''), '已复制链接', '复制失败，请手动复制链接')}
          >
            复制链接
          </Button>
          <Button
            variant="primary"
            data-role="external-link-open"
            loading={busy}
            onClick={() => void open(url ?? '')}
          >
            用默认浏览器打开
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
