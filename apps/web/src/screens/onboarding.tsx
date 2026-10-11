import { useRef, useState } from 'react';
import {
  BACKUP_MODULE_LABEL,
  addDays,
  createSemester,
  formatDate,
  importBackup,
  summarizeBackup,
  weekStart,
  type BackupPayload,
  type Storage,
} from '@dawn-tick/core';
import { Button } from '../components/ui/button.tsx';
import { Card, CardTitle } from '../components/ui/card.tsx';
import { Field, Input } from '../components/ui/input.tsx';
import { toast } from '../components/ui/toaster.tsx';

export interface OnboardingProps {
  storage: Storage;
  userId: string;
  timeZone: string;
  onDone: () => void;
}

export function Onboarding({ storage, userId, timeZone, onDone }: OnboardingProps) {
  const today = formatDate(Date.now(), timeZone);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => weekStart(today));
  const [totalWeeks, setTotalWeeks] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BackupPayload | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(file: File): Promise<void> {
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as BackupPayload;
      if (parsed.format !== 'dawn-tick-backup') {
        setError('这个文件不是晓刻的备份');
        return;
      }
      setPending(parsed);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function applyImport(): Promise<void> {
    if (pending === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importBackup(storage, pending, { mode: 'overwrite' });
      toast.success(`已导入 ${result.imported} 条数据`);
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createSemester(storage, {
        userId,
        name: name.trim().length > 0 ? name.trim() : '我的学期',
        startDate,
        totalWeeks,
        timeZone,
      });
      toast.success('学期已创建');
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-page p-4">
      <div className="w-full max-w-md">
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>欢迎使用晓刻 DawnTick</CardTitle>
            <span className="text-xs text-muted">先创建学期，课表按周次计算</span>
          </div>
          <Field label="学期名称">
            <Input
              value={name}
              placeholder="2026-2027 第一学期"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="开学日期" hint="该周记为第 1 周">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="总周数">
            <Input
              type="number"
              min={1}
              max={30}
              value={totalWeeks}
              onChange={(event) => setTotalWeeks(Number(event.target.value))}
            />
          </Field>
          {error !== null && <p className="text-xs text-danger-strong">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              创建并开始
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStartDate(addDays(weekStart(formatDate(Date.now(), timeZone)), 7))}
            >
              下周一开学
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-xs font-semibold text-ink">已有数据？直接导入</span>
            <span className="text-xs text-muted">选择晓刻导出的备份文件，或先用 tools/backup/export-anywhere.mjs 从旧位置导出</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="选择备份文件"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void pickFile(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" aria-label="选择备份文件" disabled={busy} onClick={() => fileRef.current?.click()}>
                选择备份文件
              </Button>
              {pending !== null && (
                <>
                  <span className="text-xs text-muted">
                    {summarizeBackup(pending)
                      .map((item) => `${BACKUP_MODULE_LABEL[item.module]} ${item.rows}`)
                      .join('、')}
                  </span>
                  <Button variant="primary" aria-label="确认导入" disabled={busy} onClick={() => void applyImport()}>
                    确认导入
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                    取消
                  </Button>
                </>
              )}
            </div>
            {pending !== null && (
              <span className="text-xs text-muted">
                导入模块：{pending.modules === undefined ? '全部' : pending.modules.map((item) => BACKUP_MODULE_LABEL[item]).join('、')}
              </span>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
