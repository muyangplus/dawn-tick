import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent } from '../../components/ui/dialog.tsx';
import { ExternalLink } from '../../components/ui/external-link.tsx';
import { Markdown } from '../../components/ui/markdown.tsx';
import { RECENT_UPDATES } from '../../lib/recent-updates-data.ts';
import { releaseTagUrl } from '../../lib/recent-updates.ts';

/**
 * 「近期更新」：关于分组里的版本变更弹窗。
 *
 * 数据来自构建时内联的 CHANGELOG，离线可看；每个版本给发布日期与 Release 详情入口，
 * 正文直接复用 Markdown 渲染器（与更新弹窗同一套），不另外写一套排版。
 */
export function RecentUpdatesDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        data-role="recent-updates-open"
        onClick={() => setOpen(true)}
      >
        近期更新
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="近期更新"
          description="按发布倒序，完整历史见发布页"
          data-role="recent-updates-dialog"
        >
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            {RECENT_UPDATES.length === 0 ? (
              <p className="text-xs text-muted">还没有更新记录，去发布页看看吧。</p>
            ) : (
              RECENT_UPDATES.map((item) => (
                <section key={item.version} data-role="recent-update-item" className="flex flex-col gap-1">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="tabular text-sm font-semibold text-ink">v{item.version}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="tabular">{item.date}</span>
                      <ExternalLink
                        className="text-primary-strong underline"
                        href={releaseTagUrl(item.version)}
                        ariaLabel={`打开发布 v${item.version} 的 Release 页面`}
                      >
                        详情
                      </ExternalLink>
                    </span>
                  </header>
                  <Markdown source={item.body} dataRole="recent-update-body" />
                </section>
              ))
            )}
          </div>
          <div className="flex justify-end pt-1">
            <Button variant="primary" onClick={() => setOpen(false)}>
              知道了
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
