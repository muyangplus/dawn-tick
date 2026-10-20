import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  BookPlus,
  ChevronDown,
  FileInput,
  GraduationCap,
  ListChecks,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { Button } from './ui/button.tsx';
import { Sheet } from './ui/sheet.tsx';
import { cn } from '../lib/cn.ts';

/** 统一「＋」菜单的四类新增动作：桌面工具栏、移动 FAB、日程页「添加」菜单共用同一份定义。 */
export type AddActionId = 'course' | 'todo' | 'exam' | 'import';

export interface AddActionItem {
  id: AddActionId;
  label: string;
  icon: LucideIcon;
}

/** 动作顺序即菜单顺序：课程 → 待办 → 考试 → 导入。 */
export const ADD_ACTIONS: readonly AddActionItem[] = [
  { id: 'course', label: '加课程', icon: BookPlus },
  { id: 'todo', label: '加待办', icon: ListChecks },
  { id: 'exam', label: '加考试', icon: GraduationCap },
  { id: 'import', label: '导入课表', icon: FileInput },
];

/** 四个动作的具体实现由 App 提供：菜单只做动作派发，不内嵌表单。 */
export type AddActionHandlers = Record<AddActionId, () => void>;

const AddActionsContext = createContext<AddActionHandlers | null>(null);

/** 日程页卡片等深层组件取四个动作；没有 Provider 时返回 null，由调用方自行降级。 */
export function useAddActions(): AddActionHandlers | null {
  return useContext(AddActionsContext);
}

/** 为整个页面注入统一「＋」动作。 */
export function AddActionsProvider({
  actions,
  children,
}: {
  actions: AddActionHandlers;
  children: ReactNode;
}) {
  return <AddActionsContext.Provider value={actions}>{children}</AddActionsContext.Provider>;
}

/** 同一时刻只允许一个下拉展开，点到别处或按 Esc 收起。 */
function useDismiss(root: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      if (event.target instanceof Node && self.contains(event.target)) return;
      self.open = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      const self = root.current;
      if (self === null || !self.open) return;
      if (event.key === 'Escape') self.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [root]);
}

/** 桌面工具栏：主按钮 + 下拉，四项与移动端完全同源。 */
export function AddMenuButton({ actions }: { actions: AddActionHandlers }) {
  const root = useRef<HTMLDetailsElement>(null);
  useDismiss(root);
  return (
    <details ref={root} data-role="add-menu" className="relative">
      <summary
        aria-label="添加"
        className={cn(
          'inline-flex min-h-tap cursor-pointer list-none items-center justify-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-on-primary',
          'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-strong focus-visible:ring-offset-2 focus-visible:ring-offset-page',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <Plus className="size-4" aria-hidden />
        添加
        <ChevronDown className="size-3.5" aria-hidden />
      </summary>
      <div
        role="menu"
        aria-label="添加"
        className="absolute right-0 z-30 mt-1 flex w-44 flex-col gap-1 rounded-md border border-line bg-surface p-1 shadow-md"
      >
        {ADD_ACTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            data-action={id}
            className="flex min-h-tap w-full items-center gap-2 rounded-sm px-3 text-left text-sm text-ink hover:bg-surface-muted"
            onClick={() => {
              if (root.current !== null) root.current.open = false;
              actions[id]();
            }}
          >
            <Icon className="size-4 shrink-0 text-muted" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** 移动端：右下角 FAB + 底部 Sheet，四项与桌面下拉同源。 */
export function AddFab({ actions }: { actions: AddActionHandlers }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="添加"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(var(--dt-bottom-nav)+env(safe-area-inset-bottom)+var(--spacing-2))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg"
      >
        <Plus className="size-6" aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="bottom" title="添加" description="加课程、待办、考试或导入课表">
        <div className="flex flex-col gap-2" data-role="add-actions">
          {ADD_ACTIONS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="secondary"
              size="md"
              data-action={id}
              className="justify-start"
              onClick={() => {
                setOpen(false);
                actions[id]();
              }}
            >
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
