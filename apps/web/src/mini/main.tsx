import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WIDGET_VARIANTS,
  formatTime,
  readSettings,
  type AppSettings,
  type Storage,
  type WidgetVariant,
} from '@dawn-tick/core';
import { loadAppData, type AppData } from '../data.ts';
import { openStorage } from '../db/platform.ts';
import { applyTheme } from '../theme.ts';
import { installWebviewGuards } from '../webview-guard.ts';
import { logDebug, logError, logInfo, logWarn, installLogHandlers } from '../log.ts';
import { WIDGET_DATA_CHANGED_EVENT } from '../widget-snapshot.ts';
import { MiniShell } from './shell.tsx';
import { shouldShowTomorrow, tomorrowPreviewLessons } from './tomorrow.ts';
import '../styles.css';

installWebviewGuards();
installLogHandlers();

/** 兜底轮询间隔：主窗口的数据变更会主动通知，这里只防窗口漏掉通知。 */
const REFRESH_MS = 15_000;

async function hideWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

/** 时间差格式化：超过一小时带小时位。 */
function span(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** 距下一节开始：已是开始时刻时给「即将开始」。 */
function countdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return '即将开始';
  return span(Math.floor(diff / 1000));
}

/** 距本节结束：已经到点给 00:00。 */
function remaining(endAt: number, now: number): string {
  return span(Math.max(0, Math.floor((endAt - now) / 1000)));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function variantOf(settings: AppSettings | null): WidgetVariant {
  const value = settings?.widgetVariant;
  return value !== undefined && (WIDGET_VARIANTS as readonly string[]).includes(value) ? value : 'bar';
}

function Mini() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const storageRef = useRef<Storage | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  /** 上一次的数据指纹：只在数据真的变了时写日志，避免轮询把日志刷满 */
  const lastSignature = useRef('');

  // 重新读一次课表与设置：主窗口数据/设置变更时由事件触发，另有定时兜底。
  const reload = useCallback(async (): Promise<void> => {
    const storage = storageRef.current;
    const current = settingsRef.current;
    if (storage === null || current === null) return;
    try {
      const latest = await readSettings(storage);
      if (
        latest.tomorrowPreview !== current.tomorrowPreview ||
        latest.widgetVariant !== current.widgetVariant ||
        latest.widgetBackground !== current.widgetBackground
      ) {
        settingsRef.current = latest;
        setSettings(latest);
      }
      const next = await loadAppData(storage, latest);
      setData(next);
      setError(null);
      const signature = [
        next.week,
        next.viewWeek,
        next.currentLesson?.scheduleId ?? '',
        next.nextLesson?.scheduleId ?? '',
        next.todayLessons.length,
        next.tomorrowLessons.length,
        latest.tomorrowPreview ? 'tomorrow' : 'today-only',
      ].join('|');
      if (signature !== lastSignature.current) {
        lastSignature.current = signature;
        logInfo('mini', '悬浮窗数据已更新', {
          week: next.week,
          current: next.currentLesson?.courseName ?? '',
          next: next.nextLesson?.courseName ?? '',
          tomorrow: next.tomorrowLessons.length,
        });
      }
    } catch (cause: unknown) {
      const message = describe(cause);
      setError(message);
      logWarn('mini', '悬浮窗数据加载失败', { message });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storage = await openStorage();
        const loaded = await readSettings(storage);
        if (cancelled) return;
        storageRef.current = storage;
        settingsRef.current = loaded;
        setSettings(loaded);
        applyTheme(loaded.themePreset, loaded.theme);
        await reload();
      } catch (cause: unknown) {
        const message = describe(cause);
        if (!cancelled) setError(message);
        logWarn('mini', '悬浮窗初始化失败', { message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // 主窗口改完数据会广播 WIDGET_DATA_CHANGED_EVENT：立即重读，不等轮询
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const off = await listen(WIDGET_DATA_CHANGED_EVENT, () => void reload());
        if (disposed) off();
        else stop = off;
      } catch (cause: unknown) {
        logWarn('mini', '订阅数据变更失败', { message: describe(cause) });
      }
    })();
    return () => {
      disposed = true;
      stop?.();
    };
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const variant = variantOf(settings);
  const current = data?.currentLesson;
  const next = data?.nextLesson;
  const zone = data?.timeZone ?? 'UTC';
  const background = settings?.widgetBackground ?? 'light';
  const hide = (): void => void hideWindow();
  // 明天有课时把标题栏文案换掉，不再往内容区里塞一行标签（那行会把课程名挤出可视区）
  const headLabel = current !== undefined ? '正在上课' : undefined;
  // 明日课程预告：复用设置里的「空日程提示明日预告」，当天没课或当天的课都上完时切过去
  const todayLessons = data?.todayLessons ?? [];
  const tomorrowLessons = data?.tomorrowLessons ?? [];
  const tomorrowEnabled = settings?.tomorrowPreview !== false;
  const showTomorrow = shouldShowTomorrow({
    enabled: tomorrowEnabled,
    todayEnds: todayLessons.map((lesson) => lesson.endAt),
    tomorrowCount: tomorrowLessons.length,
    now,
  });
  const nextIsTomorrow = next !== undefined && !todayLessons.some((lesson) => lesson.startAt === next.startAt);

  if (error !== null) {
    return (
      <MiniShell variant={variant} onHide={hide} background={background}>
        <div className="mini-empty" data-role="mini-error">
          课表读取失败：{error}
        </div>
      </MiniShell>
    );
  }

  if (variant === 'minimal') {
    return (
      <MiniShell variant={variant} onHide={hide} label={headLabel} background={background}>
        <div className="mini-minimal">
          <span className="mini-count-big" data-role="mini-count">
            {current !== undefined
              ? remaining(current.endAt, now)
              : next === undefined
                ? '--:--'
                : countdown(next.startAt, now)}
          </span>
          <span className="mini-minimal-name">
            {current !== undefined
              ? current.courseName
              : nextIsTomorrow && tomorrowEnabled
                ? `明日 ${next?.courseName ?? ''}`
                : next?.courseName ?? '暂无后续课程'}
          </span>
        </div>
      </MiniShell>
    );
  }

  if (variant === 'today') {
    // 明日预告最多列 3 节，且不再插入独立标签行，避免把课程名挤出悬浮窗
    const lessons = showTomorrow ? tomorrowPreviewLessons(tomorrowLessons).slice(0, 3) : todayLessons;
    return (
      <MiniShell
        variant={variant}
        onHide={hide}
        background={background}
        label={showTomorrow ? '明日课程预告' : undefined}
      >
        {lessons.length === 0 ? (
          <div className="mini-empty">今天没有课啦</div>
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
                  <span className="tabular mini-item-time">{formatTime(lesson.startAt, zone)}</span>
                  <span className="mini-item-name">{lesson.courseName}</span>
                  {running && (
                    <span className="tabular mini-item-remain" data-role="mini-running-left">
                      余 {remaining(lesson.endAt, now)}
                    </span>
                  )}
                  {lesson.room !== null && <span className="mini-item-room">{lesson.room}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </MiniShell>
    );
  }

  if (variant === 'combo') {
    const tasks = (data?.todos ?? [])
      .filter((row) => row.done === 0 && row.due_at !== null && row.due_at !== undefined)
      .sort((left, right) => (left.due_at ?? 0) - (right.due_at ?? 0))
      .slice(0, 3);
    return (
      <MiniShell variant={variant} onHide={hide} label={headLabel} background={background}>
        <div className="mini-combo-top">
          <span className="mini-label" data-role="mini-top-label">
            {current !== undefined ? '正在上课' : nextIsTomorrow && tomorrowEnabled ? '明日课程预告' : '下一节课'}
          </span>
          <span className="mini-title" data-role="mini-title">
            {current !== undefined ? current.courseName : next?.courseName ?? '暂无后续课程'}
          </span>
          <div className="mini-row">
            <span className="mini-count" data-role="mini-count">
              {current !== undefined
                ? remaining(current.endAt, now)
                : next === undefined
                  ? '--:--'
                  : countdown(next.startAt, now)}
            </span>
            <span className="mini-meta">
              {current !== undefined
                ? `${formatTime(current.startAt, zone)}–${formatTime(current.endAt, zone)}${current.room === null ? '' : ` · ${current.room}`}`
                : next === undefined
                  ? ''
                  : `${formatTime(next.startAt, zone)}${next.room === null ? '' : ` · ${next.room}`}`}
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
                    {task.due_at === null || task.due_at === undefined ? '' : formatTime(task.due_at, zone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </MiniShell>
    );
  }

  return (
    <MiniShell variant={variant} onHide={hide} label={headLabel} background={background}>
      {current !== undefined ? (
        <>
          <div className="mini-title" data-role="mini-title">
            {current.courseName}
          </div>
          <div className="mini-row">
            <span className="mini-count" data-role="mini-count">
              {remaining(current.endAt, now)}
            </span>
            <span className="mini-meta">
              {formatTime(current.startAt, zone)}–{formatTime(current.endAt, zone)}
              {current.room === null ? '' : ` · ${current.room}`}
            </span>
          </div>
        </>
      ) : next === undefined ? (
        <div className="mini-empty">{data?.semester === null ? '尚未创建学期' : '暂无后续课程'}</div>
      ) : (
        <>
          <div className="mini-title" data-role="mini-title">
            {nextIsTomorrow && tomorrowEnabled ? `明日 ${next.courseName}` : next.courseName}
          </div>
          <div className="mini-row">
            <span className="mini-count" data-role="mini-count">
              {countdown(next.startAt, now)}
            </span>
            <span className="mini-meta">
              {formatTime(next.startAt, zone)}
              {next.room !== null ? ` · ${next.room}` : ''}
            </span>
          </div>
        </>
      )}
    </MiniShell>
  );
}

const container = document.getElementById('mini-root');
if (container === null) throw new Error('#mini-root 缺失');

createRoot(container).render(
  <StrictMode>
    <Mini />
  </StrictMode>,
);
