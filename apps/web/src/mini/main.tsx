import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WIDGET_VARIANTS,
  WEEKDAY_LABELS,
  addDays,
  dayOfWeek,
  formatDate,
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
import { describeError, logDebug, logError, logInfo, logWarn, installLogHandlers } from '../log.ts';
import { fail } from '../lib/fail.ts';
import { formatCountdown, formatRemaining } from '../lib/format.ts';
import { WIDGET_DATA_CHANGED_EVENT } from '../widget-snapshot.ts';
import { canUseWidget, measureWidget, openMainWindow, watchWidgetResize } from '../widget-window.ts';
import { MiniShell } from './shell.tsx';
import { examWidgetView } from './exam.ts';
import { ExamWidgetBody } from './exam.tsx';
import { miniEmptyText, shouldShowTomorrow, tomorrowPreviewLessons, previewDateFor } from './tomorrow.ts';
import '../styles.css';

installWebviewGuards();
installLogHandlers();

/** 兜底轮询间隔：主窗口的数据变更会主动通知，这里只防窗口漏掉通知。 */
const REFRESH_MS = 15_000;

async function hideWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
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
        latest.hideWeekends !== current.hideWeekends ||
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
      // 原始异常只进日志；悬浮窗只显示用户语言
      logWarn('mini', '悬浮窗数据加载失败', { message: describeError(cause) });
      setError(fail('课表读取失败', '数据暂时读不出来', '请稍后重试；仍失败请重启应用。').text);
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
        logWarn('mini', '悬浮窗初始化失败', { message: describeError(cause) });
        if (!cancelled) {
          setError(fail('悬浮窗读取失败', '无法打开本机数据', '请关闭后重新打开悬浮窗；仍失败请重启应用。').text);
        }
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
        logWarn('mini', '订阅数据变更失败', { message: describeError(cause) });
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
  /** 考试倒计时样式：最近一场未过期考试 + 总场数（纯函数，冒烟可用桩数据断言） */
  const examView = examWidgetView(data?.exams ?? [], now, zone);
  const hide = (): void => void hideWindow();
  // 悬浮窗是常用入口：双击整窗或点标题栏「打开」都能回主窗口
  const openMain = (): void => void openMainWindow();
  // 明天有课时把标题栏文案换掉，不再往内容区里塞一行标签（那行会把课程名挤出可视区）
  const headLabel = current !== undefined ? '正在上课' : undefined;
  // 明日课程预告：复用设置里的「空日程提示明日预告」，当天没课或当天的课都上完时切过去
  const todayLessons = data?.todayLessons ?? [];
  const tomorrowLessons = data?.tomorrowLessons ?? [];
  const tomorrowEnabled = settings?.tomorrowPreview !== false;
  // 「始终不显示周末」时预告看下一个工作日：周五看周一，不显示周末
  const tomorrowDate = data === null ? '' : addDays(data.today, 1);
  const previewDate = data === null ? '' : previewDateFor(data.today, settings?.hideWeekends === true);
  const previewLessons =
    data === null || previewDate === tomorrowDate
      ? tomorrowLessons
      : (data.lessonsByDate.get(previewDate) ?? []);
  const previewLabel =
    data === null || previewDate === tomorrowDate
      ? '明日课程预告'
      : `${WEEKDAY_LABELS[dayOfWeek(previewDate) - 1] ?? ''}课程预告`;
  const showTomorrow = shouldShowTomorrow({
    enabled: tomorrowEnabled,
    todayEnds: todayLessons.map((lesson) => lesson.endAt),
    tomorrowCount: previewLessons.length,
    now,
  });
  const nextIsTomorrow =
    next !== undefined &&
    !todayLessons.some((lesson) => lesson.startAt === next.startAt) &&
    (data === null ? false : formatDate(next.startAt, zone) === formatDate(Date.parse(`${data.today}T00:00:00Z`) + 86_400_000, 'UTC'));
  /** 下一节课的实际日期（跨天时用来标明是明天还是更晚） */
  const nextDayLabel = ((): string => {
    if (next === undefined || data === null) return '';
    const nextDate = formatDate(next.startAt, zone);
    if (nextDate === data.today) return '';
    const dayAfter = formatDate(Date.parse(`${data.today}T00:00:00Z`) + 2 * 86_400_000, 'UTC');
    if (nextDate === dayAfter) return '后天';
    return nextDate;
  })();
  // 实际渲染的列表：today 用当天/预告课程，combo 用未完成且带截止时间的待办（最多 3 条）
  const todayShown = showTomorrow ? tomorrowPreviewLessons(previewLessons).slice(0, 3) : todayLessons;
  const comboTasks = (data?.todos ?? [])
    .filter((row) => row.done === 0 && row.due_at !== null && row.due_at !== undefined)
    .sort((left, right) => (left.due_at ?? 0) - (right.due_at ?? 0))
    .slice(0, 3);
  /**
   * 正文行数：让原生按内容定高（Rust `content_height` = 头部 + 留白 + 行高 × 行数）。
   * minimal 只有一行大数字，行数不影响高度；空态也占一行。
   */
  const contentRows = ((): number | undefined => {
    if (variant === 'minimal') return undefined;
    if (error !== null) return 1;
    if (variant === 'today') return Math.max(1, todayShown.length);
    // combo 上半区固定 3 行（标签 / 课程名 / 时间行）+ 待办区标签 1 行
    if (variant === 'combo') return 4 + Math.max(1, comboTasks.length);
    // exam：考试名 1 行 + 倒计时/日期 1 行；没有考试时只有空态 1 行
    if (variant === 'exam') return examView.next === null ? 1 : 2;
    // bar：课程名 + 时间行
    return 2;
  })();

  // 行数或样式变了才请原生定高：同一份内容不重复 resize（StrictMode 双跑也只调一次）
  const measuredKey = useRef('');
  useEffect(() => {
    if (!canUseWidget()) return;
    const key = `${variant}:${contentRows ?? ''}`;
    if (key === measuredKey.current) return;
    measuredKey.current = key;
    void measureWidget(variant, contentRows).then((layout) => {
      // 失败时清掉指纹，下一次数据刷新再试
      if (layout === null) measuredKey.current = '';
    });
  }, [variant, contentRows]);

  // 用户拖动边框后 200ms 防抖记忆尺寸；非桌面端 watchWidgetResize 直接返回空函数
  useEffect(() => {
    if (!canUseWidget()) return;
    return watchWidgetResize(variant);
  }, [variant]);

  if (error !== null) {
    return (
      <MiniShell variant={variant} onHide={hide} onOpen={openMain} background={background}>
        <div className="mini-empty" data-role="mini-error" role="alert">
          {error}
        </div>
      </MiniShell>
    );
  }

  if (variant === 'minimal') {
    return (
      <MiniShell variant={variant} onHide={hide} onOpen={openMain} label={headLabel} background={background}>
        <div className="mini-minimal">
          <span className="mini-count-big" data-role="mini-count">
            {current !== undefined
              ? formatRemaining(current.endAt, now)
              : next === undefined
                ? '--:--'
                : formatCountdown(next.startAt - now)}
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

  if (variant === 'exam') {
    return (
      <MiniShell variant={variant} onHide={hide} onOpen={openMain} label="考试倒计时" background={background}>
        <ExamWidgetBody exams={data?.exams ?? []} now={now} timeZone={zone} />
      </MiniShell>
    );
  }

  if (variant === 'today') {
    // 预告最多列 3 节，且不再插入独立标签行，避免把课程名挤出悬浮窗
    const lessons = todayShown;
    return (
      <MiniShell
        variant={variant}
        onHide={hide}
        onOpen={openMain}
        background={background}
        label={showTomorrow ? previewLabel : undefined}
      >
        {lessons.length === 0 ? (
          <div className="mini-empty">{miniEmptyText(showTomorrow)}</div>
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
                      剩余 {formatRemaining(lesson.endAt, now)}
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
    const tasks = comboTasks;
    return (
      <MiniShell variant={variant} onHide={hide} onOpen={openMain} label={headLabel} background={background}>
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
                ? formatRemaining(current.endAt, now)
                : next === undefined
                  ? '--:--'
                  : formatCountdown(next.startAt - now)}
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
              {formatRemaining(current.endAt, now)}
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
              {formatCountdown(next.startAt - now)}
            </span>
            <span className="mini-meta">
              {nextDayLabel === '' ? '' : `${nextDayLabel} `}
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
