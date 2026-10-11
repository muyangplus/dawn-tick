import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WIDGET_VARIANTS, formatTime, readSettings, type AppSettings, type WidgetVariant } from '@dawn-tick/core';
import { loadAppData, type AppData } from '../data.ts';
import { openStorage } from '../db/platform.ts';
import { applyTheme } from '../theme.ts';
import { installWebviewGuards } from '../webview-guard.ts';
import '../styles.css';

installWebviewGuards();

const REFRESH_MS = 60_000;

async function hideWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

function countdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return '即将开始';
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function variantOf(settings: AppSettings | null): WidgetVariant {
  const value = settings?.widgetVariant;
  return value !== undefined && (WIDGET_VARIANTS as readonly string[]).includes(value) ? value : 'bar';
}

function Shell({
  variant,
  onHide,
  children,
}: {
  variant: WidgetVariant;
  onHide: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className={`mini mini-${variant}`} data-tauri-drag-region>
      <div className="mini-head" data-tauri-drag-region>
        <span className="mini-label">晓刻 DawnTick</span>
        <button type="button" className="mini-close" onClick={onHide} title="隐藏">
          ×
        </button>
      </div>
      <div className="mini-body" data-tauri-drag-region>
        {children}
      </div>
    </main>
  );
}

function Mini() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storage = await openStorage();
      const loaded = await readSettings(storage);
      if (cancelled) return;
      setSettings(loaded);
      applyTheme(loaded.themePreset, loaded.theme);
      const refresh = async (): Promise<void> => {
        const next = await loadAppData(storage, loaded);
        if (!cancelled) setData(next);
      };
      await refresh();
      const timer = setInterval(() => void refresh(), REFRESH_MS);
      return () => clearInterval(timer);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const variant = variantOf(settings);
  const next = data?.nextLesson;
  const hide = (): void => void hideWindow();

  if (variant === 'minimal') {
    return (
      <Shell variant={variant} onHide={hide}>
        <div className="mini-minimal">
          <span className="mini-count-big">{next === undefined ? '--:--' : countdown(next.startAt, now)}</span>
          <span className="mini-minimal-name">{next?.courseName ?? '暂无后续课程'}</span>
        </div>
      </Shell>
    );
  }

  if (variant === 'today') {
    const lessons = data?.todayLessons ?? [];
    return (
      <Shell variant={variant} onHide={hide}>
        {lessons.length === 0 ? (
          <div className="mini-empty">今天没有课</div>
        ) : (
          <ul className="mini-list">
            {lessons.map((lesson) => {
              const running = lesson.startAt <= now && lesson.endAt > now;
              const finished = lesson.endAt <= now;
              return (
                <li
                  key={`${lesson.scheduleId}-${lesson.startAt}`}
                  className={`mini-item${running ? ' mini-item-now' : ''}${finished ? ' mini-item-done' : ''}`}
                  style={{ borderLeftColor: lesson.color }}
                >
                  <span className="tabular mini-item-time">{formatTime(lesson.startAt, data?.timeZone ?? 'UTC')}</span>
                  <span className="mini-item-name">{lesson.courseName}</span>
                  {lesson.room !== null && <span className="mini-item-room">{lesson.room}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Shell>
    );
  }

  if (variant === 'combo') {
    const tasks = (data?.todos ?? [])
      .filter((row) => row.done === 0 && row.due_at !== null && row.due_at !== undefined)
      .sort((left, right) => (left.due_at ?? 0) - (right.due_at ?? 0))
      .slice(0, 3);
    return (
      <Shell variant={variant} onHide={hide}>
        <div className="mini-combo-top">
          <span className="mini-label">下一节课</span>
          <span className="mini-title">{next?.courseName ?? '暂无后续课程'}</span>
          <div className="mini-row">
            <span className="mini-count">{next === undefined ? '--:--' : countdown(next.startAt, now)}</span>
            <span className="mini-meta">
              {next === undefined ? '' : `${formatTime(next.startAt, data?.timeZone ?? 'UTC')}${next.room === null ? '' : ` · ${next.room}`}`}
            </span>
          </div>
        </div>
        <div className="mini-combo-bottom">
          <span className="mini-label">待办与作业</span>
          {tasks.length === 0 ? (
            <div className="mini-empty">暂无待办</div>
          ) : (
            <ul className="mini-list">
              {tasks.map((task) => (
                <li key={task.id} className="mini-item mini-item-task">
                  <span className="mini-item-name">{task.title}</span>
                  <span className="tabular mini-item-time">
                    {task.due_at === null || task.due_at === undefined ? '' : formatTime(task.due_at, data?.timeZone ?? 'UTC')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell variant={variant} onHide={hide}>
      {next === undefined ? (
        <div className="mini-empty">{data?.semester === null ? '尚未创建学期' : '暂无后续课程'}</div>
      ) : (
        <>
          <div className="mini-title">{next.courseName}</div>
          <div className="mini-row">
            <span className="mini-count">{countdown(next.startAt, now)}</span>
            <span className="mini-meta">
              {data === null ? '' : formatTime(next.startAt, data.timeZone)}
              {next.room !== null ? ` · ${next.room}` : ''}
            </span>
          </div>
        </>
      )}
    </Shell>
  );
}

const container = document.getElementById('mini-root');
if (container === null) throw new Error('#mini-root 缺失');

createRoot(container).render(
  <StrictMode>
    <Mini />
  </StrictMode>,
);
