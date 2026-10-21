import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, Storage } from '@dawn-tick/core';
import { invokeNative } from '../lib/native.ts';
import { readMetaJson, writeMetaJson } from '../lib/meta.ts';
import { SEEN_NOTICES_META_KEY } from '../lib/meta-keys.ts';
import { applyLogSettings, describeError, logDebug, logInfo, logWarn } from '../log.ts';
import { applyDevFeatures } from '../dev-features.ts';
import { ensureStartupPermissions } from '../permissions.ts';
import { markNotifyAsked } from '../notify.ts';
import { isFallbackStorage } from '../db/fallback.ts';
import { checkForUpdate, resolveReceiveBeta } from '../update.ts';
import { CHANNEL, appVersion } from '../channel.ts';
import type { AppData } from '../data.ts';
import type { NoticeDismissOptions } from '../components/app-dialogs.tsx';
import { NOTICE_BETA, NOTICE_DEV, RELEASES_URL } from '../components/app-dialogs.tsx';
import { closeUpdatePrompt, requestUpdatePrompt, useUpdatePrompt, bindUpdatePromptStorage } from '../components/update-prompt.ts';
import type { UpdatePrompt } from '../components/update-prompt.ts';
import { readIgnoredVersion, shouldPrompt } from '../lib/update-preferences.ts';
import { openExternalUrl } from '../system-actions.ts';

function parseSeenNotices(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

async function readSeenNotices(storage: Storage): Promise<string[]> {
  return readMetaJson(storage, SEEN_NOTICES_META_KEY, { parse: parseSeenNotices, fallback: [], scope: 'notice' });
}

async function markNoticeSeen(storage: Storage, id: string): Promise<void> {
  try {
    const seen = await readSeenNotices(storage);
    if (seen.includes(id)) return;
    await writeMetaJson(storage, SEEN_NOTICES_META_KEY, [...seen, id], { scope: null });
  } catch (cause: unknown) {
    // 提示已读只是本地记录：临时回退（只读）或写失败都不该打断用户
    logWarn('notice', '记录提示已读失败', { message: describeError(cause) });
  }
}

export interface AppEffects {
  /** 待展示的渠道提示（开发版 / 测试版），按 id 记录已提示过 */
  notice: string | null;
  dismissNotice: (notice: string, options: NoticeDismissOptions) => void;
  /** 发现新版本时的更新信息（含已忽略版本，供弹窗给取消忽略入口） */
  updateInfo: UpdatePrompt | null;
  closeUpdate: () => void;
  /** 再查一次更新（切到测试版后） */
  recheckUpdate: () => void;
}

/**
 * 启动后跟随设置变化的副作用：日志级别、开发者特性、权限申请、动效、渠道提示、
 * 布局自检、版本检查与数据加载留痕。只做副作用，不持有界面数据。
 */
export function useAppEffects(input: {
  storage: Storage | null;
  /** 借给界面层的存储（回退时为只读包装） */
  screenStorage: Storage | null;
  settings: AppSettings;
  data: AppData | null;
}): AppEffects {
  const { storage, screenStorage, settings, data } = input;
  /** 待展示的渠道提示（开发版频繁更新 / 测试版不稳定），按 id 记录已提示过 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 发现新版本时的更新信息弹窗：与设置页手动检查共用同一份数据源 */
  const updateInfo = useUpdatePrompt();
  /** 递增触发一次额外的自动检查（切到测试版后） */
  const [checkTick, setCheckTick] = useState(0);
  /** 启动权限只申请一次，设置变化不再重复弹系统弹窗 */
  const startupPermissionsDone = useRef(false);
  /** 启动时按设置检查一次更新，只提示不下载 */
  const autoChecked = useRef(false);

  // 日志级别与开关同步到原生：写文件的门槛按设置走（dev 默认 trace）
  useEffect(() => {
    applyLogSettings({ level: settings.logLevel, fileEnabled: settings.logEnabled });
  }, [settings.logLevel, settings.logEnabled]);

  // 开发者特性开关：影响 debug 日志、右键菜单与控制台；更新渠道不变
  useEffect(() => {
    applyDevFeatures(settings.devFeatures);
    void (async () => {
      try {
        // 黑框控制台只在开发渠道且显式开了开发者特性时出现：测试版/正式版不该弹出控制台
        await invokeNative('set_dev_console', { enabled: CHANNEL === 'dev' && settings.devFeatures });
      } catch {
        // 非桌面端没有控制台
      }
    })();
  }, [settings.devFeatures, settings.logLevel, settings.logEnabled]);

  // 启动时主动索取必要权限：安卓的通知与精确闹钟（课前提醒要靠它们才准点）
  useEffect(() => {
    if (storage === null || startupPermissionsDone.current) return;
    startupPermissionsDone.current = true;
    void ensureStartupPermissions({ remindersEnabled: settings.classReminderEnabled }).then(async (report) => {
      // 只有真的发起过系统申请才记「问过」：否则桌面端会把「未申请」误判成「已拒绝」
      if (report.notifications !== 'skipped' && !isFallbackStorage(storage)) await markNotifyAsked(storage);
    });
    // 存储就绪后只跑一次：权限弹窗不该随设置变化重复弹
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  // 动效设置落到根节点：CSS 按 data-motion 统一停用
  useEffect(() => {
    document.documentElement.dataset.motion = settings.motion;
  }, [settings.motion]);

  // 更新偏好（忽略的版本）绑定到界面上这份存储：弹窗与设备页更新区共用同一份记录
  useEffect(() => {
    bindUpdatePromptStorage(screenStorage);
  }, [screenStorage]);

  // 渠道提示：不是初次使用也要弹——只要这条提示没展示过
  useEffect(() => {
    const storageReady = storage;
    if (storageReady === null) return;
    const noticeId = CHANNEL === 'dev' ? NOTICE_DEV : CHANNEL === 'beta' ? NOTICE_BETA : null;
    if (noticeId === null) return;
    void (async () => {
      const seen = await readSeenNotices(storageReady);
      if (!seen.includes(noticeId)) setNotice(noticeId);
    })();
  }, [storage]);

  // 启动时按设置检查一次更新，只提示不下载；「自动检查版本更新」关闭时跳过
  useEffect(() => {
    if (!settings.autoCheckUpdate) return;
    if (autoChecked.current && checkTick === 0) return;
    autoChecked.current = true;
    let cancelled = false;
    void (async () => {
      const status = await checkForUpdate({
        channel: CHANNEL,
        receiveBeta: resolveReceiveBeta(settings.receiveBeta, CHANNEL),
        currentVersion: appVersion(),
      });
      if (cancelled || !status.available) return;
      // 忽略只针对那一个版本：远端出了更高版本仍要自动提示
      const ignored = screenStorage === null ? null : await readIgnoredVersion(screenStorage);
      if (cancelled) return;
      if (!shouldPrompt({ remote: status.latest, current: appVersion(), ignored })) {
        logInfo('update', '已忽略该版本，跳过自动提示', { version: status.latest });
        return;
      }
      // 检查到严格更高的新版本：交给统一的更新弹窗（版本、渠道、当前版本与发布说明）
      requestUpdatePrompt(status);
    })();
    return () => {
      cancelled = true;
    };
    // 设置就绪后只检查一次；切到测试版会递增 checkTick 再查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoCheckUpdate, checkTick]);

  // 窗口改尺寸后记录一次视口与滚动区高度：滑不动时日志里能看出是哪一层算错
  useEffect(() => {
    if (typeof globalThis.addEventListener !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const report = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        const main = document.querySelector('[data-role="app-main"]');
        const shell = document.querySelector('[data-role="app-shell"]');
        const nav = document.querySelector('[data-role="bottom-nav"]');
        const navHeight = nav === null ? null : Math.round(nav.getBoundingClientRect().height);
        const mainPadBottom =
          main === null ? null : Math.round(Number.parseFloat(getComputedStyle(main).paddingBottom) || 0);
        logDebug('layout', '视口变化', {
          viewport: `${globalThis.innerWidth}x${globalThis.innerHeight}`,
          shell: shell === null ? null : Math.round(shell.getBoundingClientRect().height),
          main: main === null ? null : Math.round(main.getBoundingClientRect().height),
          mainScroll: main === null ? null : `${main.scrollTop}/${main.scrollHeight}`,
          navHeight,
          mainPadBottom,
          cards: document.querySelectorAll('[data-role="course-card"]').length,
          gridPadTop: document.querySelector('[data-role="grid-pad-top"]') === null ? 0 : 1,
          gridPadBottom: document.querySelector('[data-role="grid-pad-bottom"]') === null ? 0 : 1,
        });
        // 自检：底部留白必须不小于底部栏，否则最后一屏会被挡住
        if (navHeight !== null && mainPadBottom !== null && mainPadBottom < navHeight) {
          logWarn('layout', '主区底部留白小于底部栏高度', { navHeight, mainPadBottom });
        }
        // 自检：引导页内容超出时必须可滚动
        const onboard = document.querySelector('[data-role="onboarding-scroll"]');
        if (onboard !== null) {
          const overflowY = getComputedStyle(onboard).overflowY;
          const box = {
            clientHeight: Math.round(onboard.clientHeight),
            scrollHeight: Math.round(onboard.scrollHeight),
            overflowY,
          };
          logDebug('layout', '引导页滚动容器', box);
          if (box.scrollHeight > box.clientHeight && overflowY !== 'auto' && overflowY !== 'scroll') {
            logWarn('layout', '引导页内容超出却不可滚动', box);
          }
        }
      }, 200);
    };
    globalThis.addEventListener('resize', report);
    report();
    // 启动时日志级别还没同步到原生，第一次上报可能被门槛挡掉：布局稳定后再报一次
    const late = setTimeout(report, 2500);
    return () => {
      globalThis.removeEventListener('resize', report);
      clearTimeout(late);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // 数据加载留痕：出问题时日志里能看出这次载入的是哪个学期、多少条
  useEffect(() => {
    if (data === null || storage === null) return;
    logDebug('data', '数据已加载', {
      storage: storage.kind,
      semester: data.semester?.name ?? null,
      week: data.week,
      viewWeek: data.viewWeek,
      slots: data.slots.length,
      courses: data.courses.length,
      cells: [...data.grid.values()].reduce((total, list) => total + list.length, 0),
      todayLessons: data.todayLessons.length,
      todos: data.todos.length,
      exams: data.exams.length,
      adjustments: data.reschedules.length,
      holidays: data.holidayLabels.size,
    });
  }, [data, storage]);

  /** 关掉渠道提示：记已读、清状态；去发布页或切到测试版时再补上对应的副作用。 */
  const dismissNotice = useCallback(
    (id: string, options: NoticeDismissOptions) => {
      const target = screenStorage;
      if (target !== null) void markNoticeSeen(target, id);
      if (options.openReleases === true) openExternalUrl(RELEASES_URL);
      // 从测试版提示回来时自动检查一次更新（按钮路径不查，与原来一致）
      if (id === NOTICE_BETA && options.recheck === true && settings.autoCheckUpdate) {
        autoChecked.current = false;
        setCheckTick((tick) => tick + 1);
      }
      setNotice(null);
    },
    [screenStorage, settings.autoCheckUpdate],
  );

  const closeUpdate = useCallback(() => closeUpdatePrompt(), []);
  const recheckUpdate = useCallback(() => {
    autoChecked.current = false;
    setCheckTick((tick) => tick + 1);
  }, []);

  return { notice, dismissNotice, updateInfo, closeUpdate, recheckUpdate };
}
