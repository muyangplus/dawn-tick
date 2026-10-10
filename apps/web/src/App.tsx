import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  formatTime,
  readSettings,
  validatedStorage,
  writeSettings,
  type AppSettings,
  type Storage,
} from '@dawn-tick/core';
import { openIndexedDbStorage } from './db/idb-storage.ts';
import { loadAppData, type AppData } from './data.ts';
import { applyTheme } from './theme.ts';
import { CourseForm } from './screens/CourseForm.tsx';
import { ImportDialog } from './screens/ImportDialog.tsx';
import { Onboarding } from './screens/Onboarding.tsx';
import { Settings } from './screens/Settings.tsx';
import { TodayView } from './screens/TodayView.tsx';
import { WeekView } from './screens/WeekView.tsx';
import './styles.css';

const USER_ID = 'u1';
type View = 'week' | 'today' | 'settings';

export function App() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<View>('week');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opened = validatedStorage(await openIndexedDbStorage());
        const loaded = await readSettings(opened);
        if (cancelled) return;
        setStorage(opened);
        setSettings(loaded);
        applyTheme(loaded.themePreset, loaded.theme);
        setData(await loadAppData(opened, loaded));
        const manager = globalThis.navigator?.storage;
        if (manager !== undefined && typeof manager.persist === 'function') {
          const granted = await manager.persist();
          if (!cancelled) setPersistent(granted);
        }
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyTheme(settings.themePreset, settings.theme);
    if (settings.theme !== 'system' || typeof globalThis.matchMedia !== 'function') return;
    const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => {
      applyTheme(settings.themePreset, settings.theme);
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [settings.theme, settings.themePreset]);

  const reload = useCallback(async (target: Storage, current: AppSettings) => {
    setData(await loadAppData(target, current));
  }, []);

  const patch = useCallback(
    async (partial: Partial<AppSettings>) => {
      if (storage === null) return;
      const next = await writeSettings(storage, partial);
      setSettings(next);
      await reload(storage, next);
    },
    [storage, reload],
  );

  if (error !== null) {
    return (
      <main className="app">
        <p className="error">{error}</p>
      </main>
    );
  }

  if (storage === null || data === null) {
    return <main className="app" />;
  }

  if (data.semester === null) {
    return (
      <Onboarding
        storage={storage}
        userId={USER_ID}
        timeZone={settings.timeZone}
        onDone={() => {
          void (async () => {
            await reload(storage, settings);
            setView('week');
          })();
        }}
      />
    );
  }

  return (
    <main className="app">
      <header className="bar">
        <span className="title">{data.semester.name}</span>
        <span className="muted">
          第 {data.week} 周 · {data.today}
          {data.nextLesson !== undefined && ` · 下一节 ${formatTime(data.nextLesson.startAt, data.timeZone)}`}
        </span>
      </header>

      <div className="bar">
        <div className="tabs">
          <button type="button" className="tab" aria-current={view === 'week'} onClick={() => setView('week')}>
            周视图
          </button>
          <button type="button" className="tab" aria-current={view === 'today'} onClick={() => setView('today')}>
            今日
          </button>
          <button
            type="button"
            className="tab"
            aria-current={view === 'settings'}
            onClick={() => setView('settings')}
          >
            设置
          </button>
        </div>
        <button type="button" onClick={() => setImporting(true)}>
          导入
        </button>
        <button type="button" className="primary" onClick={() => setAdding(true)}>
          添加课程
        </button>
      </div>

      {view === 'week' && (
        <WeekView
          storage={storage}
          data={data}
          viewDays={settings.viewDays}
          timeZone={data.timeZone}
          onChanged={() => void reload(storage, settings)}
        />
      )}
      {view === 'today' && <TodayView data={data} timeZone={data.timeZone} />}
      {view === 'settings' && <Settings settings={settings} persistent={persistent} onPatch={patch} />}

      {importing && (
        <ImportDialog
          storage={storage}
          semesterId={data.semester.id}
          onDone={() => {
            setImporting(false);
            void reload(storage, settings);
          }}
        />
      )}

      {adding && (
        <CourseForm
          storage={storage}
          semesterId={data.semester.id}
          semesterStart={data.semester.start_date}
          totalWeeks={data.semester.total_weeks}
          preset={settings.themePreset}
          slots={data.slots}
          onDone={() => {
            setAdding(false);
            void reload(storage, settings);
          }}
        />
      )}
    </main>
  );
}
