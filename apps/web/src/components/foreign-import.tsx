import { useEffect, useState } from 'react';
import {
  BACKUP_FORMAT,
  BACKUP_MODULE_LABEL,
  BACKUP_MODULE_STORES,
  BACKUP_MODULES,
  BACKUP_VERSION,
  importBackup,
  summarizeBackup,
  type BackupModule,
  type BackupPayload,
  type ImportMode,
  type Storage,
} from '@dawn-tick/core';
import { Button } from './ui/button.tsx';
import { Field, Input } from './ui/input.tsx';
import { toast } from './ui/toaster.tsx';
import { canUseWidget } from '../widget-window.ts';
import { logInfo, logWarn } from '../log.ts';

interface Candidate {
  path: string;
  size: number;
}

/** 从其他位置导入：列出候选数据库 → 读取为备份结构 → 复用导入流程。 */
export function ForeignImport({ storage, onImported }: { storage: Storage; onImported: () => void }) {
  const [directory, setDirectory] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [source, setSource] = useState('');
  const [modules, setModules] = useState<BackupModule[]>([...BACKUP_MODULES]);
  const [mode, setMode] = useState<ImportMode>('overwrite');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canUseWidget()) return;
    void find(directory);
    // 只在挂载时列一次已知位置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function find(target: string): Promise<void> {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const found = await invoke<Candidate[]>('list_data_locations', {
        extraDir: target.trim().length === 0 ? null : target.trim(),
      });
      setCandidates(found);
      setMessage(found.length === 0 ? '没有找到 dawn-tick.db' : `找到 ${found.length} 个数据库`);
    } catch (cause: unknown) {
      setMessage(`查找失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  async function read(path: string): Promise<void> {
    setBusy(true);
    setPayload(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const tables = [...new Set(modules.flatMap((module) => BACKUP_MODULE_STORES[module]))];
      const data = await invoke<{ stores: Record<string, unknown[]>; meta: Record<string, string> }>(
        'read_foreign_database',
        { path, stores: tables },
      );
      const next: BackupPayload = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: Date.now(),
        stores: data.stores as BackupPayload['stores'],
        meta: data.meta,
        modules: [...BACKUP_MODULES],
      };
      setPayload(next);
      setSource(path);
      setMessage(`已读取 ${path}`);
    } catch (cause: unknown) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setMessage(`读取失败：${text}`);
      logWarn('foreign-import', '读取外部数据库失败', { path, message: text });
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (payload === null) return;
    setBusy(true);
    try {
      const result = await importBackup(storage, payload, { mode, modules });
      logInfo('foreign-import', '从其他位置导入', { source, mode, imported: result.imported });
      toast.success(`已导入 ${result.imported} 条数据`);
      setMessage(`写入 ${result.imported} 条，跳过 ${result.skipped} 条`);
      onImported();
    } catch (cause: unknown) {
      setMessage(`导入失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!canUseWidget()) {
    return <span className="text-xs text-muted">网页版只支持导入备份文件；从其他数据库读取需要桌面版。</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink">从其他位置导入</span>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="扫描目录（可选）">
          <Input
            value={directory}
            placeholder="D:\旧版本"
            aria-label="扫描目录"
            onChange={(event) => setDirectory(event.target.value)}
          />
        </Field>
        <Button size="sm" variant="secondary" aria-label="查找数据库" disabled={busy} onClick={() => void find(directory)}>
          查找数据库
        </Button>
      </div>
      {candidates !== null && candidates.length > 0 && (
        <ul className="flex flex-col gap-1">
          {candidates.map((item) => (
            <li key={item.path} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {item.path}（{(item.size / 1024).toFixed(1)} KB）
              </span>
              <Button size="sm" variant="ghost" aria-label={`读取 ${item.path}`} disabled={busy} onClick={() => void read(item.path)}>
                读取
              </Button>
            </li>
          ))}
        </ul>
      )}
      {payload !== null && (
        <>
          <span className="text-xs text-muted">
            {summarizeBackup(payload)
              .map((item) => `${BACKUP_MODULE_LABEL[item.module]} ${item.rows}`)
              .join('、')}
          </span>
          <div className="flex flex-wrap gap-2">
            {BACKUP_MODULES.map((module) => (
              <label key={module} className="flex items-center gap-1 text-xs text-ink">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`导入模块：${BACKUP_MODULE_LABEL[module]}`}
                  checked={modules.includes(module)}
                  onChange={(event) => {
                    setModules((current) =>
                      event.target.checked ? [...current, module] : current.filter((item) => item !== module),
                    );
                  }}
                />
                {BACKUP_MODULE_LABEL[module]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={mode === 'overwrite' ? 'primary' : 'secondary'}
              aria-label="合并导入"
              onClick={() => setMode('overwrite')}
            >
              合并（同 id 覆盖）
            </Button>
            <Button
              size="sm"
              variant={mode === 'skip' ? 'primary' : 'secondary'}
              aria-label="跳过已存在"
              onClick={() => setMode('skip')}
            >
              保留现有（同 id 跳过）
            </Button>
          </div>
          <Button variant="primary" aria-label="导入外部分数据" disabled={busy || modules.length === 0} onClick={() => void apply()}>
            导入
          </Button>
        </>
      )}
      {message !== null && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}
