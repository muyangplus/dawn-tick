import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { THEME_PRESETS, formatTime, readSettings, type AppSettings } from '@dawn-tick/core';
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

  const next = data?.nextLesson;

  return (
    <main className="mini" data-tauri-drag-region>
      <div className="mini-head" data-tauri-drag-region>
        <span className="mini-label">下一节课</span>
        <button type="button" className="mini-close" onClick={() => void hideWindow()} title="隐藏">
          ×
        </button>
      </div>
      {next === undefined ? (
        <div className="mini-empty" data-tauri-drag-region>
          {data?.semester === null ? '尚未创建学期' : '暂无后续课程'}
        </div>
      ) : (
        <div data-tauri-drag-region>
          <div className="mini-title" data-tauri-drag-region>
            {next.courseName}
          </div>
          <div className="mini-row" data-tauri-drag-region>
            <span className="mini-count">{countdown(next.startAt, now)}</span>
            <span className="mini-meta">
              {data === null ? '' : formatTime(next.startAt, data.timeZone)}
              {next.room !== null ? ` · ${next.room}` : ''}
            </span>
          </div>
        </div>
      )}
      {settings !== null && !(THEME_PRESETS as readonly string[]).includes(settings.themePreset) && (
        <div className="mini-empty">主题异常</div>
      )}
    </main>
  );
}

const container = document.getElementById('mini-root');
if (container === null) throw new Error('#mini-root 缺失');

createRoot(container).render(
  <StrictMode>
    <Mini />
  </StrictMode>,
);
