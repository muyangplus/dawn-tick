import { createContext, useContext } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { cn } from '../lib/cn.ts';
import { findHelpEntry } from '../help/help-content.ts';
import { helpCopy } from '../copy/help.ts';

/** 打开帮助页并展开指定条目；App 提供。没有提供者（引导页、独立窗口）时入口不显示。 */
export const HelpLinkContext = createContext<((entryId: string) => void) | null>(null);

/** 界面上「查看帮助」入口：替代分步骤的长说明，跳到帮助页对应条目。 */
export function HelpLink({ entryId, className }: { entryId: string; className?: string }) {
  const openHelp = useContext(HelpLinkContext);
  const entry = findHelpEntry(entryId);
  if (openHelp === null || entry === null) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="link"
      className={cn('self-start px-0 text-xs', className)}
      data-role="help-link"
      data-help-target={entryId}
      aria-label={helpCopy.viewHelpAria(entry.title)}
      onClick={() => openHelp(entryId)}
    >
      <CircleHelp className="size-3.5 shrink-0" aria-hidden />
      {helpCopy.viewHelp}
    </Button>
  );
}
