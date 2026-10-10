import { useEffect, useState } from 'react';
import { BookOpen, CalendarClock, Search } from 'lucide-react';
import { searchAll, type SearchHit, type Storage } from '@dawn-tick/core';
import { Dialog, DialogContent } from './ui/dialog.tsx';
import { Input } from './ui/input.tsx';
import { EmptyState } from './ui/empty-state.tsx';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  course: '课程',
  schedule: '排课',
  event: '日程',
};

const KIND_ICON = {
  course: BookOpen,
  schedule: CalendarClock,
  event: CalendarClock,
} as const;

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storage: Storage;
  semesterId: string;
  onPick: (hit: SearchHit) => void;
}

export function SearchDialog({ open, onOpenChange, storage, semesterId, onPick }: SearchDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!open) return;
    if (keyword.trim().length === 0) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const found = await searchAll(storage, semesterId, keyword);
        if (!cancelled) setHits(found);
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [keyword, open, storage, semesterId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="搜索" description="课程、教师、地点、周次与日程">
        <Input
          autoFocus
          value={keyword}
          placeholder="输入关键词"
          aria-label="搜索关键词"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && hits[0] !== undefined) {
              onPick(hits[0]);
              onOpenChange(false);
            }
          }}
        />
        {hits.length === 0 ? (
          <EmptyState icon={Search} title={keyword.trim().length === 0 ? '输入关键词开始搜索' : '没有匹配结果'} />
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {hits.map((hit) => {
              const Icon = KIND_ICON[hit.kind];
              return (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(hit);
                      onOpenChange(false);
                    }}
                    className="flex min-h-tap w-full items-center gap-3 rounded-md px-2 text-left hover:bg-surface-muted"
                  >
                    <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-ink">{hit.title}</span>
                      <span className="truncate text-xs text-muted">
                        {KIND_LABEL[hit.kind]}
                        {hit.subtitle.length > 0 && ` · ${hit.subtitle}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
